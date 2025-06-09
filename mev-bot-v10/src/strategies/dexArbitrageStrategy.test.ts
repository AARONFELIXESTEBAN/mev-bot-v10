import { DexArbitrageStrategy, PaperTrade } from './dexArbitrageStrategy';
import { SimulationResult } from '@services/simulation/simulationService';
import { DataCollectionService } from '@core/dataCollection/firestoreService';
import { PotentialOpportunity } from '@services/opportunity/opportunityService';
import { TokenInfo } from '@utils/typeUtils';
import { ethers, BigNumber } from 'ethers';

// Mock DataCollectionService
jest.mock('@core/dataCollection/firestoreService');
// Mock logger
jest.mock('@core/logger/loggerService', () => ({
    getLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn().mockReturnThis(), // For .child({ module: 'DexArbitrageStrategy' })
    }),
}));


describe('DexArbitrageStrategy', () => {
    let strategy: DexArbitrageStrategy;
    let mockFirestoreService: jest.Mocked<DataCollectionService>;

    const WETH_INFO: TokenInfo = { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18 };
    const DAI_INFO: TokenInfo = { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 };

    const initialPortfolio = {
        [WETH_INFO.address]: ethers.utils.parseUnits("10", WETH_INFO.decimals).toString(), // 10 WETH
        [DAI_INFO.address]: ethers.utils.parseUnits("5000", DAI_INFO.decimals).toString(), // 5000 DAI
    };
    const paperTradeCollectionName = "test_paper_trades";

    beforeEach(() => {
        jest.clearAllMocks();
        // We need to mock the constructor of DataCollectionService if it's complex,
        // but here we are providing an already instantiated mock.
        mockFirestoreService = new DataCollectionService(null as any) as jest.Mocked<DataCollectionService>;

        strategy = new DexArbitrageStrategy(
            mockFirestoreService,
            paperTradeCollectionName,
            initialPortfolio
        );
    });

    describe('constructor and portfolio initialization', () => {
        it('should initialize virtualPortfolio correctly from initialPortfolio', () => {
            const portfolio = strategy.getPortfolioDisplay(); // Using the getter for verification
            expect(portfolio[WETH_INFO.address]).toBe("10.0");
            expect(portfolio[DAI_INFO.address]).toBe("5000.0");
        });

        it('should reset virtualPortfolio correctly', () => {
            // Modify the portfolio
            (strategy as any).virtualPortfolio[WETH_INFO.address] = ethers.utils.parseUnits("5", WETH_INFO.decimals);
            strategy.resetVirtualPortfolio();
            const portfolio = strategy.getPortfolioDisplay();
            expect(portfolio[WETH_INFO.address]).toBe("10.0");
        });
    });

    describe('executePaperTrade', () => {
        const mockOpportunity: PotentialOpportunity = {
            id: "opp-123",
            path: [ /* PathSegment details don't matter much for this strategy test */ ],
            entryTokenAddress: WETH_INFO.address,
            entryAmountBase: ethers.utils.parseUnits("1", WETH_INFO.decimals),
            sourceTxHash: "0xSourceTx",
            discoveryTimestamp: Date.now(),
            tokenPath: [WETH_INFO, DAI_INFO, WETH_INFO], // Added for simulation.opportunity.tokenPath[0] access
        } as unknown as PotentialOpportunity; // Cast for simplicity if PathSegment structure is complex

         const profitableSimResult: SimulationResult = {
            opportunity: mockOpportunity,
            pathId: "path-xyz",
            isProfitable: true,
            grossProfitBaseToken: ethers.utils.parseUnits("0.05", WETH_INFO.decimals),
            estimatedGasCostBaseToken: ethers.utils.parseUnits("0.01", WETH_INFO.decimals),
            netProfitBaseToken: ethers.utils.parseUnits("0.04", WETH_INFO.decimals), // 0.04 WETH profit
            netProfitUsd: 80.0, // Assuming WETH is $2000
            amountInLeg1: ethers.utils.parseUnits("1", WETH_INFO.decimals),
            amountOutLeg1: ethers.utils.parseUnits("2050", DAI_INFO.decimals),
            amountOutLeg2: ethers.utils.parseUnits("1.04", WETH_INFO.decimals), // Final output
            simulationTimestamp: Date.now(),
        };

        const nonProfitableSimResult: SimulationResult = {
            ...profitableSimResult,
            isProfitable: false,
            netProfitBaseToken: ethers.utils.parseUnits("-0.005", WETH_INFO.decimals), // A loss
            netProfitUsd: -10.0,
        };

        it('should log data and update portfolio for a profitable trade', async () => {
            const initialWethBalance = (strategy as any).virtualPortfolio[WETH_INFO.address];

            await strategy.executePaperTrade(profitableSimResult);

            // Check portfolio update
            const expectedNewBalance = initialWethBalance.add(profitableSimResult.netProfitBaseToken);
            expect((strategy as any).virtualPortfolio[WETH_INFO.address].toString()).toBe(expectedNewBalance.toString());

            // Check Firestore logging
            expect(mockFirestoreService.logData).toHaveBeenCalledTimes(1);
            const logDataCall = mockFirestoreService.logData.mock.calls[0];
            const loggedTrade = logDataCall[0] as PaperTrade; // First argument to logData
            const collectionName = logDataCall[1]; // Second argument (subCollectionName)
            const docId = logDataCall[2]; // Third argument (documentId)

            expect(collectionName).toBe(paperTradeCollectionName);
            expect(docId).toBeDefined();
            expect(loggedTrade.id).toBe(docId);
            expect(loggedTrade.opportunityId).toBe(profitableSimResult.opportunity.id);
            expect(loggedTrade.simulatedNetProfitBaseToken).toBe(ethers.utils.formatUnits(profitableSimResult.netProfitBaseToken, WETH_INFO.decimals));
            expect(loggedTrade.netProfitUsd).toBe(profitableSimResult.netProfitUsd);
            expect(loggedTrade.amountInStartToken).toBe(ethers.utils.formatUnits(profitableSimResult.amountInLeg1, WETH_INFO.decimals));
            expect(loggedTrade.simulatedAmountOutEndToken).toBe(ethers.utils.formatUnits(profitableSimResult.amountOutLeg2, WETH_INFO.decimals));
        });

        it('should not log or update portfolio for a non-profitable trade', async () => {
            const initialWethBalance = (strategy as any).virtualPortfolio[WETH_INFO.address];
            await strategy.executePaperTrade(nonProfitableSimResult);

            // Portfolio should not change
            expect((strategy as any).virtualPortfolio[WETH_INFO.address].toString()).toBe(initialWethBalance.toString());
            // Firestore should not be called
            expect(mockFirestoreService.logData).not.toHaveBeenCalled();
        });

        it('should handle unknown start token in portfolio by initializing it', async () => {
            const OTHER_TOKEN_ADDRESS = "0xOtherTokenForTest123";
            const mockOpportunityOtherToken: PotentialOpportunity = {
                ...mockOpportunity,
                tokenPath: [ { address: OTHER_TOKEN_ADDRESS, symbol: "OTH", name: "Other", decimals: 18 }, DAI_INFO, { address: OTHER_TOKEN_ADDRESS, symbol: "OTH", name: "Other", decimals: 18 } ],
            } as unknown as PotentialOpportunity;

            const profitableSimResultOtherToken: SimulationResult = {
                ...profitableSimResult,
                opportunity: mockOpportunityOtherToken,
                netProfitBaseToken: ethers.utils.parseUnits("50", 18), // 50 OTH profit
            };

            expect((strategy as any).virtualPortfolio[OTHER_TOKEN_ADDRESS]).toBeUndefined();
            await strategy.executePaperTrade(profitableSimResultOtherToken);

            expect((strategy as any).virtualPortfolio[OTHER_TOKEN_ADDRESS].toString()).toBe(profitableSimResultOtherToken.netProfitBaseToken.toString());
            expect(mockFirestoreService.logData).toHaveBeenCalledTimes(1);
        });

    });

    describe('getPortfolioSnapshot', () => {
        it('should return the current portfolio display', async () => {
            const snapshot = await strategy.getPortfolioSnapshot();
            expect(snapshot[WETH_INFO.address]).toBe("10.0");
            expect(snapshot[DAI_INFO.address]).toBe("5000.0");
        });
    });

    // Test for getAllPaperTrades (optional, as it depends heavily on mock setup for queryCollection)
    // describe('getAllPaperTrades', () => { ... });
});

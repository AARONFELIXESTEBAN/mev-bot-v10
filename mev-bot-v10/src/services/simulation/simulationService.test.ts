import { SimulationService, SimulationResult } from './simulationService';
import { PotentialOpportunity } from '@services/opportunity/opportunityService';
import { ConfigService } from '@core/config/configService';
import { RpcService } from '@core/rpc/rpcService';
import { SmartContractInteractionService } from '@core/smartContract/smartContractService';
import { PriceService } from '@services/price/priceService';
import { TokenInfo, PathSegment } from '@utils/typeUtils';
import { ethers, BigNumber } from 'ethers';

// Mock core services
jest.mock('@core/config/configService');
jest.mock('@core/rpc/rpcService');
jest.mock('@core/smartContract/smartContractService');
jest.mock('@services/price/priceService');

// Mock logger
jest.mock('@core/logger/loggerService', () => ({
    getLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

describe('SimulationService', () => {
    let service: SimulationService;
    let mockConfigService: jest.Mocked<ConfigService>;
    let mockRpcService: jest.Mocked<RpcService>;
    let mockScService: jest.Mocked<SmartContractInteractionService>;
    let mockPriceService: jest.Mocked<PriceService>;

    const WETH_INFO: TokenInfo = { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", name: "Wrapped Ether", decimals: 18 };
    const DAI_INFO: TokenInfo = { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 };

    const mockOpportunity: PotentialOpportunity = {
        id: "opp-123",
        path: [
            { poolAddress: "0xPool1", tokenInAddress: WETH_INFO.address, tokenOutAddress: DAI_INFO.address, dexName: "DEX1", tokenInSymbol: "WETH", tokenOutSymbol: "DAI", tokenInDecimals: 18, tokenOutDecimals: 18 },
            { poolAddress: "0xPool2", tokenInAddress: DAI_INFO.address, tokenOutAddress: WETH_INFO.address, dexName: "DEX2", tokenInSymbol: "DAI", tokenOutSymbol: "WETH", tokenInDecimals: 18, tokenOutDecimals: 18 },
        ],
        entryTokenAddress: WETH_INFO.address,
        entryAmountBase: ethers.utils.parseUnits("1", WETH_INFO.decimals), // Default for tests if not overridden
        sourceTxHash: "0xSourceTx",
        discoveryTimestamp: Date.now() - 1000, // Discovered 1 second ago
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigService = new ConfigService(null as any) as jest.Mocked<ConfigService>;
        mockRpcService = new RpcService(mockConfigService) as jest.Mocked<RpcService>;
        mockScService = new SmartContractInteractionService(mockRpcService, mockConfigService) as jest.Mocked<SmartContractInteractionService>;
        mockPriceService = new PriceService(mockScService, mockConfigService) as jest.Mocked<PriceService>;

        // Default ConfigService mocks for SimulationService constructor and methods
        mockConfigService.get.mockImplementation((key: string) => {
            if (key === 'simulation_service.default_swap_amount_base_token') return "1"; // 1 WETH
            if (key === 'opportunity_service.base_token_decimals') return "18";
            if (key === 'simulation_service.profit_realism_max_percentage') return "50.0";
            if (key === 'simulation_service.max_profit_usd_v10') return "5000.0";
            if (key === 'simulation_service.opportunity_freshness_limit_ms') return "15000"; // 15s
            if (key === 'simulation_service.max_block_age_for_opportunity') return "3";
            if (key === 'simulation_service.default_swap_gas_units') return "200000";
            if (key === 'simulation_service.min_net_profit_base_token_wei') return "100000000000000"; // 0.0001 WETH
             if (key === 'opportunity_service.dex_routers') return {
                "DEX1": "0xRouterDEX1",
                "DEX2": "0xRouterDEX2"
            };
            return undefined;
        });

        service = new SimulationService(mockConfigService, mockRpcService, mockScService, mockPriceService);

        // Mock PriceService for USD price
        mockPriceService.getUsdPrice.mockResolvedValue(2000.0); // $2000 per WETH

        // Mock RpcService for gas price
        mockRpcService.makeRpcCall.mockResolvedValue({ // Mocking the getFeeData call
            gasPrice: ethers.utils.parseUnits("50", "gwei")
        });
    });

    const mockRouterContract = {
        getAmountsOut: jest.fn(),
        // Add other methods if called by SimulationService
    };

    it('should simulate a profitable 2-hop opportunity correctly', async () => {
        mockScService.getContract.mockReturnValue(mockRouterContract as any);

        // Leg 1: 1 WETH -> 2050 DAI
        mockRouterContract.getAmountsOut
            .mockResolvedValueOnce([mockOpportunity.entryAmountBase, ethers.utils.parseUnits("2050", DAI_INFO.decimals)])
        // Leg 2: 2050 DAI -> 1.01 WETH
            .mockResolvedValueOnce([ethers.utils.parseUnits("2050", DAI_INFO.decimals), ethers.utils.parseUnits("1.01", WETH_INFO.decimals)]);

        const result = await service.simulateArbitragePath(mockOpportunity, 100); // currentBlockNumber = 100

        expect(result.isProfitable).toBe(true);
        expect(result.amountInLeg1.toString()).toBe(ethers.utils.parseUnits("1", 18).toString());
        expect(result.amountOutLeg1.toString()).toBe(ethers.utils.parseUnits("2050", 18).toString());
        expect(result.amountOutLeg2.toString()).toBe(ethers.utils.parseUnits("1.01", 18).toString());

        const expectedGrossProfit = ethers.utils.parseUnits("0.01", 18); // 1.01 - 1 = 0.01 WETH
        expect(result.grossProfitBaseToken.toString()).toBe(expectedGrossProfit.toString());

        const gasPrice = ethers.utils.parseUnits("50", "gwei");
        const gasUnitsPerLeg = 200000;
        const expectedGasCost = gasPrice.mul(gasUnitsPerLeg * 2);
        expect(result.estimatedGasCostBaseToken.toString()).toBe(expectedGasCost.toString());

        const expectedNetProfit = expectedGrossProfit.sub(expectedGasCost);
        expect(result.netProfitBaseToken.toString()).toBe(expectedNetProfit.toString());

        const expectedNetProfitUsd = parseFloat(ethers.utils.formatUnits(expectedNetProfit, 18)) * 2000.0;
        expect(result.netProfitUsd).toBeCloseTo(expectedNetProfitUsd);

        expect(result.error).toBeUndefined();
        expect(result.freshnessCheckFailed).toBeFalsy();
        expect(result.blockAgeCheckFailed).toBeFalsy();
        expect(result.profitRealismCheckFailed).toBeFalsy();
    });

    it('should mark as not profitable if net profit is below threshold', async () => {
        mockScService.getContract.mockReturnValue(mockRouterContract as any);
        // Simulate a very small profit that's eaten by gas or below min_net_profit_base_token_wei
        const verySmallGrossProfit = ethers.utils.parseUnits("0.00001", WETH_INFO.decimals); // Smaller than minNetProfitWei
        const finalAmountOut = mockOpportunity.entryAmountBase.add(verySmallGrossProfit);

        mockRouterContract.getAmountsOut
            .mockResolvedValueOnce([mockOpportunity.entryAmountBase, ethers.utils.parseUnits("2000.01", DAI_INFO.decimals)]) // Leg 1
            .mockResolvedValueOnce([ethers.utils.parseUnits("2000.01", DAI_INFO.decimals), finalAmountOut]); // Leg 2

        // Ensure min_net_profit_base_token_wei is effective
        mockConfigService.get.mockImplementation((key: string) => {
            if (key === 'simulation_service.min_net_profit_base_token_wei') return ethers.utils.parseUnits("0.001", 18).toString(); // 0.001 WETH
             // Default mocks from beforeEach for other keys
            if (key === 'simulation_service.default_swap_amount_base_token') return "1";
            if (key === 'opportunity_service.base_token_decimals') return "18";
            if (key === 'simulation_service.profit_realism_max_percentage') return "50.0";
            if (key === 'simulation_service.max_profit_usd_v10') return "5000.0";
            if (key === 'simulation_service.opportunity_freshness_limit_ms') return "15000";
            if (key === 'simulation_service.max_block_age_for_opportunity') return "3";
            if (key === 'simulation_service.default_swap_gas_units') return "200000";
             if (key === 'opportunity_service.dex_routers') return { "DEX1": "0xRouterDEX1", "DEX2": "0xRouterDEX2"};
            return undefined;
        });

        const result = await service.simulateArbitragePath(mockOpportunity, 100);
        expect(result.isProfitable).toBe(false);
        // Net profit might be positive but less than the threshold set by min_net_profit_base_token_wei
        expect(result.netProfitBaseToken.lt(ethers.utils.parseUnits("0.001", 18))).toBe(true);
    });

    it('should fail freshness check if opportunity is too old', async () => {
        const oldOpportunity = { ...mockOpportunity, discoveryTimestamp: Date.now() - 20000 }; // 20s old
        const result = await service.simulateArbitragePath(oldOpportunity, 100);
        expect(result.isProfitable).toBe(false);
        expect(result.freshnessCheckFailed).toBe(true);
    });

    it('should fail block age check if opportunity source tx is too old', async () => {
        const oldTxOpportunity = { ...mockOpportunity, sourceTxBlockNumber: 90 }; // Current block 100, max age 3
         mockConfigService.get.mockImplementation((key: string) => {
            if (key === 'simulation_service.max_block_age_for_opportunity') return "5"; // Max age 5 blocks
            // Default mocks from beforeEach for other keys
            if (key === 'simulation_service.default_swap_amount_base_token') return "1";
            if (key === 'opportunity_service.base_token_decimals') return "18";
            if (key === 'simulation_service.profit_realism_max_percentage') return "50.0";
            if (key === 'simulation_service.max_profit_usd_v10') return "5000.0";
            if (key === 'simulation_service.opportunity_freshness_limit_ms') return "15000";
            if (key === 'simulation_service.default_swap_gas_units') return "200000";
            if (key === 'simulation_service.min_net_profit_base_token_wei') return "100000000000000";
             if (key === 'opportunity_service.dex_routers') return { "DEX1": "0xRouterDEX1", "DEX2": "0xRouterDEX2"};
            return undefined;
        });
        const result = await service.simulateArbitragePath(oldTxOpportunity, 100); // Current block 100
        expect(result.isProfitable).toBe(false);
        expect(result.blockAgeCheckFailed).toBe(true);
    });

    it('should fail profit realism check if profit percentage is too high', async () => {
        mockScService.getContract.mockReturnValue(mockRouterContract as any);
        // Leg 1: 1 WETH -> 2050 DAI
        mockRouterContract.getAmountsOut
            .mockResolvedValueOnce([mockOpportunity.entryAmountBase, ethers.utils.parseUnits("2050", DAI_INFO.decimals)])
        // Leg 2: 2050 DAI -> 1.6 WETH (60% profit, default max is 50%)
            .mockResolvedValueOnce([ethers.utils.parseUnits("2050", DAI_INFO.decimals), ethers.utils.parseUnits("1.6", WETH_INFO.decimals)]);

        const result = await service.simulateArbitragePath(mockOpportunity, 100);
        expect(result.isProfitable).toBe(false);
        expect(result.profitRealismCheckFailed).toBe(true);
    });

    it('should return error if router contract cannot be found', async () => {
        mockScService.getContract.mockReturnValue(null); // Simulate router not found
        const result = await service.simulateArbitragePath(mockOpportunity, 100);
        expect(result.isProfitable).toBe(false);
        expect(result.error).toContain("Router contract(s) not found");
    });

    it('should return error if getAmountsOut fails', async () => {
        mockScService.getContract.mockReturnValue(mockRouterContract as any);
        mockRouterContract.getAmountsOut.mockRejectedValue(new Error("RPC call failed"));
        const result = await service.simulateArbitragePath(mockOpportunity, 100);
        expect(result.isProfitable).toBe(false);
        expect(result.error).toContain("getAmountsOut failed: RPC call failed");
    });

    it('should return error if getFeeData fails', async () => {
        mockScService.getContract.mockReturnValue(mockRouterContract as any);
         mockRouterContract.getAmountsOut // Leg 1
            .mockResolvedValueOnce([mockOpportunity.entryAmountBase, ethers.utils.parseUnits("2050", DAI_INFO.decimals)])
            .mockResolvedValueOnce([ethers.utils.parseUnits("2050", DAI_INFO.decimals), ethers.utils.parseUnits("1.01", WETH_INFO.decimals)]); // Leg 2


        mockRpcService.makeRpcCall.mockResolvedValue(null); // Simulate getFeeData failure
        const result = await service.simulateArbitragePath(mockOpportunity, 100);
        expect(result.isProfitable).toBe(false);
        expect(result.error).toBe("Failed to get gas price.");
    });

});

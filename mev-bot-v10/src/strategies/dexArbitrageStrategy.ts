import { SimulationResult } from '@services/simulation/simulationService';
import { DataCollectionService as FirestoreService } from '@core/dataCollection/firestoreService';
import { getLogger } from '@core/logger/loggerService'; // Removed pino import
import { ethers } from 'ethers';

export interface PaperTrade {
    id: string;
    opportunityPathId: string; // Changed from opportunityPathName to opportunityPathId
    simulatedNetProfitBaseToken: string;
    netProfitUsd: number;
    amountInStartToken: string;
    simulatedAmountOutEndToken: string;
    totalGasCostEstimateBaseToken: string;
    simulationTimestamp: number;
    pathId: string;
}

export class DexArbitrageStrategy {
    private logger: ReturnType<typeof getLogger>; // Use ReturnType to infer logger type
    private firestoreService: FirestoreService;
    private paperTradeCollection: string;
    private virtualPortfolio: { [tokenAddress: string]: ethers.BigNumber };
    private initialPortfolio: { [tokenAddress: string]: string };

    constructor(
        firestoreService: FirestoreService,
        paperTradeCollection: string = 'paper_trades_dex_arb',
        initialPortfolio: { [tokenAddress: string]: string } = { "WETH_ADDRESS_PLACEHOLDER": "10000000000000000000" } // Default 10 WETH
    ) {
        this.logger = getLogger().child({ module: 'DexArbitrageStrategy' });
        this.firestoreService = firestoreService;
        this.paperTradeCollection = paperTradeCollection;
        this.initialPortfolio = initialPortfolio;
        this.virtualPortfolio = {};
        this.resetVirtualPortfolio();
        this.logger.info("DEX Arbitrage Strategy (Paper Trading Module) Initialized.");
        this.logger.info({ initialPortfolio: this.getPortfolioDisplay() }, "Initial Virtual Portfolio");
    }

    resetVirtualPortfolio() {
        this.virtualPortfolio = {};
        for (const token in this.initialPortfolio) {
            this.virtualPortfolio[token] = ethers.BigNumber.from(this.initialPortfolio[token]);
        }
    }

    getPortfolioDisplay(): { [tokenAddress: string]: string } {
        const display: { [tokenAddress: string]: string } = {};
        for (const token in this.virtualPortfolio) {
            display[token] = ethers.utils.formatUnits(this.virtualPortfolio[token], 18); // Assuming 18 decimals
        }
        return display;
    }

    async executePaperTrade(simulation: SimulationResult): Promise<void> {
        if (!simulation.isProfitable) {
            this.logger.info({ pathId: simulation.pathId }, "Strategy: Skipping non-profitable simulation.");
            return;
        }

        const profitAmount = simulation.netProfitBaseToken;
        const startTokenAddress = simulation.opportunity.tokenPath[0].address;

        if (!this.virtualPortfolio[startTokenAddress]) {
            this.virtualPortfolio[startTokenAddress] = ethers.BigNumber.from(0);
        }
        this.virtualPortfolio[startTokenAddress] = this.virtualPortfolio[startTokenAddress].add(profitAmount);

        const baseTokenDecimals = simulation.opportunity.tokenPath[0].decimals;
        const endTokenDecimals = simulation.opportunity.tokenPath[2].decimals;

        const tradeId = `${simulation.pathId}-${simulation.simulationTimestamp}-${ethers.utils.formatUnits(simulation.amountInLeg1, baseTokenDecimals).slice(-6)}`;
        const paperTrade: PaperTrade = {
            id: tradeId,
            opportunityPathId: simulation.pathId, // Changed from opportunityPathName to opportunityPathId
            simulatedNetProfitBaseToken: ethers.utils.formatUnits(simulation.netProfitBaseToken, baseTokenDecimals),
            netProfitUsd: simulation.netProfitUsd,
            amountInStartToken: ethers.utils.formatUnits(simulation.amountInLeg1, baseTokenDecimals),
            simulatedAmountOutEndToken: ethers.utils.formatUnits(simulation.amountOutLeg2, endTokenDecimals),
            totalGasCostEstimateBaseToken: ethers.utils.formatUnits(simulation.estimatedGasCostBaseToken, baseTokenDecimals),
            simulationTimestamp: simulation.simulationTimestamp,
            pathId: simulation.pathId,
        };

        await this.firestoreService.logData(paperTrade, this.paperTradeCollection, paperTrade.id);
        this.logger.info({
            tradeId: paperTrade.id,
            pathId: paperTrade.pathId,
            pathIdLogged: paperTrade.opportunityPathId, // Changed from pathName to pathIdLogged for clarity
            profitBaseToken: paperTrade.simulatedNetProfitBaseToken,
            netProfitUsd: paperTrade.netProfitUsd,
            startToken: startTokenAddress,
            newBalance: ethers.utils.formatUnits(this.virtualPortfolio[startTokenAddress], baseTokenDecimals)
        }, "Strategy: Paper trade executed.");
    }

    async getPortfolioSnapshot(): Promise<{ [tokenAddress: string]: string }> {
        return this.getPortfolioDisplay();
    }

    async getAllPaperTrades(): Promise<PaperTrade[]> {
        const mainCollectionName = this.firestoreService.getMainCollectionName();
        const fullCollectionPath = `${mainCollectionName}/${this.paperTradeCollection}`;
        const trades = await this.firestoreService.queryCollection(
            fullCollectionPath,
            (ref: any) => ref.orderBy('simulationTimestamp', 'desc').limit(100)
        );
        return trades as PaperTrade[];
    }
}
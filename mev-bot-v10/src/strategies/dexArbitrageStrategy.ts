// Placeholder for DEX Arbitrage Strategy Logic (including Paper Trading Module)
import { SimulationResult } from '@services/simulation/simulationService'; // Updated path
import { DataCollectionService as FirestoreService } from '@core/dataCollection/firestoreService'; // Updated import and aliased
import { getLogger } from '@core/logger/loggerService'; // Changed logger import
import { type Logger as PinoLogger } from 'pino'; // Added PinoLogger type import
import { ethers } from 'ethers';

export interface PaperTrade {
    id: string;
    opportunityId: string; // Changed from opportunityPathName
    simulatedNetProfitBaseToken: string; // Store formatted string from simulation.netProfitBaseToken
    netProfitUsd: number; // from simulation.netProfitUsd
    amountInStartToken: string; // Store formatted string from simulation.opportunity.estimatedAmountInStartToken or simulation.amountInLeg1
    simulatedAmountOutEndToken: string; // Store formatted string from simulation.amountOutLeg2
    totalGasCostEstimateBaseToken: string; // Store formatted string from simulation.estimatedGasCostBaseToken
    simulationTimestamp: number; // from simulation.simulationTimestamp
    pathId: string; // from simulation.pathId
}

export class DexArbitrageStrategy {
    private logger: PinoLogger; // Changed logger type to PinoLogger
    private firestoreService: FirestoreService; // Type remains FirestoreService due to alias
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
            this.logger.info({ opportunityId: simulation.opportunity.id, pathId: simulation.pathId }, "Strategy: Skipping non-profitable simulation.");
            return;
        }

        const profitAmount = simulation.netProfitBaseToken;
        // Correctly access path and then segment details
        const startTokenSegment = simulation.opportunity.path[0];
        const endTokenSegment = simulation.opportunity.path[simulation.opportunity.path.length - 1]; // Last segment for end token

        const startTokenAddress = startTokenSegment.tokenInAddress; // Address of the first token in the path

        if (!this.virtualPortfolio[startTokenAddress]) {
            this.virtualPortfolio[startTokenAddress] = ethers.BigNumber.from(0);
        }
        this.virtualPortfolio[startTokenAddress] = this.virtualPortfolio[startTokenAddress].add(profitAmount);

        const baseTokenDecimals = startTokenSegment.tokenInDecimals; // Decimals of the first token
        const endTokenDecimals = endTokenSegment.tokenOutDecimals; // Decimals of the last token in the path
        const tradeId = `${simulation.opportunity.id}-${simulation.simulationTimestamp}-${ethers.utils.formatUnits(simulation.amountInLeg1, baseTokenDecimals).slice(-6)}`;
        const paperTrade: PaperTrade = {
            id: tradeId,
            opportunityId: simulation.opportunity.id,
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
            opportunityIdLogged: paperTrade.opportunityId, // Corrected property name
            pathId: paperTrade.pathId,
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
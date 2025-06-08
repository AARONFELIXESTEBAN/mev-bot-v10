// Placeholder for DEX Arbitrage Strategy Logic (including Paper Trading Module)
import { SimulationResult } from '../services/simulation/simulationService'; // Adjust path
import { DataCollectionService } from '../core/dataCollection/firestoreService'; // Changed import name
import { ethers, BigNumber } from 'ethers'; // Added BigNumber
import { TokenInfo } from '../utils/typeUtils'; // For startToken type

export interface PaperTrade {
    id: string; // e.g., simulation hash or unique trade ID
    opportunityPathName: string;
    opportunityId: string; // from SimulationResult.opportunity.id
    sourceTxHash: string; // from SimulationResult.opportunity.sourceTxHash
    amountInStartToken: string; // Amount of the token the arbitrage started with
    simulatedAmountOutEndToken: string; // Final amount of token the arbitrage ended with (usually same as start token)
    simulatedNetProfitBaseToken: string; // Net profit in base token (e.g., WETH)
    simulatedNetProfitUsd: number;
    totalGasCostEstimateBaseToken: string;
    simulationTimestamp: number; // Timestamp from the simulation
    tokenPath: {symbol: string, address: string}[]; // Simplified from TokenInfo for logging
    leg1DexName: string;
    leg2DexName: string;
}

export class DexArbitrageStrategy {
    private firestoreService: DataCollectionService; // Changed type annotation
    private paperTradeCollection: string;
    // Virtual portfolio - simple version for MVP
    private virtualPortfolio: { [tokenAddress: string]: ethers.BigNumber };
    private initialPortfolio: { [tokenAddress: string]: string }; // Initial amounts as strings

    constructor(
        firestoreService: DataCollectionService, // Changed type annotation
        paperTradeCollection: string = 'paper_trades_dex_arb',
        // Example initial portfolio: { "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": "10000000000000000000" } for 10 WETH
        initialPortfolio: { [tokenAddress: string]: string } = {}
    ) {
        this.firestoreService = firestoreService;
        this.paperTradeCollection = paperTradeCollection;
        this.initialPortfolio = initialPortfolio;
        this.virtualPortfolio = {};
        this.resetVirtualPortfolio();
        console.log("DEX Arbitrage Strategy (Paper Trading Module) Initialized.");
        if (Object.keys(this.initialPortfolio).length > 0) {
            console.log("Initial Virtual Portfolio:", this.getPortfolioDisplay());
        } else {
            console.warn("Paper trading portfolio initialized empty. Configure INITIAL_PORTFOLIO in config.");
        }
    }

    resetVirtualPortfolio() {
        this.virtualPortfolio = {};
        for (const tokenAddress in this.initialPortfolio) {
            if (ethers.utils.isAddress(tokenAddress)) { // Ensure key is an address
                 this.virtualPortfolio[tokenAddress.toLowerCase()] = ethers.BigNumber.from(this.initialPortfolio[tokenAddress]);
            }
        }
    }

    getPortfolioDisplay(): { [tokenAddress: string]: string } {
        const display: { [tokenAddress: string]: string } = {};
        for (const tokenAddress in this.virtualPortfolio) {
            // Assuming 18 decimals for display simplicity here, ideally fetch from TokenInfo
            display[tokenAddress] = ethers.utils.formatUnits(this.virtualPortfolio[tokenAddress], 18);
        }
        return display;
    }

    async executePaperTrade(simulation: SimulationResult): Promise<void> {
        if (!simulation.isProfitable) {
            console.log(`Strategy: Skipping non-profitable simulation for ${simulation.opportunity.pathName}.`);
            return;
        }

        const profitAmount = simulation.netProfitBaseToken; // Already a BigNumber
        // Assuming tokenPath[0] is the start token and tokenPath[2] is the end token (which should be same as start for 2-hop A->B->A)
        const startTokenAddress = simulation.opportunity.tokenPath[0].address.toLowerCase();
        const startTokenDecimals = simulation.opportunity.tokenPath[0].decimals;


        if (!this.virtualPortfolio[startTokenAddress]) {
            this.virtualPortfolio[startTokenAddress] = ethers.BigNumber.from(0);
            console.warn(`Strategy: Token ${startTokenAddress} was not in initial paper portfolio. Starting its balance at 0.`);
        }
        this.virtualPortfolio[startTokenAddress] = this.virtualPortfolio[startTokenAddress].add(profitAmount);

        // Using simulationTimestamp for uniqueness in tradeId if multiple ops for same path occur closely
        const tradeId = `${simulation.opportunity.id}-${simulation.simulationTimestamp}`;

        const paperTradeData: PaperTrade = {
            id: tradeId,
            opportunityPathName: simulation.opportunity.pathName,
            opportunityId: simulation.opportunity.id,
            sourceTxHash: simulation.opportunity.sourceTxHash,
            amountInStartToken: simulation.amountInLeg1.toString(),
            simulatedAmountOutEndToken: simulation.amountOutLeg2.toString(),
            simulatedNetProfitBaseToken: simulation.netProfitBaseToken.toString(),
            simulatedNetProfitUsd: simulation.netProfitUsd,
            totalGasCostEstimateBaseToken: simulation.estimatedGasCostBaseToken.toString(),
            simulationTimestamp: simulation.simulationTimestamp,
            tokenPath: simulation.opportunity.tokenPath.map(t => ({ symbol: t.symbol, address: t.address})),
            leg1DexName: simulation.opportunity.leg1.dexName,
            leg2DexName: simulation.opportunity.leg2.dexName,
        };

        await this.firestoreService.logData(paperTradeData, this.paperTradeCollection, paperTradeData.id);

        const formattedProfit = ethers.utils.formatUnits(profitAmount, startTokenDecimals);
        const newBalance = ethers.utils.formatUnits(this.virtualPortfolio[startTokenAddress], startTokenDecimals);

        console.log(`Strategy: Paper trade executed for ${paperTradeData.opportunityPathName}. Profit: ${formattedProfit} ${simulation.opportunity.tokenPath[0].symbol}. New Balance (${startTokenAddress}): ${newBalance} ${simulation.opportunity.tokenPath[0].symbol}`);
    }

    async getPortfolioSnapshot(): Promise<{ [tokenAddress: string]: string }> {
        return this.getPortfolioDisplay();
    }

    async getAllPaperTrades(limit: number = 100): Promise<PaperTrade[]> {
        const trades = await this.firestoreService.queryCollection(
            this.paperTradeCollection,
            ref => ref.orderBy('simulationTimestamp', 'desc').limit(limit)
        );
        return trades as PaperTrade[];
    }
}

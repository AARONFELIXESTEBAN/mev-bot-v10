import { ethers } from 'ethers';
import { SimulationResult } from '@services/simulation/simulationService';
import { DataCollectionService as FirestoreService } from '@core/dataCollection/firestoreService';
import { getLogger, PinoLogger } from '@core/logger/loggerService';
import { PotentialOpportunity } from '@shared/types';

export interface PaperTrade {
  id: string;
  opportunityId: string;
  simulatedNetProfitBaseToken: string;
  netProfitUsd: number;
  amountInStartToken: string;
  simulatedAmountOutEndToken: string;
  totalGasCostEstimateBaseToken: string;
  simulationTimestamp: number;
  pathId: string;
}

// Define SimulationResult interface (based on usage)
export interface SimulationResult {
  isProfitable: boolean;
  opportunity: PotentialOpportunity;
  netProfitBaseToken: ethers.BigNumberish;
  netProfitUsd: number;
  amountInLeg1: ethers.BigNumberish;
  amountOutLeg2: ethers.BigNumberish;
  estimatedGasCostBaseToken: ethers.BigNumberish;
  simulationTimestamp: number;
  pathId: string;
}

export class DexArbitrageStrategy {
  private logger: PinoLogger;
  private firestoreService: FirestoreService;
  private paperTradeCollection: string;
  private virtualPortfolio: { [tokenAddress: string]: bigint };
  private initialPortfolio: { [tokenAddress: string]: string };

  constructor(
    firestoreService: FirestoreService,
    paperTradeCollection: string = 'paper_trades_dex_arb',
    initialPortfolio: { [tokenAddress: string]: string } = {
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": "10000000000000000000" // 10 WETH (mainnet address)
    }
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
      this.virtualPortfolio[token] = BigInt(this.initialPortfolio[token]);
    }
  }

  getPortfolioDisplay(): { [tokenAddress: string]: string } {
    const display: { [tokenAddress: string]: string } = {};
    for (const token in this.virtualPortfolio) {
      display[token] = ethers.formatUnits(this.virtualPortfolio[token], 18); // Assuming 18 decimals
    }
    return display;
  }

  async executePaperTrade(simulation: SimulationResult): Promise<void> {
    if (!simulation.isProfitable) {
      this.logger.info({ opportunityId: simulation.opportunity.id, pathId: simulation.pathId }, "Strategy: Skipping non-profitable simulation.");
      return;
    }

    const profitAmount = BigInt(simulation.netProfitBaseToken);
    const startTokenSegment = simulation.opportunity.path[0];
    const endTokenSegment = simulation.opportunity.path[simulation.opportunity.path.length - 1];

    const startTokenAddress = startTokenSegment.tokenInAddress;

    if (!this.virtualPortfolio[startTokenAddress]) {
      this.virtualPortfolio[startTokenAddress] = 0n;
    }
    this.virtualPortfolio[startTokenAddress] += profitAmount;

    const baseTokenDecimals = startTokenSegment.tokenInDecimals;
    const endTokenDecimals = endTokenSegment.tokenOutDecimals;
    const tradeId = `${simulation.opportunity.id}-${simulation.simulationTimestamp}-${ethers.formatUnits(simulation.amountInLeg1, baseTokenDecimals).slice(0, 8)}`;
    const paperTrade: PaperTrade = {
      id: tradeId,
      opportunityId: simulation.opportunity.id,
      simulatedNetProfitBaseToken: ethers.formatUnits(simulation.netProfitBaseToken, baseTokenDecimals),
      netProfitUsd: simulation.netProfitUsd,
      amountInStartToken: ethers.formatUnits(simulation.amountInLeg1, baseTokenDecimals),
      simulatedAmountOutEndToken: ethers.formatUnits(simulation.amountOutLeg2, endTokenDecimals),
      totalGasCostEstimateBaseToken: ethers.formatUnits(simulation.estimatedGasCostBaseToken, baseTokenDecimals),
      simulationTimestamp: simulation.simulationTimestamp,
      pathId: simulation.pathId,
    };

    try {
      await this.firestoreService.logData(paperTrade, this.paperTradeCollection, paperTrade.id);
      this.logger.info(
        {
          tradeId: paperTrade.id,
          opportunityId: paperTrade.opportunityId,
          pathId: paperTrade.pathId,
          profitBaseToken: paperTrade.simulatedNetProfitBaseToken,
          netProfitUsd: paperTrade.netProfit,
          startToken: startTokenAddress,
          newBalance: ethers.formatUnits(this.virtualPortfolio[startTokenAddress], baseTokenDecimals)
        },
        "Strategy: Paper trade executed."
      );
    } catch (error: any) {
      this.logger.error({ err: error.message, tradeId }, "Failed to log paper trade.");
    }
  }

  async getPortfolioSnapshot(): Promise<{ [tokenAddress: string]: string }> {
    return this.getPortfolioDisplay();
  }

  async getAllPaperTrades(): Promise<PaperTrade[]> {
    try {
      const mainCollectionName = this.firestoreService.getMainCollectionName();
      const fullCollectionPath = `${mainCollectionName}/${this.paperTradeCollection}`;
      const trades = await this.firestoreService.queryCollection(
        fullCollectionPath,
        (ref: any) => ref.orderBy('simulationTimestamp', 'desc').limit(100)
      );
      return trades as PaperTrade[];
    } catch (error: any) {
      this.logger.error({ err: error.message }, "Failed to fetch paper trades.");
      return [];
    }
  }
}
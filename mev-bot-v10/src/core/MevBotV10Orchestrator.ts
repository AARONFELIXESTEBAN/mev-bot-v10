import WebSocket from 'ws';
import { ethers } from 'ethers';

import { ConfigService, AppConfig } from './config/configService';
import { initializeLogger, getLogger, pino } from './logger/loggerService';
import { RpcService } from './rpc/rpcService';
import { KmsService } from './kms/kmsService';
import { DataCollectionService } from './dataCollection/firestoreService'; // Assuming this is the correct name
import { SmartContractInteractionService } from './smartContract/smartContractService';

import { PriceService } from '../services/price/priceService';
import { OpportunityIdentificationService, ProcessedMempoolTransaction, PotentialOpportunity } from '../services/opportunity/opportunityService';
import { SimulationService, SimulationResult } from '../services/simulation/simulationService';
import { DexArbitrageStrategy } from '../strategies/dexArbitrageStrategy'; // Paper Trading Logic
import { TokenInfo } from '../interfaces/appConfig.interface'; // Assuming TokenInfo might be moved or duplicated there for config

let logger: pino.Logger; // Will be initialized after config

const DEFAULT_RECONNECT_INTERVAL_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

export class MevBotV10Orchestrator {
    private configService: ConfigService;
    private rpcService: RpcService;
    private kmsService: KmsService; // Initialized but may not be used in paper trading
    private dataCollectionService: DataCollectionService;
    private scService: SmartContractInteractionService;
    private priceService: PriceService;
    private opportunityService: OpportunityIdentificationService;
    private simulationService: SimulationService;
    private paperTradingStrategy: DexArbitrageStrategy;

    private mempoolWsClient: WebSocket | null = null;
    private mempoolWsUrl: string;
    private reconnectAttempts: number = 0;
    private explicitlyStopped: boolean = false;
    private currentBlockNumber: number = 0; // Periodically updated
    private blockUpdateIntervalId?: NodeJS.Timeout;


    constructor() {
        this.configService = new ConfigService();
        // Logger needs to be initialized after config is loaded, especially for log level
        logger = initializeLogger(this.configService.get('NODE_ENV') === 'development' ?
            { logLevel: this.configService.get('LOG_LEVEL') || 'info', nodeEnv: 'development'} :
            { logLevel: this.configService.get('LOG_LEVEL') || 'info', nodeEnv: 'production'}
        );

        logger.info("MevBotV10Orchestrator: Initializing services...");

        this.rpcService = new RpcService(this.configService);
        this.kmsService = new KmsService(this.configService);
        this.dataCollectionService = new DataCollectionService(this.configService);
        this.scService = new SmartContractInteractionService(this.rpcService);
        this.priceService = new PriceService(this.scService, this.configService);

        this.opportunityService = new OpportunityIdentificationService(this.configService, this.priceService, this.scService);

        this.simulationService = new SimulationService(this.configService, this.rpcService, this.scService, this.priceService);

        const initialPortfolioConfig = this.configService.getInitialPortfolio();
        const paperTradeCollection = this.configService.get('FIRESTORE_PAPER_TRADE_COLLECTION') || 'paper_trades_v10_dex_arb';
        this.paperTradingStrategy = new DexArbitrageStrategy(
            this.dataCollectionService,
            paperTradeCollection,
            initialPortfolioConfig
        );

        this.mempoolWsUrl = this.configService.getOrThrow('MEV_BOT_MEMPOOL_WS_URL');
        logger.info("MevBotV10Orchestrator: All services initialized.");
    }

    public async start(): Promise<void> {
        logger.info("MevBotV10Orchestrator: Starting...");
        if (this.configService.isProduction()) {
            await this.configService.loadSecretsFromGcp();
            logger.info("Production mode: Secrets loaded/checked.");
            // Potentially re-initialize services if secrets changed critical configs they depend on directly
            // For instance, if RPC URLs or KMS path were loaded from secrets and not available as env vars initially.
            // This example assumes initial ENV VARS are sufficient or services will pick up new values from ConfigService if they re-query.
        }

        this.explicitlyStopped = false;
        this.connectToMempoolService();
        this.startBlockNumberUpdates();

        logger.info("MevBotV10Orchestrator: Started. Connecting to mempool stream and monitoring blocks.");
    }

    private startBlockNumberUpdates(): void {
        // Clear existing interval if any (e.g. during a restart)
        if (this.blockUpdateIntervalId) {
            clearInterval(this.blockUpdateIntervalId);
        }
        this.updateCurrentBlockNumber(); // Initial fetch
        const intervalMs = parseInt(this.configService.get('BLOCK_UPDATE_INTERVAL_MS') || '12000');
        this.blockUpdateIntervalId = setInterval(async () => {
            await this.updateCurrentBlockNumber();
        }, intervalMs);
    }

    private async updateCurrentBlockNumber(): Promise<void> {
        try {
            const block = await this.rpcService.makeRpcCall('mainnet', 'http', p => p.getBlockNumber());
            if (block !== null && block !== undefined) {
                if (block !== this.currentBlockNumber) {
                    this.currentBlockNumber = block;
                    logger.info(`Current block number updated: ${this.currentBlockNumber}`);
                    // Optionally emit an event here if other services need to react to new blocks
                    // this.emit('newBlock', this.currentBlockNumber);
                }
            } else {
                logger.warn("Failed to fetch current block number (RPC call returned null/undefined).");
            }
        } catch (error) {
            logger.error({ err: error }, "Error updating current block number.");
        }
    }


    private connectToMempoolService(): void {
        if (this.explicitlyStopped) {
            logger.info("MevBotV10Orchestrator: Explicitly stopped, not connecting to mempool service.");
            return;
        }
        if (this.mempoolWsClient && (this.mempoolWsClient.readyState === WebSocket.OPEN || this.mempoolWsClient.readyState === WebSocket.CONNECTING)) {
            logger.info("MevBotV10Orchestrator: Already connected or connecting to mempool service.");
            return;
        }

        this.reconnectAttempts = this.reconnectAttempts || 0; // Ensure it's initialized
        logger.info(`MevBotV10Orchestrator: Connecting to mempool service at ${this.mempoolWsUrl} (Attempt ${this.reconnectAttempts + 1})`);
        this.mempoolWsClient = new WebSocket(this.mempoolWsUrl);

        this.mempoolWsClient.on('open', () => {
            logger.info(`MevBotV10Orchestrator: Connected to mempool service at ${this.mempoolWsUrl}`);
            this.reconnectAttempts = 0;
        });

        this.mempoolWsClient.on('message', (data: WebSocket.Data) => {
            this.onMempoolMessage(data.toString());
        });

        this.mempoolWsClient.on('close', (code: number, reason: Buffer) => {
            logger.warn(`MevBotV10Orchestrator: Disconnected from mempool service. Code: ${code}, Reason: ${reason.toString()}`);
            this.handleMempoolWsDisconnect();
        });

        this.mempoolWsClient.on('error', (error: Error) => {
            logger.error({ err: error }, `MevBotV10Orchestrator: Error with mempool service connection at ${this.mempoolWsUrl}`);
             if (this.mempoolWsClient && this.mempoolWsClient.readyState !== WebSocket.OPEN && this.mempoolWsClient.readyState !== WebSocket.CONNECTING) {
                this.handleMempoolWsDisconnect(); // Ensure disconnect handler is called if not already closed
            }
        });
    }

    private handleMempoolWsDisconnect(): void {
        if (this.mempoolWsClient) {
            this.mempoolWsClient.removeAllListeners();
            // Ensure terminate is called if it's not already closed, to clean up resources
            if (this.mempoolWsClient.readyState !== WebSocket.CLOSED) {
                this.mempoolWsClient.terminate();
            }
            this.mempoolWsClient = null;
        }

        if (this.explicitlyStopped) {
            logger.info("MevBotV10Orchestrator: Explicitly stopped, will not reconnect to mempool service.");
            return;
        }

        const maxAttempts = parseInt(this.configService.get('MEMPOOL_MAX_RECONNECT_ATTEMPTS') || `${MAX_RECONNECT_ATTEMPTS}`);
        if (this.reconnectAttempts < maxAttempts) {
            this.reconnectAttempts++;
            const delay = parseInt(this.configService.get('MEMPOOL_RECONNECT_INTERVAL_MS') || `${DEFAULT_RECONNECT_INTERVAL_MS}`);
            logger.info(`MevBotV10Orchestrator: Attempting to reconnect to mempool service in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${maxAttempts})...`);
            setTimeout(() => this.connectToMempoolService(), delay);
        } else {
            logger.error(`MevBotV10Orchestrator: Max reconnect attempts (${maxAttempts}) to mempool service reached. Stopping further attempts.`);
        }
    }

    private async onMempoolMessage(messageData: string): Promise<void> {
        try {
            const message = JSON.parse(messageData) as any; // Define a proper type for MempoolEventBroadcast
            logger.trace({ type: message.type }, "MevBotV10Orchestrator: Received message from mempool service.");

            if (message.type === 'decoded_transaction' || message.type === 'transaction') {
                const mempoolTxPayload = message.payload as any;

                const processedTx: ProcessedMempoolTransaction = {
                    // Ensure mapping from mempoolTxPayload to ProcessedMempoolTransaction fields
                    // This requires knowing the exact structure of mempoolTxPayload from the mempool-ingestion-service
                    hash: mempoolTxPayload.hash, // Assuming 'hash' exists directly
                    to: mempoolTxPayload.to,     // Assuming 'to' (router address) exists
                    from: mempoolTxPayload.from,
                    // The following are from DecodedMempoolSwap structure, which includes DecodedTransactionInput
                    txHash: mempoolTxPayload.hash, // Redundant with 'hash', choose one
                    routerName: mempoolTxPayload.decodedInput?.routerName || "UnknownRouter",
                    routerAddress: mempoolTxPayload.to || "0x",
                    functionName: mempoolTxPayload.decodedInput?.functionName || "UnknownFunction",
                    path: mempoolTxPayload.decodedInput?.path || [],
                    amountIn: mempoolTxPayload.decodedInput?.amountIn ? ethers.BigNumber.from(mempoolTxPayload.decodedInput.amountIn) : undefined,
                    amountOutMin: mempoolTxPayload.decodedInput?.amountOutMin ? ethers.BigNumber.from(mempoolTxPayload.decodedInput.amountOutMin) : undefined,
                    amountOut: mempoolTxPayload.decodedInput?.amountOut ? ethers.BigNumber.from(mempoolTxPayload.decodedInput.amountOut) : undefined,
                    amountInMax: mempoolTxPayload.decodedInput?.amountInMax ? ethers.BigNumber.from(mempoolTxPayload.decodedInput.amountInMax) : undefined,
                    recipient: mempoolTxPayload.decodedInput?.to || mempoolTxPayload.from,
                    txTimestamp: message.timestamp || Date.now(),
                    gasPrice: mempoolTxPayload.gasPrice?.toString(), // Ensure gasPrice is string
                    blockNumber: mempoolTxPayload.blockNumber,
                    // Ensure other fields of ProcessedMempoolTransaction are mapped
                    decodedInput: mempoolTxPayload.decodedInput // Keep the nested structure
                };

                if (!ethers.utils.isAddress(processedTx.routerAddress) || !processedTx.decodedInput || processedTx.decodedInput.path.length < 2) {
                    logger.trace({txHash: processedTx.txHash}, "Skipping mempool message due to invalid router address or path in decodedInput.");
                    return;
                }

                const opportunities = await this.opportunityService.identifyOpportunitiesFromMempoolTx(processedTx);

                for (const opp of opportunities) {
                    if (this.currentBlockNumber === 0) {
                        logger.warn({pathId: opp.id}, "Current block number unknown, cannot perform block age freshness check. Simulating with relaxed check.");
                    }
                    const simulationResult = await this.simulationService.simulateArbitragePath(opp, this.currentBlockNumber);
                    await this.processSimulationResult(simulationResult);
                }
            }
        } catch (error) {
            logger.error({ err: error, rawMessage: messageData }, "MevBotV10Orchestrator: Error processing message from mempool service.");
        }
    }

    private async processSimulationResult(simResult: SimulationResult): Promise<void> {
        const minProfitUsd = parseFloat(this.configService.get('MIN_PROFIT_USD_V10') || '1.0');
        const paperTradingMode = this.configService.get('PAPER_TRADING_MODE') === 'true';
        const executionEnabled = this.configService.get('EXECUTION_ENABLED') === 'false'; // Default to false for safety

        let discardReason = "";

        if (simResult.error) discardReason = `Simulation error: ${simResult.error}`;
        else if (simResult.freshnessCheckFailed) discardReason = "Freshness check failed (too old)";
        else if (simResult.blockAgeCheckFailed && this.currentBlockNumber !== 0) discardReason = "Block age check failed (source tx too deep)"; // Only if currentBlockNumber is known
        else if (simResult.profitRealismCheckFailed) discardReason = "Profit realism check failed (profit % too high)";
        else if (simResult.maxProfitUsdCheckFailed) discardReason = "Max profit USD check failed (profit USD too high)";
        else if (!simResult.isProfitable) discardReason = "Not profitable after simulation";
        else if (simResult.netProfitUsd < minProfitUsd) discardReason = `Net profit USD ${simResult.netProfitUsd.toFixed(2)} is less than min threshold $${minProfitUsd.toFixed(2)}`;

        if (discardReason) {
            logger.info({ pathId: simResult.pathId, reason: discardReason, netProfitUSD: simResult.netProfitUsd?.toFixed(2) }, "Opportunity discarded.");
            if (this.configService.get('LOG_DISCARDED_OPPORTUNITIES') === 'true') {
                await this.dataCollectionService.logData({
                    type: "discarded_opportunity",
                    pathId: simResult.pathId,
                    reason: discardReason,
                    simulation: simResult, // Log full simulation for analysis
                }, "discarded_opportunities_v10", `discarded-${simResult.pathId}-${simResult.simulationTimestamp}`);
            }
            return;
        }

        logger.info({
            pathId: simResult.pathId,
            netProfitBase: ethers.utils.formatUnits(simResult.netProfitBaseToken, this.baseTokenDetails.decimals),
            netProfitUsd: simResult.netProfitUsd.toFixed(2),
        }, "Profitable opportunity identified and passed all checks!");

        if (paperTradingMode && !executionEnabled) {
            logger.info({ pathId: simResult.pathId }, "Paper trading mode: Logging paper trade.");
            await this.paperTradingStrategy.executePaperTrade(simResult);
        } else if (executionEnabled) {
            logger.warn({ pathId: simResult.pathId }, "Execution mode enabled but actual trade execution logic is NOT IMPLEMENTED in this MVP.");
            // TODO: Implement actual trade execution logic using KmsService and RpcService.
        } else {
            logger.info({ pathId: simResult.pathId }, "Not in paper trading mode or execution disabled. Opportunity details logged if it passed checks.");
        }
    }

    private get baseTokenDetails(): TokenInfo {
        return {
            address: this.configService.getOrThrow('BASE_TOKEN_ADDRESS'),
            symbol: this.configService.get('BASE_TOKEN_SYMBOL') || 'WETH',
            decimals: parseInt(this.configService.get('BASE_TOKEN_DECIMALS') || '18'),
            name: this.configService.get('BASE_TOKEN_SYMBOL') || 'Wrapped Ether' // Name might not be in config, default
        };
    }

    public async stop(): Promise<void> {
        logger.info("MevBotV10Orchestrator: Stopping...");
        this.explicitlyStopped = true;

        if (this.blockUpdateIntervalId) {
            clearInterval(this.blockUpdateIntervalId);
            this.blockUpdateIntervalId = undefined;
        }

        if (this.mempoolWsClient) {
            this.mempoolWsClient.removeAllListeners();
            if (this.mempoolWsClient.readyState === WebSocket.OPEN || this.mempoolWsClient.readyState === WebSocket.CONNECTING) {
                this.mempoolWsClient.close(1000, "Orchestrator shutting down");
            }
            this.mempoolWsClient = null; // Important to allow GC and prevent reuse
            logger.info("MevBotV10Orchestrator: Mempool WebSocket client connection closed.");
        }

        // Attempt to close RPC WebSocket providers if RpcService exposes such a method
        // For ethers v5, WebSocketProvider instances have a 'terminate()' method.
        const mainnetWsProvider = this.rpcService.getWebSocketProvider('mainnet');
        if (mainnetWsProvider && typeof mainnetWsProvider.terminate === 'function') {
            mainnetWsProvider.terminate();
            logger.info("MevBotV10Orchestrator: Terminated mainnet WebSocket RPC provider.");
        }
        const sepoliaWsProvider = this.rpcService.getWebSocketProvider('sepolia');
        if (sepoliaWsProvider && typeof sepoliaWsProvider.terminate === 'function') {
            sepoliaWsProvider.terminate();
            logger.info("MevBotV10Orchestrator: Terminated sepolia WebSocket RPC provider.");
        }
        // Add for other networks if used

        logger.info("MevBotV10Orchestrator: Stopped.");
    }
}

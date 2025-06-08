import WebSocket from 'ws';
import { ethers } from 'ethers';
import { type Logger as PinoLogger } from 'pino';

import { ConfigService, AppConfig } from './config/configService';
import { initializeLogger, getLogger } from './logger/loggerService';
import { RpcService } from './rpc/rpcService';
import { KmsService } from './kms/kmsService';
import { DataCollectionService } from './dataCollection/firestoreService'; // Assuming this is the correct name
import { SmartContractInteractionService } from './smartContract/smartContractService';

import { PriceService } from '../services/price/priceService';
import { OpportunityIdentificationService, ProcessedMempoolTransaction, PotentialOpportunity } from '../services/opportunity/opportunityService';
import { SimulationService, SimulationResult } from '../services/simulation/simulationService';
import { FilterableTransaction } from '../../shared/types';
import { DexArbitrageStrategy } from '../strategies/dexArbitrageStrategy'; // Paper Trading Logic
import { TokenInfo } from '../utils/typeUtils';

let logger: PinoLogger; // Will be initialized after config

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

    constructor() {
        this.configService = new ConfigService();
        // Logger needs to be initialized after config is loaded, especially for log level
        // For now, getLogger() might return a default logger if not initialized.
        // A proper init sequence in main.ts would handle this.
        logger = initializeLogger(this.configService.get('node_env') === 'development' ?
            { logLevel: this.configService.get('log_level') || 'info', nodeEnv: 'development'} :
            { logLevel: this.configService.get('log_level') || 'info', nodeEnv: 'production'}
        );

        logger.info("MevBotV10Orchestrator: Initializing services...");

        this.rpcService = new RpcService(this.configService);
        this.kmsService = new KmsService(this.configService); // Will throw if KMS_KEY_PATH not set
        this.dataCollectionService = new DataCollectionService(this.configService);
        this.scService = new SmartContractInteractionService(this.rpcService);
        this.priceService = new PriceService(this.scService, this.configService);

        // OpportunityIdentificationService needs PriceService and SCService (for token details)
        this.opportunityService = new OpportunityIdentificationService(this.configService, this.priceService, this.scService);

        this.simulationService = new SimulationService(this.configService, this.rpcService, this.scService, this.priceService);
        this.paperTradingStrategy = new DexArbitrageStrategy(this.dataCollectionService,
            (this.configService.get('paper_trading_config.firestore_collection_paper_trades') as string | undefined) || 'paper_trades_v10_dex_arb',
            (this.configService.get('paper_trading_config.initial_portfolio') as { [tokenAddress: string]: string } | undefined) || undefined
        );

        this.mempoolWsUrl = this.configService.getOrThrow('mempool_ingestion.publisher_url') as string;
        logger.info("MevBotV10Orchestrator: All services initialized.");
    }

    public async start(): Promise<void> {
        logger.info("MevBotV10Orchestrator: Starting...");
        if (this.configService.isProduction()) {
            await this.configService.loadSecretsFromGcp();
            // Re-initialize services that depend on late-loaded secrets if necessary
            // For now, assuming critical secrets are available as ENV VARS even in prod for simplicity,
            // or services are designed to pick up changes from ConfigService.
            logger.info("Production mode: Secrets loaded/checked.");
        }

        this.explicitlyStopped = false;
        this.connectToMempoolService();
        this.startBlockNumberUpdates();

        logger.info("MevBotV10Orchestrator: Started. Connecting to mempool stream and monitoring blocks.");
    }

    private startBlockNumberUpdates(): void {
        this.updateCurrentBlockNumber(); // Initial fetch
        setInterval(async () => {
            await this.updateCurrentBlockNumber();
        }, parseInt((this.configService.get('orchestrator.block_update_interval_ms') as string | undefined) || '12000')); // e.g., every 12 seconds
    }

    private async updateCurrentBlockNumber(): Promise<void> {
        try {
            const block = await this.rpcService.makeRpcCall('mainnet', 'http', p => p.getBlockNumber());
            if (block !== null && block !== undefined) {
                if (block !== this.currentBlockNumber) {
                    this.currentBlockNumber = block;
                    logger.info(`Current block number updated: ${this.currentBlockNumber}`);
                }
            } else {
                logger.warn("Failed to fetch current block number.");
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

        logger.info(`MevBotV10Orchestrator: Connecting to mempool service at ${this.mempoolWsUrl} (Attempt ${this.reconnectAttempts + 1})`);
        this.mempoolWsClient = new WebSocket(this.mempoolWsUrl);

        this.mempoolWsClient.on('open', () => {
            logger.info(`MevBotV10Orchestrator: Connected to mempool service at ${this.mempoolWsUrl}`);
            this.reconnectAttempts = 0;
            // Could send a subscription message if the publisher requires it
        });

        this.mempoolWsClient.on('message', (data: WebSocket.Data) => {
            this.onMempoolMessage(data.toString());
        });

        this.mempoolWsClient.on('close', (code: number, reason: Buffer) => {
            logger.warn(`MevBotV10Orchestrator: Disconnected from mempool service. Code: ${code}, Reason: ${reason.toString()}`);
            this.handleMempoolWsDisconnect();
        });

        this.mempoolWsClient.on('error', (error: Error) => {
            logger.error({ err: error }, `MevBotV10Orchestrator: Error connecting to mempool service at ${this.mempoolWsUrl}`);
            // 'close' event will usually follow, triggering reconnection logic there.
            // If 'close' doesn't fire, ensure cleanup and retry here or via a timeout.
             if (this.mempoolWsClient && this.mempoolWsClient.readyState !== WebSocket.OPEN) {
                this.handleMempoolWsDisconnect();
            }
        });
    }

    private handleMempoolWsDisconnect(): void {
        this.mempoolWsClient?.removeAllListeners(); // Clean up listeners on the old object
        this.mempoolWsClient = null;
        if (this.explicitlyStopped) return;

        if (this.reconnectAttempts < (parseInt((this.configService.get('mempool_ingestion.max_reconnect_attempts') as string | undefined) || `${MAX_RECONNECT_ATTEMPTS}`))) {
            this.reconnectAttempts++;
            const delay = parseInt((this.configService.get('mempool_ingestion.reconnect_interval_ms') as string | undefined) || `${DEFAULT_RECONNECT_INTERVAL_MS}`);
            logger.info(`MevBotV10Orchestrator: Attempting to reconnect to mempool service in ${delay / 1000}s...`);
            setTimeout(() => this.connectToMempoolService(), delay);
        } else {
            logger.error(`MevBotV10Orchestrator: Max reconnect attempts to mempool service reached. Stopping further attempts.`);
            // Consider a critical alert here
        }
    }

    private async onMempoolMessage(messageData: string): Promise<void> {
        try {
            // Assuming messageData is the BroadcastMessage from mempool-ingestion-service
            const message = JSON.parse(messageData);
            logger.trace({ type: message.type }, "MevBotV10Orchestrator: Received message from mempool service.");

            if (message.type === 'decoded_transaction' || message.type === 'transaction') {
                // The payload should be a FilterableTransaction (which extends ethers.TransactionResponse)
                // and might have a `decodedInput` field.
                // For OpportunityIdentificationService, we need to map this to ProcessedMempoolTransaction.
                const mempoolTxPayload = message.payload as FilterableTransaction;

                // Map to ProcessedMempoolTransaction for OpportunityIdentificationService
                const processedTx: ProcessedMempoolTransaction = {
                    txHash: mempoolTxPayload.hash,
                    routerName: mempoolTxPayload.decodedInput?.routerName || "UnknownRouter",
                    routerAddress: mempoolTxPayload.to || "0x", // tx.to should be the router address
                    functionName: mempoolTxPayload.decodedInput?.functionName || "UnknownFunction",
                    path: mempoolTxPayload.decodedInput?.path || [],
                    amountIn: mempoolTxPayload.decodedInput?.amountIn,
                    amountOutMin: mempoolTxPayload.decodedInput?.amountOutMin,
                    amountOut: mempoolTxPayload.decodedInput?.amountOut,
                    amountInMax: mempoolTxPayload.decodedInput?.amountInMax,
                    recipient: mempoolTxPayload.decodedInput?.to || mempoolTxPayload.from, // 'to' in swap args is recipient
                    txTimestamp: message.timestamp || Date.now(), // Use publisher's timestamp or now
                    gasPrice: mempoolTxPayload.gasPrice?.toString(),
                    // Add these for EIP-1559:
                    baseFeePerGas: mempoolTxPayload.maxFeePerGas?.toString(),
                    priorityFeePerGas: mempoolTxPayload.maxPriorityFeePerGas?.toString(),
                    blockNumber: mempoolTxPayload.blockNumber ?? undefined,
                };

                if (!ethers.utils.isAddress(processedTx.routerAddress) || processedTx.path.length < 2) {
                    logger.trace({txHash: processedTx.txHash}, "Skipping mempool message due to invalid router address or path.");
                    return;
                }


                const opportunities = await this.opportunityService.identifyOpportunitiesFromMempoolTx(processedTx);

                for (const opp of opportunities) {
                    if (this.currentBlockNumber === 0) {
                        logger.warn({pathId: opp.id}, "Current block number unknown, cannot perform block age freshness check. Simulating anyway.");
                        // await this.updateCurrentBlockNumber(); // Fetch if really needed, but might slow down processing
                    }
                    const simulationResult = await this.simulationService.simulateArbitragePath(opp, this.currentBlockNumber);
                    this.processSimulationResult(simulationResult);
                }
            }
        } catch (error) {
            logger.error({ err: error, rawMessage: messageData }, "MevBotV10Orchestrator: Error processing message from mempool service.");
        }
    }

    private async processSimulationResult(simResult: SimulationResult): Promise<void> {
        const minProfitUsd = parseFloat((this.configService.get('simulation_service.min_profit_threshold_usd') as string | undefined) || '1.0'); // Default $1
        const paperTradingMode = this.configService.get('paper_trading_config.enabled') === true;
        const executionEnabled = this.configService.get('execution_config.enabled') === true;

        let discardReason = "";

        if (simResult.error) discardReason = `Simulation error: ${simResult.error}`;
        else if (simResult.freshnessCheckFailed) discardReason = "Freshness check failed (too old)";
        else if (simResult.blockAgeCheckFailed) discardReason = "Block age check failed (source tx too deep)";
        else if (simResult.profitRealismCheckFailed) discardReason = "Profit realism check failed (profit % too high)";
        else if (simResult.maxProfitUsdCheckFailed) discardReason = "Max profit USD check failed (profit USD too high)";
        else if (!simResult.isProfitable) discardReason = "Not profitable after simulation";
        else if (simResult.netProfitUsd < minProfitUsd) discardReason = `Net profit USD ${simResult.netProfitUsd.toFixed(2)} is less than min threshold $${minProfitUsd}`;

        if (discardReason) {
            logger.info({ pathId: simResult.pathId, reason: discardReason, netProfitUSD: simResult.netProfitUsd?.toFixed(2) }, "Opportunity discarded.");
            // Optionally log discarded opportunities to Firestore for analysis
            if (this.configService.get('data_collection.log_discarded_opportunities') === true) {
                await this.dataCollectionService.logData({
                    type: "discarded_opportunity",
                    pathId: simResult.pathId,
                    reason: discardReason,
                    simulation: simResult,
                }, "discarded_opportunities_v10");
            }
            return;
        }

        logger.info({
            pathId: simResult.pathId,
            netProfitBase: ethers.utils.formatUnits(simResult.netProfitBaseToken, this.baseToken.decimals),
            netProfitUsd: simResult.netProfitUsd.toFixed(2),
        }, "Profitable opportunity identified and passed all checks!");

        if (paperTradingMode && !executionEnabled) {
            logger.info({ pathId: simResult.pathId }, "Paper trading mode: Logging paper trade.");
            await this.paperTradingStrategy.executePaperTrade(simResult);
            // DataCollectionService is called within paperTradingStrategy
        } else if (executionEnabled) {
            logger.warn({ pathId: simResult.pathId }, "Execution mode enabled but not implemented in this MVP orchestrator version.");
            // TODO: Implement actual trade execution logic if EXECUTION_ENABLED is true
            // This would involve using KmsSigningService and RpcService to send transactions.
        } else {
            logger.info({ pathId: simResult.pathId }, "Not in paper trading mode or execution disabled. Opportunity logged if not discarded.");
        }
    }

    private get baseToken(): TokenInfo { // Ensure TokenInfo here is the imported type
        return {
            address: this.configService.getOrThrow('opportunity_service.base_token_address') as string,
            symbol: (this.configService.get('opportunity_service.base_token_symbol') as string | undefined) || 'WETH',
            decimals: parseInt((this.configService.get('opportunity_service.base_token_decimals') as string | undefined) || '18'),
            name: (this.configService.get('opportunity_service.base_token_symbol') as string | undefined) || 'Wrapped Ether'
        };
    }


    public async stop(): Promise<void> {
        logger.info("MevBotV10Orchestrator: Stopping...");
        this.explicitlyStopped = true;

        if (this.mempoolWsClient) {
            this.mempoolWsClient.removeAllListeners();
            if (this.mempoolWsClient.readyState === WebSocket.OPEN || this.mempoolWsClient.readyState === WebSocket.CONNECTING) {
                this.mempoolWsClient.close(1000, "Orchestrator shutting down");
            }
            this.mempoolWsClient = null;
            logger.info("MevBotV10Orchestrator: Mempool WebSocket client connection closed.");
        }

        // Stop periodic block updates
        // Accessing the interval timer would require storing it when setInterval is called.
        // For simplicity in MVP, we'll let the process exit clear intervals.
        // In a more robust app, clear the interval timer here.

        // Close any other persistent connections (e.g., RPC WebSocket providers if kept open)
        this.rpcService.closeAllWebSocketProviders();

        logger.info("MevBotV10Orchestrator: Stopped.");
    }
}
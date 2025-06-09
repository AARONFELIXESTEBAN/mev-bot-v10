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
import { FilterableTransaction } from '@shared/types';
import { DexArbitrageStrategy } from '../strategies/dexArbitrageStrategy';
import { ESPMLService, EspPredictionResult } from '../services/esp/espService';
import { DynamicGasStrategyModule, GasParams } from '../services/execution/gasStrategy'; // Added
import { AdvancedSlippageControlModule } from '../services/execution/slippageControl'; // Added
import { ExecutionService } from '../services/execution/executionService'; // Added
import { TokenInfo, Dict, PathSegment } from '../utils/typeUtils'; // Added PathSegment

let logger: PinoLogger;

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
    private espService: ESPMLService;
    private gasStrategyModule: DynamicGasStrategyModule; // Added
    private slippageControlModule: AdvancedSlippageControlModule; // Added
    private executionService: ExecutionService; // Added

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

        this.espService = new ESPMLService(this.configService);

        this.gasStrategyModule = new DynamicGasStrategyModule(this.configService, this.rpcService); // Added
        this.slippageControlModule = new AdvancedSlippageControlModule(this.configService, this.priceService); // Added
        this.executionService = new ExecutionService(this.configService, this.rpcService, this.kmsService, this.dataCollectionService); // Added

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

        // Initialize services that require async setup
        await this.opportunityService.init();
        await this.espService.init();
        await this.executionService.init(this.rpcService.getProvider('mainnet', 'http') as ethers.providers.JsonRpcProvider); // Pass provider for Flashbots

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
        let espPrediction: EspPredictionResult | null = null;

        if (simResult.error) discardReason = `Simulation error: ${simResult.error}`;
        else if (simResult.freshnessCheckFailed) discardReason = "Freshness check failed (too old)";
        else if (simResult.blockAgeCheckFailed) discardReason = "Block age check failed (source tx too deep)";
        else if (simResult.profitRealismCheckFailed) discardReason = "Profit realism check failed (profit % too high)";
        else if (simResult.maxProfitUsdCheckFailed) discardReason = "Max profit USD check failed (profit USD too high)";
        else if (!simResult.isProfitable) discardReason = "Not profitable after simulation";
        else if (simResult.netProfitUsd < minProfitUsd) discardReason = `Net profit USD ${simResult.netProfitUsd.toFixed(2)} is less than min threshold $${minProfitUsd}`;

        // If all preliminary checks pass, then call ESP Service
        if (!discardReason) {
            logger.info({ pathId: simResult.pathId }, "Preliminary checks passed. Evaluating with ESP ML Model...");
            const assembledFeatures = await this._assembleEspInputFeatures(simResult.opportunity, simResult);
            espPrediction = await this.espService.predict(assembledFeatures);

            await this.dataCollectionService.logData({
                type: "esp_evaluation_attempt",
                opportunityId: simResult.opportunity.id,
                simulationPathId: simResult.pathId,
                inputFeatures: assembledFeatures, // Log the assembled features sent to ESP
                prediction: espPrediction,
                timestamp: new Date().toISOString()
            }, "esp_evaluations_v10");

            if (espPrediction.error) {
                discardReason = `ESP Error: ${espPrediction.error}`;
            } else if (espPrediction.executionSuccessProbability < (this.configService.get('esp_model_config.prediction_threshold') as number || 0.6)) {
                discardReason = `ESP prediction ${espPrediction.executionSuccessProbability.toFixed(3)} below threshold`;
            }
        }

        // If ESP validation fails, discard the opportunity
        if (discardReason) {
            logger.info({ pathId: simResult.pathId, reason: discardReason, netProfitUSD: simResult.netProfitUsd?.toFixed(2), espProb: espPrediction?.executionSuccessProbability?.toFixed(3) }, "Opportunity discarded post ESP or initial checks.");
            if (this.configService.get('data_collection.log_discarded_opportunities') === true) {
                await this.dataCollectionService.logData({
                    type: "discarded_opportunity",
                    pathId: simResult.pathId,
                    reason: discardReason,
                    initialSimulation: simResult, // Log the initial simulation result
                    espPrediction: espPrediction,
                }, "discarded_opportunities_v10");
            }
            return;
        }

        // ESP validation passed, now prepare for execution (or final paper trade logging)
        logger.info({ pathId: simResult.pathId, espProb: espPrediction?.executionSuccessProbability.toFixed(3) }, "Opportunity passed ESP validation. Proceeding to final parameter generation.");

        // 1. Get Optimal Gas Parameters
        const optimalGasParams = await this.gasStrategyModule.getOptimalGas(this.network, simResult.opportunity, espPrediction);

        // 2. Final Pre-Flight Simulation with Optimal Gas
        // This simulation uses the dynamic gas parameters to get the most accurate P&L before execution.
        const finalSimResult = await this.simulationService.simulateArbitragePath(
            simResult.opportunity, // Use the original opportunity
            this.currentBlockNumber,
            this.network,
            optimalGasParams // Pass the determined optimal gas params
        );

        // Re-check profitability with these more accurate execution parameters
        if (!finalSimResult.isProfitable || finalSimResult.netProfitUsd < minProfitUsd) {
            discardReason = `Not profitable after final simulation with optimal gas/slippage. Net USD: ${finalSimResult.netProfitUsd.toFixed(2)}`;
            logger.info({ pathId: finalSimResult.pathId, reason: discardReason, netProfitUSD: finalSimResult.netProfitUsd?.toFixed(2) }, "Opportunity discarded after final pre-flight simulation.");
            if (this.configService.get('data_collection.log_discarded_opportunities') === true) {
                 await this.dataCollectionService.logData({
                    type: "discarded_opportunity_post_final_sim",
                    pathId: finalSimResult.pathId,
                    reason: discardReason,
                    initialSimulation: simResult,
                    espPrediction: espPrediction,
                    finalSimulation: finalSimResult,
                }, "discarded_opportunities_v10");
            }
            return;
        }

        // 3. Calculate amountOutMin for each leg using AdvancedSlippageControlModule
        const amountsOutMin: BigNumber[] = [];
        if (finalSimResult.pathSegmentSimulations && finalSimResult.pathSegmentSimulations.length > 0) {
            for (const segmentSim of finalSimResult.pathSegmentSimulations) {
                const amountOutMinForSegment = this.slippageControlModule.getAmountOutMin(
                    segmentSim.expectedOutputAmount,
                    segmentSim.segment, // This is the PathSegment
                    espPrediction
                );
                amountsOutMin.push(amountOutMinForSegment);
            }
        } else {
            logger.error({pathId: finalSimResult.pathId}, "No path segment simulations found in finalSimResult to calculate amountOutMin values.");
            // Handle error, perhaps discard
            return;
        }


        logger.info({
            pathId: finalSimResult.pathId,
            netProfitBase: ethers.utils.formatUnits(finalSimResult.netProfitBaseToken, this.baseToken.decimals),
            netProfitUsd: finalSimResult.netProfitUsd.toFixed(2),
            espProb: espPrediction?.executionSuccessProbability.toFixed(3),
            maxFeePerGas: ethers.utils.formatUnits(optimalGasParams.maxFeePerGas, 'gwei'),
            maxPriorityFeePerGas: ethers.utils.formatUnits(optimalGasParams.maxPriorityFeePerGas, 'gwei'),
            amountsOutMin: amountsOutMin.map((a, i) => ethers.utils.formatUnits(a, finalSimResult.pathSegmentSimulations[i].segment.tokenOutDecimals))
        }, "Final parameters generated for profitable opportunity!");

        if (paperTradingMode && !executionEnabled) {
            logger.info({ pathId: finalSimResult.pathId }, "Paper trading mode: Logging paper trade with final parameters.");
            // Pass finalSimResult to paper trading, which now contains gasParamsUsed
            await this.paperTradingStrategy.executePaperTrade(finalSimResult);
        } else if (executionEnabled) {
            logger.warn({ pathId: finalSimResult.pathId }, "LIVE EXECUTION ENABLED. Attempting to execute trade.");
            const executionResult = await this.executionService.executeArbitrageTransaction(
                finalSimResult.opportunity,
                finalSimResult.pathSegmentSimulations, // Has expected amounts for each leg
                optimalGasParams,
                amountsOutMin // Array of BigNumber from slippage control module
            );

            await this.dataCollectionService.logData({
                type: "execution_attempt_v10", // More specific type
                opportunityId: finalSimResult.opportunity.id,
                simulationPathId: finalSimResult.pathId,
                finalSimulationResult: finalSimResult, // Log the simulation that led to execution
                gasParamsAttempted: optimalGasParams,
                amountsOutMinAttempted: amountsOutMin.map((a, i) => ethers.utils.formatUnits(a, finalSimResult.pathSegmentSimulations[i].segment.tokenOutDecimals)),
                executionResult: executionResult,
                timestamp: new Date().toISOString()
            }, "execution_attempts_v10");

            if (executionResult.success) {
                logger.info({ txHash: executionResult.transactionHash, bundleHash: executionResult.bundleHash }, "Trade submitted via ExecutionService.");
                // Nonce would have been incremented by ExecutionService.
                // If submission failed before tx was accepted by network (e.g. Flashbots error, bad nonce),
                // ExecutionService's acquireNonce might need adjustment or a way to signal consumption.
                // For now, assume ExecutionService handles its nonce state internally on failure/success.
            } else {
                logger.error({ error: executionResult.error, pathId: finalSimResult.pathId }, "Trade execution via ExecutionService failed.");
                // Consider if nonce needs external reset/sync if ExecutionService couldn't submit due to it.
                // ExecutionService itself calls synchronizeNonce on error.
            }
        } else {
            logger.info({ pathId: finalSimResult.pathId }, "Not in paper trading mode or execution disabled.");
        }
    }

    private get baseToken(): TokenInfo {
        return {
            address: this.configService.getOrThrow('opportunity_service.base_token_address') as string,
            symbol: (this.configService.get('opportunity_service.base_token_symbol') as string | undefined) || 'WETH',
            decimals: parseInt((this.configService.get('opportunity_service.base_token_decimals') as string | undefined) || '18'),
            name: (this.configService.get('opportunity_service.base_token_symbol') as string | undefined) || 'Wrapped Ether'
        };
    }

    // Helper method to assemble features for ESPMLService
    private async _assembleEspInputFeatures(opp: PotentialOpportunity, simResult: SimulationResult): Promise<Dict<any>> {
        const features: Dict<any> = {};
        const expectedFeatureOrder = this.espService.getFeatureColumnsOrdered();

        if (!expectedFeatureOrder) {
            logger.error("Could not retrieve expected feature order from ESPService. Cannot assemble features.");
            return {}; // Return empty or throw; an empty dict will likely fail prediction or produce nonsense
        }

        // This is where the detailed mapping from opp, simResult, and other services to the *raw input features*
        // that the Python feature_generator.py script expects will occur.
        // The ESPMLService.prepareFeatures will then take these raw inputs and generate the final scaled vector.

        // For Phase 2 Alpha MVP, many of these will be defaults or placeholders.
        // The goal is to provide the *inputs* that the Python feature_generator.py script would have used.
        // The ESPMLService.prepareFeatures then becomes the TypeScript equivalent of feature_generator.py + scaling.

        // A. Opportunity-Specific Features (Raw inputs for these)
        // Note: Profit and gas are from initial simulation (pre-ESP), not pre-simulation estimates.
        // The model was trained on features derived from data *before* execution was certain.
        // For 'estimatedNetProfitUsd_PreEsp', this should be the profit *before* this specific ESP check,
        // likely from an initial, less resource-intensive simulation or estimation if available.
        // If simResult is the first detailed sim, then its gross profit can be a proxy.
        const ethPrice = await this.priceService.getUsdPrice(this.baseToken.symbol);
        features['estimatedNetProfitUsd_PreEsp'] = simResult.grossProfitBaseToken ? parseFloat(ethers.utils.formatUnits(simResult.grossProfitBaseToken, this.baseToken.decimals)) * ethPrice : 0;
        features['estimatedGasCostUsd_Initial'] = simResult.estimatedGasCostBaseToken ? parseFloat(ethers.utils.formatUnits(simResult.estimatedGasCostBaseToken, this.baseToken.decimals)) * ethPrice : 0;
        // 'initialProfitToGasRatio' will be derived by ESPMLService.prepareFeatures
        features['pathLength'] = opp.path.length;
        features['usesFlashLoan'] = opp.usesFlashLoan || 0; // Assuming PotentialOpportunity has this
        features['flashLoanAmountUsd'] = opp.flashLoanAmountUsd || 0; // Assuming PotentialOpportunity has this
        features['flashLoanFeeUsd_Estimate'] = opp.flashLoanFeeUsdEstimate || 0; // Assuming PotentialOpportunity has this

        const uniqueTokens = new Set<string>();
        const uniqueDexes = new Set<string>();
        opp.path.forEach(segment => {
            uniqueTokens.add(segment.tokenInAddress);
            uniqueTokens.add(segment.tokenOutAddress);
            uniqueDexes.add(segment.dexName);
        });
        features['involvedTokenCount_Unique'] = uniqueTokens.size;
        features['involvedDexCount_Unique'] = uniqueDexes.size;

        // For A10_tokenIsCore_TokenN, ESPMLService.prepareFeatures will need the path and core token list
        features['pathTokenAddresses'] = opp.path.map(p => ({tokenIn: p.tokenInAddress, tokenOut: p.tokenOutAddress})); // Pass raw path addresses
        // features['coreTokenList'] = (this.configService.get('opportunity_service.core_whitelisted_tokens_csv') as string || "").split(','); // ESP can get this from its own config or passed

        // A12, A13 (min/avg path liquidity) - these are complex, likely from a dedicated liquidity service or deeper simulation. Placeholder.
        features['minPathLiquidityUsd'] = simResult.minPathLiquidityUsd || 0; // Assuming simResult might have this
        features['avgPathLiquidityUsd'] = simResult.avgPathLiquidityUsd || 0; // Assuming simResult might have this
        features['isCrossDexArbitrage'] = uniqueDexes.size > 1 ? 1 : 0;
        features['opportunityAgeMs'] = Date.now() - opp.discoveryTimestamp;


        // B. Real-Time Gas & Proposed Execution Parameters (Raw inputs)
        features['currentBlockNumber'] = this.currentBlockNumber;
        features['currentBaseFeeGwei'] = this.priceService.getCurrentBaseFeeGwei() || 0;
        const currentGas = this.priceService.getCurrentGasPrices();
        features['botProposedMaxFeePerGasGwei'] = currentGas?.maxFeePerGasGwei || 0; // Or from a dynamic gas estimator
        features['botProposedMaxPriorityFeePerGasGwei'] = currentGas?.priorityFeePerGasGwei || 0;
        // B20 botProposedSlippageToleranceBps_SwapN - from config or dynamic module
        for (let i = 0; i < opp.path.length; i++) {
            features[`botProposedSlippageToleranceBps_Swap${i+1}`] = this.configService.get('execution_config.default_slippage_bps') || 50; // Example default
        }


        // C. Mempool-Derived Features - Placeholders for Phase 2 Alpha MVP
        this.logger.warn("Mempool-derived features (C21-C28) are using default/placeholder values for ESP input.");
        features['mempool_TotalPendingTxCount'] = 0;
        features['mempool_HighGasTxCount_LastMinute'] = 0;
        for (let i = 0; i < opp.path.length; i++) {
            features[`mempool_TargetPool_PendingTxCount_Swap${i+1}`] = 0;
            features[`mempool_TargetPool_PendingVolumeUsd_Swap${i+1}`] = 0;
        }
        features['mempool_AvgPriorityFeeGwei_Recent'] = 0;
        features['mempool_competingMevTxSignatureCount'] = 0;
        // Attempt to get actual block timestamp for more accurate timeSinceLastBlockMs
        let timeSinceLastBlockMs = 0;
        try {
            const blockTimestamp = await this.rpcService.getBlockTimestamp(this.currentBlockNumber, this.network); // Ensure network is passed
            if (blockTimestamp) {
                 timeSinceLastBlockMs = Date.now() - (blockTimestamp * 1000);
            } else if (simResult.opportunity.sourceTxBlockNumber) { // Fallback if current block timestamp fails
                timeSinceLastBlockMs = (this.currentBlockNumber - simResult.opportunity.sourceTxBlockNumber) * 12000; // Approx 12s per block
            } else {
                timeSinceLastBlockMs = Date.now() - simResult.opportunity.discoveryTimestamp; // Rough estimate
            }
        } catch(e) { logger.debug("Could not get block timestamp for timeSinceLastBlockMs feature"); }
        features['timeSinceLastBlockMs'] = timeSinceLastBlockMs;
        features['mempool_gasPriceVolatility_ShortTerm'] = 0;


        // D. Market Condition & Token-Specific Features
        features['ethPriceUsd_Current'] = ethPrice;
        this.logger.warn("Token volatility/liquidity delta features (D30-D32) are using default/placeholder values for ESP input.");
        for (let i = 0; i < 3; i++) { // Assuming max 3 tokens considered for general volatility
            features[`tokenVolatility_StdDevPct_1min_Token${i}`] = 0;
            features[`tokenVolatility_StdDevPct_5min_Token${i}`] = 0;
        }
         for (let i = 0; i < opp.path.length; i++) { // For pools in path
            features[`tokenLiquidityDeltaPct_5min_Pool${i}`] = 0;
        }
        features['isNewTokenPair_Opportunistic'] = opp.isOpportunistic || 0; // Assuming field in PotentialOpportunity


        // E. Historical Performance Features - Placeholders for Phase 2 Alpha MVP
        this.logger.warn("Historical bot performance features (E34-E38) are using default/placeholder values for ESP input.");
        features['bot_HistoricalSuccessRate_SamePathSignature_LastHour'] = 0.5;
        features['bot_HistoricalSuccessRate_SameStrategyType_LastHour'] = 0.5;
        features['bot_AvgNetProfitUsd_SamePathSignature_Successful_LastDay'] = 0;
        features['bot_RecentConsecutiveFailures_ThisStrategy'] = 0;
        features['bot_RelaySuccessRate_LastHour'] = 0.5;

        // F. Time-Based Features - Pass the raw timestamp for ESPMLService to derive cyclical features
        features['attemptTimestamp'] = opp.discoveryTimestamp; // Or Date.now() at the point of decision

        // Ensure all expected features are present, filling with default if absolutely necessary
        // This is more of a safeguard; ideally, all are mapped above.
        for (const fName of expectedFeatureOrder) {
            if (!(fName in features)) {
                // This case means the feature was in feature_columns_ordered from Python,
                // but not explicitly mapped above. This indicates an INCOMPLETE MAPPING.
                logger.warn(`Feature '${fName}' was expected by model but not explicitly assembled. Defaulting to 0. REVIEW MAPPING!`);
                features[fName] = 0; // Default to 0, but this should be fixed by mapping all features.
            }
        }
        return features;
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
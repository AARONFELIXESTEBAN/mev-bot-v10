import { ethers } from 'ethers';
import { getLogger, PinoLogger } from '@core/logger/loggerService';
import { ConfigService } from '@core/config/configService';
import { FlashbotsBundleProvider, FlashbotsBundleRawTransaction } from '@flashbots/ethers-provider-bundle';
import { PotentialOpportunity, PathSegment } from '@services/opportunity/opportunityService';
import { GasParams } from '@services/execution/gasStrategy';
import { SimulationResult, SimulatedPathSegmentDetails } from '@services/simulation/simulationService';

interface RpcService {
    getProvider(network: string, type: 'http' | 'ws'): ethers.JsonRpcProvider;
}

interface DataCollectionService {
    // Add methods as needed
}

export interface ExecutionResult {
    success: boolean;
    transactionHash?: string;
    bundleHash?: string;
    error?: string;
    message?: string;
    gasUsed?: ethers.BigNumberish;
    effectiveGasPrice?: ethers.BigNumberish;
    blockNumber?: number;
}

export class ExecutionService {
    private logger: PinoLogger;
    private configService: ConfigService;
    private rpcService: RpcService;
    private kmsService: KmsService;
    private dataCollectionService: DataCollectionService;

    private botAddress: string | null = null;
    private currentNonce: number | null = null;
    private nonceLock: boolean = false;

    private flashbotsProvider: FlashbotsBundleProvider | null = null;
    private flashbotsAuthSigner: ethers.Wallet | null = null;

    constructor(
        configService: ConfigService,
        rpcService: RpcService,
        kmsService: KmsService,
        dataCollectionService: DataCollectionService
    ) {
        this.logger = getLogger('ExecutionService');
        this.configService = configService;
        this.rpcService = rpcService;
        this.kmsService = kmsService;
        this.dataCollectionService = dataCollectionService;
    }

    public async init(mainnetProviderOverride?: ethers.JsonRpcProvider): Promise<void> {
        this.logger.info("Initializing ExecutionService...");
        try {
            this.botAddress = await this.kmsService.getBotAddress();
            this.logger.info(`Execution Service will use bot address: ${this.botAddress}`);
            await this.synchronizeNonce("latest");

            const flashbotsRelayUrl = this.configService.get('execution_config.flashbots_relay_url') as string;
            const flashbotsSigningKey = this.configService.get('execution_config.flashbots_signing_key') as string;

            if (flashbotsRelayUrl && flashbotsSigningKey) {
                const ethProvider = mainnetProviderOverride || this.rpcService.getProvider('mainnet', 'http');
                this.flashbotsAuthSigner = new ethers.Wallet(flashbotsSigningKey);
                this.flashbotsProvider = await FlashbotsBundleProvider.create(
                    ethProvider,
                    this.flashbotsAuthSigner,
                    flashbotsRelayUrl,
                    'mainnet'
                );
                this.logger.info(`FlashbotsBundleProvider initialized for relay: ${flashbotsRelayUrl}`);
            } else {
                this.logger.info("Flashbots not configured (relay URL or signing key missing). Will use public mempool only.");
            }
        } catch (error: any) {
            this.logger.fatal({ err: error.message }, "Failed to initialize ExecutionService.");
            throw error;
        }
    }

    private async acquireNonce(): Promise<number> {
        while (this.nonceLock) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        this.nonceLock = true;
        try {
            if (this.currentNonce === null) {
                this.logger.warn("Current nonce is null, re-synchronizing with 'pending' count.");
                await this.synchronizeNonce("pending");
            }
            if (this.currentNonce === null) throw new Error("Failed to obtain nonce after re-sync.");

            const nonceToUse = this.currentNonce;
            this.currentNonce++;
            this.logger.info(`Acquired nonce: ${nonceToUse}. Next nonce will be: ${this.currentNonce}`);
            return nonceToUse;
        } finally {
            this.nonceLock = false;
        }
    }

    public async synchronizeNonce(blockTag: 'latest' | 'pending' = 'pending'): Promise<void> {
        if (!this.botAddress) {
            this.logger.error("Bot address not available, cannot synchronize nonce.");
            return;
        }
        if (this.nonceLock && blockTag === 'pending') {
            this.logger.info("Nonce update already in progress, skipping explicit sync for 'pending'.");
            return;
        }
        try {
            this.logger.info(`Synchronizing nonce for address ${this.botAddress} using block tag '${blockTag}'...`);
            const provider = this.rpcService.getProvider('mainnet', 'http');
            this.currentNonce = await provider.getTransactionCount(this.botAddress, blockTag);
            this.logger.info(`Nonce synchronized. Current nonce set to: ${this.currentNonce}`);
        } catch (error: any) {
            this.logger.error({ err: error.message }, "Error synchronizing nonce.");
            this.currentNonce = null;
        }
    }

    public async executeArbitrageTransaction(
        opportunity: PotentialOpportunity,
        finalSimulatedPathSegments: SimulatedPathSegmentDetails[],
        gasParams: GasParams,
        amountsOutMin: ethers.BigNumberish[],
        network: string = 'mainnet'
    ): Promise<ExecutionResult> {
        if (!this.botAddress) return { success: false, error: "Bot address not initialized." };
        if (finalSimulatedPathSegments.length !== amountsOutMin.length) {
            return { success: false, error: "Mismatch between path segments and min amounts out." };
        }

        this.logger.warn("executeArbitrageTransaction: Current implementation is a placeholder for a single conceptual transaction. It does NOT execute multi-leg swaps atomically. This needs an execution smart contract for Phase 2 full functionality.");

        if (finalSimulatedPathSegments.length === 0) {
            return { success: false, error: "No path segments to execute." };
        }

        try {
            const firstLegSim = finalSimulatedPathSegments[0];
            const segment1 = firstLegSim.segment;
            const routerAddress1 = this.configService.get(`opportunity_service.dex_routers.${segment1.dexName}`) as string;
            if (!routerAddress1) throw new Error(`Router address for ${segment1.dexName} not found in config.`);

            const routerInterface1 = new ethers.Interface(this.getRouterAbi(segment1.dexName));

            let txData: string;
            let txValue: ethers.BigNumberish = 0;
            const amountInLeg1 = opportunity.entryAmountBase;

            const baseTokenAddr = this.configService.get('opportunity_service.base_token_address')?.toLowerCase();
            const isNativeEthIn = opportunity.path[0].tokenInAddress.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
                opportunity.path[0].tokenInAddress.toLowerCase() === "0x0000000000000000000000000000000000000000";

            if (segment1.tokenInAddress.toLowerCase() === baseTokenAddr &&
                opportunity.entryTokenAddress.toLowerCase() === baseTokenAddr) {
                if (isNativeEthIn) {
                    txData = routerInterface1.encodeFunctionData(
                        "swapExactETHForTokens",
                        [
                            amountsOutMin[0],
                            [segment1.tokenInAddress, segment1.tokenOutAddress],
                            this.botAddress,
                            Math.floor(Date.now() / 1000) + 120
                        ]
                    );
                    txValue = amountInLeg1;
                } else {
                    txData = routerInterface1.encodeFunctionData(
                        "swapExactTokensForTokens",
                        [
                            amountInLeg1,
                            amountsOutMin[0],
                            [segment1.tokenInAddress, segment1.tokenOutAddress],
                            this.botAddress,
                            Math.floor(Date.now() / 1000) + 120
                        ]
                    );
                }
            } else {
                this.logger.error("Execution for non-base-token entry or complex paths not fully implemented for direct router calls.");
                return { success: false, error: "Complex path execution not implemented without execution contract." };
            }

            const txNonce = await this.acquireNonce();
            const provider = this.rpcService.getProvider(network, 'http');
            const chainId = (await provider.getNetwork()).chainId;

            const tx: ethers.TransactionRequest = {
                to: routerAddress1,
                data: txData,
                value: txValue,
                gasLimit: firstLegSim.estimatedGasUnits || 500000,
                maxFeePerGas: gasParams.maxFeePerGas,
                maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
                nonce: txNonce,
                chainId: chainId,
                type: 2,
            };

            this.logger.info({ transaction: { to: tx.to, value: tx.value?.toString(), nonce: tx.nonce, maxFeePerGas: tx.maxFeePerGas?.toString(), maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString() } }, "Prepared transaction for signing.");
            const signedTx = await this.kmsService.signTransaction(tx);
            this.logger.info(`Transaction signed. Nonce: ${txNonce}. Submitting...`);

            if (this.flashbotsProvider) {
                return this.submitToFlashbots(signedTx, this.configService.get('execution_config.target_block_offset') as number || 1);
            } else {
                return this.submitToPublicMempool(signedTx);
            }
        } catch (error: any) {
            this.logger.error({ err: error.message, opportunityId: opportunity.id }, "Error during transaction execution attempt.");
            await this.synchronizeNonce('pending');
            return { success: false, error: error.message || "Unknown execution error" };
        }
    }

    private async submitToFlashbots(signedTx: string, targetBlockOffset: number): Promise<ExecutionResult> {
        if (!this.flashbotsProvider) return { success: false, error: "Flashbots provider not initialized." };

        const currentBlock = await this.rpcService.getProvider('mainnet', 'http').getBlockNumber();
        const targetBlock = currentBlock + targetBlockOffset;
        this.logger.info(`Submitting transaction to Flashbots for target block: ${targetBlock}`);

        try {
            const transaction: FlashbotsBundleRawTransaction = { signedTransaction: signedTx };
            const bundleSubmission = await this.flashbotsProvider.sendRawBundle([transaction], targetBlock);

            if ('error' in bundleSubmission) {
                this.logger.error({ err: bundleSubmission.error }, "Flashbots bundle submission error.");
                await this.synchronizeNonce('pending');
                return { success: false, error: `Flashbots error: ${bundleSubmission.error.message}` };
            }

            const txHash = ethers.keccak256(signedTx);
            this.logger.info({ bundleResult: bundleSubmission, txHashCalculated: txHash }, "Flashbots bundle submitted.");

            return { success: true, transactionHash: txHash, bundleHash: bundleSubmission.bundleHash, message: `Submitted to Flashbots for block ${targetBlock}.` };
        } catch (error: any) {
            this.logger.error({ err: error.message }, "Error submitting transaction to Flashbots.");
            await this.synchronizeNonce('pending');
            return { success: false, error: `Flashbots submission failed: ${error.message}` };
        }
    }

    private async submitToPublicMempool(signedTx: string): Promise<ExecutionResult> {
        this.logger.info("Submitting transaction to public mempool...");
        try {
            const provider = this.rpcService.getProvider('mainnet', 'http');
            const txResponse = await provider.sendTransaction(signedTx);
            this.logger.info({ txHash: txResponse.hash, nonce: txResponse.nonce }, "Transaction submitted to public mempool.");

            return { success: true, transactionHash: txResponse.hash, message: "Submitted to public mempool." };
        } catch (error: any) {
            this.logger.error({ err: error.message }, "Error submitting transaction to public mempool.");
            await this.synchronizeNonce('pending');
            return { success: false, error: `Public mempool submission failed: ${error.message}` };
        }
    }

    private getRouterAbi(dexName: string): any {
        const uniswapV2RouterABI = [
            "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
            "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)"
        ];
        if (dexName.toLowerCase().includes("uniswap") || dexName.toLowerCase().includes("sushi")) {
            return uniswapV2RouterABI;
        }
        this.logger.error(`No ABI found for DEX: ${dexName}. Using default UniswapV2Router ABI as a fallback.`);
        return uniswapV2RouterABI;
    }
}
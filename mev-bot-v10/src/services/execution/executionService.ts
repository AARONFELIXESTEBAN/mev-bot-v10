import { ethers, BigNumber, PopulatedTransaction } from 'ethers';
import { getLogger, PinoLogger } from '../../core/logger/loggerService';
import { ConfigService } from '../../core/config/configService';
import { RpcService } from '../../core/rpc/rpcService';
import { KmsService } from '../../core/kms/kmsService';
import { DataCollectionService } from '../../core/dataCollection/firestoreService';
import { PotentialOpportunity, PathSegment } from '../opportunity/opportunityService'; // PathSegment for type clarity
import { GasParams } from './gasStrategy';
import { SimulationResult, SimulatedPathSegmentDetails } from '../simulation/simulationService';
import { FlashbotsBundleProvider, FlashbotsBundleRawTransaction, FlashbotsTransactionResponse } from '@flashbots/ethers-provider-bundle';

export interface ExecutionResult {
    success: boolean;
    transactionHash?: string;
    bundleHash?: string; // For Flashbots
    error?: string;
    message?: string;
    gasUsed?: BigNumber; // To be populated if tx receipt is fetched
    effectiveGasPrice?: BigNumber; // To be populated if tx receipt is fetched
    blockNumber?: number; // Block where tx was included
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
    private flashbotsAuthSigner: ethers.Wallet | null = null; // For Flashbots reputation key

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

    public async init(mainnetProviderOverride?: ethers.providers.JsonRpcProvider): Promise<void> { // Allow provider override for Flashbots
        this.logger.info("Initializing ExecutionService...");
        try {
            this.botAddress = await this.kmsService.getBotAddress();
            if (!this.botAddress) {
                throw new Error("Failed to get bot address from KMS.");
            }
            this.logger.info(`Execution Service will use bot address: ${this.botAddress}`);
            await this.synchronizeNonce("latest");

            const flashbotsRelayUrl = this.configService.get('execution_config.flashbots_relay_url') as string;
            // The signing key itself, not the secret name. ConfigService needs to handle secret fetching.
            const flashbotsSigningKey = this.configService.get('execution_config.flashbots_signing_key') as string;

            if (flashbotsRelayUrl && flashbotsSigningKey) {
                const ethProvider = mainnetProviderOverride || this.rpcService.getProvider('mainnet', 'http');
                if (ethProvider instanceof ethers.providers.JsonRpcProvider) { // Flashbots requires JsonRpcProvider
                     this.flashbotsAuthSigner = new ethers.Wallet(flashbotsSigningKey);
                     this.flashbotsProvider = await FlashbotsBundleProvider.create(
                        ethProvider,
                        this.flashbotsAuthSigner,
                        flashbotsRelayUrl,
                        'mainnet' // network for flashbots
                    );
                    this.logger.info(`FlashbotsBundleProvider initialized for relay: ${flashbotsRelayUrl}`);
                } else {
                     this.logger.warn("Flashbots requires a JsonRpcProvider for its main provider. Could not initialize Flashbots provider.");
                }
            } else {
                this.logger.info("Flashbots not configured (relay URL or signing key missing). Will use public mempool only.");
            }

        } catch (error) {
            this.logger.fatal({ err: error }, "Failed to initialize ExecutionService.");
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
        // Prevent simultaneous updates if called externally
        if (this.nonceLock && blockTag === 'pending') {
            this.logger.info("Nonce update already in progress, skipping explicit sync for 'pending'.");
            return;
        }
        try {
            this.logger.info(`Synchronizing nonce for address ${this.botAddress} using block tag '${blockTag}'...`);
            const provider = this.rpcService.getProvider('mainnet', 'http');
            this.currentNonce = await provider.getTransactionCount(this.botAddress, blockTag);
            this.logger.info(`Nonce synchronized. Current nonce set to: ${this.currentNonce}`);
        } catch (error) {
            this.logger.error({ err: error }, "Error synchronizing nonce.");
            this.currentNonce = null;
        }
    }

    public async executeArbitrageTransaction(
        opportunity: PotentialOpportunity,
        finalSimulatedPathSegments: SimulatedPathSegmentDetails[],
        gasParams: GasParams,
        amountsOutMin: BigNumber[],
        network: string = 'mainnet'
    ): Promise<ExecutionResult> {
        if (!this.botAddress) return { success: false, error: "Bot address not initialized." };
        if (finalSimulatedPathSegments.length !== amountsOutMin.length) {
            return { success: false, error: "Mismatch between path segments and min amounts out."};
        }

        this.logger.warn("executeArbitrageTransaction: Current implementation is a placeholder for a single conceptual transaction. It does NOT execute multi-leg swaps atomically. This needs an execution smart contract for Phase 2 full functionality.");

        if (finalSimulatedPathSegments.length === 0) {
             return { success: false, error: "No path segments to execute." };
        }

        try {
            // SIMPLIFIED: Construct a single transaction representing the first leg for testing the pipeline.
            // A real multi-leg execution requires an execution contract or careful sequencing.
            const firstLegSim = finalSimulatedPathSegments[0];
            const segment1 = firstLegSim.segment;
            const routerAddress1 = this.configService.get(`opportunity_service.dex_routers.${segment1.dexName}`) as string;
            if (!routerAddress1) throw new Error(`Router address for ${segment1.dexName} not found in config.`);

            const routerInterface1 = new ethers.utils.Interface(this.getRouterAbi(segment1.dexName));

            let txData: string;
            let txValue: BigNumber = BigNumber.from(0);
            const amountInLeg1 = opportunity.entryAmountBase; // Amount for the first leg

            // Assuming base token is WETH and it's an ETH-in swap if path starts with native ETH placeholder
            if (segment1.tokenInAddress.toLowerCase() === this.configService.get('opportunity_service.base_token_address')?.toLowerCase() &&
                opportunity.entryTokenAddress.toLowerCase() === this.configService.get('opportunity_service.base_token_address')?.toLowerCase()) { // WETH -> TokenB

                // This requires WETH to be approved to the router. For MVP, assume this is handled externally.
                // Or, if entryAmountBase was from native ETH, this would be swapExactETHForTokens
                const isNativeEthIn = opportunity.path[0].tokenInAddress.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
                                   opportunity.path[0].tokenInAddress.toLowerCase() === "0x0000000000000000000000000000000000000000";

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
                } else { // swapExactTokensForTokens
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
                // Other scenarios (e.g. TokenA -> TokenB where TokenA is not base) are more complex for direct execution
                this.logger.error("Execution for non-base-token entry or complex paths not fully implemented for direct router calls.");
                return { success: false, error: "Complex path execution not implemented without execution contract." };
            }

            const txNonce = await this.acquireNonce();
            const provider = this.rpcService.getProvider(network, 'http');
            const chainId = (await provider.getNetwork()).chainId;

            const tx: PopulatedTransaction = {
                to: routerAddress1,
                data: txData,
                value: txValue,
                gasLimit: ethers.utils.hexlify(firstLegSim.estimatedGasUnits || 500000),
                maxFeePerGas: gasParams.maxFeePerGas,
                maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
                nonce: txNonce,
                chainId: chainId,
                type: 2 // EIP-1559
            };

            this.logger.info({ transaction: {to:tx.to, value:tx.value?.toString(), nonce:tx.nonce, maxFeePerGas:tx.maxFeePerGas?.toString(), maxPriorityFeePerGas:tx.maxPriorityFeePerGas?.toString()} }, "Prepared transaction for signing.");
            const signedTx = await this.kmsService.signTransaction(tx);
            if (!signedTx) throw new Error("Failed to sign transaction with KMS.");

            this.logger.info(`Transaction signed. Nonce: ${txNonce}. Submitting...`);

            if (this.flashbotsProvider) {
                return this.submitToFlashbots(signedTx, this.configService.get('execution_config.target_block_offset') as number || 1);
            } else {
                return this.submitToPublicMempool(signedTx);
            }

        } catch (error: any) {
            this.logger.error({ err: error, opportunityId: opportunity.id }, "Error during transaction execution attempt.");
            await this.synchronizeNonce('pending');
            return { success: false, error: error.message || "Unknown execution error" };
        }
    }

    private async submitToFlashbots(signedTx: string, targetBlockOffset: number): Promise<ExecutionResult> {
         if (!this.flashbotsProvider) return { success: false, error: "Flashbots provider not initialized."};

         const currentBlock = await this.rpcService.getProvider('mainnet', 'http').getBlockNumber();
         const targetBlock = currentBlock + targetBlockOffset;
         this.logger.info(`Submitting transaction to Flashbots for target block: ${targetBlock}`);

        try {
            const transaction: FlashbotsBundleRawTransaction = { signedTransaction: signedTx };
            const bundleSubmission = await this.flashbotsProvider.sendRawBundle([transaction], targetBlock);

            if ('error' in bundleSubmission) {
                this.logger.error({ err: bundleSubmission.error }, "Flashbots bundle submission error.");
                await this.synchronizeNonce('pending'); // Nonce might not have been consumed
                return { success: false, error: `Flashbots error: ${bundleSubmission.error.message}` };
            }

            const txHash = ethers.utils.keccak256(signedTx);
            this.logger.info({ bundleResult: bundleSubmission, txHashCalculated: txHash }, "Flashbots bundle submitted.");

            // For Phase 2 Alpha, we fire and forget for Flashbots.
            // Proper monitoring would involve bundleSubmission.wait() or checking bundle stats.
            return { success: true, transactionHash: txHash, bundleHash: bundleSubmission.bundleHash, message: `Submitted to Flashbots for block ${targetBlock}.` };

        } catch (error: any) {
            this.logger.error({ err: error }, "Error submitting transaction to Flashbots.");
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
            this.logger.error({ err: error }, "Error submitting transaction to public mempool.");
            await this.synchronizeNonce('pending');
            return { success: false, error: `Public mempool submission failed: ${error.message}` };
        }
    }

    private getRouterAbi(dexName: string): any {
        // This should ideally use scService.getAbi(abiName)
        // For Phase 2 Alpha, let's keep it simple.
        // IMPORTANT: This ABI is minimal and only for example. Real ABIs should be loaded properly.
        const uniswapV2RouterABI = [
            "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
            "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)"
            // Add other functions like swapTokensForExactTokens, swapETHForExactTokens etc. if needed
        ];
        if (dexName.toLowerCase().includes("uniswap") || dexName.toLowerCase().includes("sushi")) {
            return uniswapV2RouterABI;
        }
        this.logger.error(`No ABI found for DEX: ${dexName}. Using default UniswapV2Router ABI as a fallback.`);
        return uniswapV2RouterABI; // Fallback, might not be correct
    }
}
```

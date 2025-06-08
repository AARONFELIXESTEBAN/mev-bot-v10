import { ConfigService } from '../../core/config/configService';
import { getLogger } from '../../core/logger/loggerService';
import { PriceService, DexPairPriceInfo } from './priceService'; // Adjust path
import { findTwoHopOpportunities, DecodedMempoolSwap, ArbitragePath, DexPoolInfo, TokenInfo } from '../../arbitrage/pathFinder'; // Adjust path
import { SmartContractInteractionService } from '../../core/smartContract/smartContractService';
import { ethers } from 'ethers';

const logger = getLogger();

// This would typically come from the mempool ingestion service's decoded output
export interface ProcessedMempoolTransaction extends DecodedMempoolSwap {
    gasPrice?: string; // from the triggering tx
    baseFeePerGas?: string; // from block of triggering tx (if available)
    priorityFeePerGas?: string; // from triggering tx
    blockNumber?: number; // block number of the triggering tx, if already mined (less likely for true mempool)
}

export interface PotentialOpportunity extends ArbitragePath {
    estimatedGrossProfitPercentage?: number; // Very rough, pre-simulation
    // Pool states at time of discovery (optional, could be fetched by simulation service)
    // leg1PoolState?: DexPairPriceInfo;
    // leg2PoolState?: DexPairPriceInfo;
}

export class OpportunityIdentificationService {
    private baseToken: TokenInfo;
    private coreWhitelistedTokens: TokenInfo[] = [];
    private knownDexPools: DexPoolInfo[] = [];

    constructor(
        private configService: ConfigService,
        private priceService: PriceService,
        private scService: SmartContractInteractionService
    ) {
        const baseTokenAddress = this.configService.getOrThrow('BASE_TOKEN_ADDRESS');
        const baseTokenSymbol = this.configService.get('BASE_TOKEN_SYMBOL') || "WETH"; // Default to WETH if not set
        const baseTokenDecimals = parseInt(this.configService.get('BASE_TOKEN_DECIMALS') || "18");
        this.baseToken = {
            address: baseTokenAddress,
            symbol: baseTokenSymbol,
            decimals: baseTokenDecimals,
            name: baseTokenSymbol
        };

        this.initializeWhitelistedTokensAndPools();
        logger.info(`OpportunityIdentificationService: Initialized. Base Token: ${this.baseToken.symbol}.`);
    }

    private async initializeWhitelistedTokensAndPools(): Promise<void> {
        // Load whitelisted token addresses (CSV)
        const whitelistedAddressesCsv = this.configService.get('CORE_WHITELISTED_TOKENS_CSV') || "";
        const addresses = whitelistedAddressesCsv.split(',').map(a => a.trim()).filter(a => ethers.utils.isAddress(a));

        logger.info(`Attempting to load info for whitelisted token addresses: ${addresses.join(', ')}`);

        for (const addr of addresses) {
            if (addr.toLowerCase() === this.baseToken.address.toLowerCase()) continue; // Skip base token
            try {
                // Fetch token details (symbol, decimals, name) using SCService
                // This assumes ERC20 ABI is cached in SCService as 'ERC20'
                const [symbol, name, decimals] = await Promise.all([
                    this.scService.readFunction({ contractAddress: addr, abi: 'ERC20', functionName: 'symbol' }),
                    this.scService.readFunction({ contractAddress: addr, abi: 'ERC20', functionName: 'name' }),
                    this.scService.readFunction({ contractAddress: addr, abi: 'ERC20', functionName: 'decimals' }),
                ]);

                if (symbol && name && typeof decimals === 'number') {
                    this.coreWhitelistedTokens.push({ address: addr, symbol, name, decimals });
                } else {
                    logger.warn(`Could not fetch full details for whitelisted token ${addr}. Symbol: ${symbol}, Name: ${name}, Decimals: ${decimals}`);
                }
            } catch (error) {
                logger.error({ err: error, tokenAddress: addr }, `Failed to fetch details for whitelisted token ${addr}.`);
            }
        }
        logger.info({ tokens: this.coreWhitelistedTokens.map(t => t.symbol) }, `Initialized ${this.coreWhitelistedTokens.length} whitelisted tokens with details.`);


        // Load known DEX pools from config (example structure)
        // Config should provide: pairAddress, dexName, token0Symbol, token1Symbol
        const configuredPools = this.configService.get('KNOWN_DEX_POOLS_CONFIG') as Array<{
            pairAddress: string, dexName: string, token0Symbol: string, token1Symbol: string
        }> || [];

        for (const poolConfig of configuredPools) {
            const token0 = this.findTokenBySymbol(poolConfig.token0Symbol) || (poolConfig.token0Symbol === this.baseToken.symbol ? this.baseToken : undefined);
            const token1 = this.findTokenBySymbol(poolConfig.token1Symbol) || (poolConfig.token1Symbol === this.baseToken.symbol ? this.baseToken : undefined);

            if (token0 && token1) {
                this.knownDexPools.push({
                    pairAddress: poolConfig.pairAddress,
                    dexName: poolConfig.dexName,
                    token0: token0,
                    token1: token1
                });
            } else {
                logger.warn(`Could not find token info for pool ${poolConfig.pairAddress} tokens: ${poolConfig.token0Symbol}, ${poolConfig.token1Symbol}`);
            }
        }
        logger.info(`Initialized with ${this.knownDexPools.length} known DEX pools from config.`);
        if (this.knownDexPools.length === 0) {
             logger.warn("OpportunityIdentificationService: No DEX pools configured/loaded. Pathfinding will be severely limited.");
        }
    }

    private findTokenBySymbol(symbol: string): TokenInfo | undefined {
        if (symbol.toUpperCase() === this.baseToken.symbol.toUpperCase()) return this.baseToken;
        return this.coreWhitelistedTokens.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    }


    public async identifyOpportunitiesFromMempoolTx(
        processedMempoolTx: ProcessedMempoolTransaction
    ): Promise<PotentialOpportunity[]> {
        logger.debug({ txHash: processedMempoolTx.txHash }, "OpportunityIDService: Processing mempool transaction for 2-hop opportunities.");

        if (this.knownDexPools.length === 0 || this.coreWhitelistedTokens.length === 0) {
            logger.warn("OpportunityIDService: No known DEX pools or whitelisted tokens available for pathfinding. Ensure configuration is complete.");
            return [];
        }

        // Ensure all token addresses in the mempool tx path are EIP-55 checksummed if necessary by pathFinder or downstream
        // (ethers usually returns checksummed addresses from contract calls)

        const potentialPaths = findTwoHopOpportunities(
            processedMempoolTx,
            this.baseToken,
            this.coreWhitelistedTokens,
            this.knownDexPools
        );

        if (potentialPaths.length === 0) {
            return [];
        }

        const opportunities: PotentialOpportunity[] = [];
        for (const path of potentialPaths) {
            // For MVP, directly consider paths found by pathFinder as potential opportunities.
            // More advanced: re-fetch current reserves for pools in 'path' using PriceService
            // to ensure the opportunity hasn't vanished due to other txs.
            // This adds latency but increases accuracy before full simulation.
            // For now, we pass it on, simulation service will use fresh reserves.

            const opportunity: PotentialOpportunity = { ...path };
            opportunities.push(opportunity);
            logger.info({ pathId: path.id, sourceTx: path.sourceTxHash, leg1Dex: path.leg1.dexName, leg2Dex: path.leg2.dexName }, `OpportunityIDService: Identified potential 2-hop opportunity.`);
        }
        return opportunities;
    }
}
import { ConfigService } from '../../core/config/configService';
import { getLogger } from '../../core/logger/loggerService';
import { PriceService, DexPairPriceInfo } from '../price/price.service';
import { findTwoHopOpportunities, DecodedMempoolSwap, ArbitragePath, DexPoolInfo } from '../../arbitrage/pathFinder';
import { TokenInfo } from '../../utils/typeUtils';
import { SmartContractInteractionService } from '../../core/smartContract/smartContractService';
import { ethers } from 'ethers';

const logger = getLogger();

export interface ProcessedMempoolTransaction extends DecodedMempoolSwap {
    gasPrice?: string;
    baseFeePerGas?: string;
    priorityFeePerGas?: string;
    blockNumber?: number;
}

export interface PotentialOpportunity extends ArbitragePath {
    estimatedGrossProfitPercentage?: number;
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
        const baseTokenSymbol = this.configService.get('BASE_TOKEN_SYMBOL') || "WETH";
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
        // Changed to getOrThrow
        const whitelistedAddressesCsv = this.configService.getOrThrow('CORE_WHITELISTED_TOKENS_CSV');
        // Added types to lambda parameters
        const addresses = whitelistedAddressesCsv.split(',').map((a: string) => a.trim()).filter((a: string) => ethers.utils.isAddress(a));

        logger.info(`Attempting to load info for whitelisted token addresses: ${addresses.join(', ')}`);

        for (const addr of addresses) {
            if (addr.toLowerCase() === this.baseToken.address.toLowerCase()) continue;
            try {
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

        const configuredPools = this.configService.getKnownDexPools();

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
        logger.debug({ txHash: processedMempoolTx.hash }, "OpportunityIDService: Processing mempool transaction for 2-hop opportunities.");

        if (this.knownDexPools.length === 0 || this.coreWhitelistedTokens.length === 0) {
            logger.warn("OpportunityIDService: No known DEX pools or whitelisted tokens available for pathfinding. Ensure configuration is complete.");
            return [];
        }

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
            const opportunity: PotentialOpportunity = { ...path };
            opportunities.push(opportunity);
            logger.info({ pathId: path.id, sourceTx: path.sourceTxHash, leg1Dex: path.leg1.dexName, leg2Dex: path.leg2.dexName }, `OpportunityIDService: Identified potential 2-hop opportunity.`);
        }
        return opportunities;
    }
}

import { ethers, BigNumber } from 'ethers';
import { SmartContractInteractionService, PairReserves } from '../../core/smartContract/smartContractService';
import { ConfigService } from '../../core/config/configService';
import { getLogger } from '../../core/logger/loggerService';
import { TokenInfo } from '../../utils/typeUtils'; // Assuming TokenInfo is defined here

const logger = getLogger();

export interface DexPairPriceInfo extends PairReserves {
    pairAddress: string;
    dexName: string; // e.g., UniswapV2, SushiSwap
    token0: TokenInfo; // Information about token0
    token1: TokenInfo; // Information about token1
    priceToken0InToken1: string; // How much of Token1 for one unit of Token0
    priceToken1InToken0: string; // How much of Token0 for one unit of Token1
    lastUpdatedAt: number; // Timestamp of when this price info was fetched/calculated
}

// Simple in-memory cache for prices to avoid excessive RPC calls
interface PriceCacheEntry extends DexPairPriceInfo {
    timestamp: number;
}
const PRICE_CACHE_TTL_MS = 10 * 1000; // Cache prices for 10 seconds, for example

export class PriceService {
    private priceCache: Map<string, PriceCacheEntry> = new Map(); // key: pairAddress_network

    constructor(
        private scService: SmartContractInteractionService,
        private configService: ConfigService // May not be directly needed if pair info is passed in
    ) {
        logger.info('PriceService: Initialized.');
    }

    /**
     * Fetches reserves for a DEX pair and calculates relative prices.
     * @param pairAddress The blockchain address of the DEX liquidity pair.
     * @param token0Info Information about token0 (address, decimals, symbol, name).
     * @param token1Info Information about token1 (address, decimals, symbol, name).
     * @param dexName A human-readable name for the DEX (e.g., "UniswapV2").
     * @param network The blockchain network (e.g., "mainnet").
     * @returns DexPairPriceInfo or null if fetching fails.
     */
    public async getDexPairPrices(
        pairAddress: string,
        token0Info: TokenInfo,
        token1Info: TokenInfo,
        dexName: string,
        network: string = 'mainnet'
    ): Promise<DexPairPriceInfo | null> {
        const cacheKey = `${pairAddress}_${network}`;
        const cached = this.priceCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < PRICE_CACHE_TTL_MS)) {
            logger.debug(`PriceService: Returning cached price for ${pairAddress} on ${network}`);
            return cached;
        }

        logger.debug(`PriceService: Fetching live prices for pair ${pairAddress} (${token0Info.symbol}/${token1Info.symbol}) on ${dexName}, network ${network}.`);

        const reservesData = await this.scService.getPairReserves(pairAddress, network);
        if (!reservesData) {
            logger.warn(`PriceService: Could not fetch reserves for pair ${pairAddress}.`);
            return null;
        }

        const { reserve0, reserve1, blockTimestampLast } = reservesData;

        if (reserve0.isZero() || reserve1.isZero()) {
            logger.warn(`PriceService: Pair ${pairAddress} has zero reserves for one or both tokens. Cannot calculate price.`);
            return null;
        }

        try {
            // Amount of token1 needed for 1 unit of token0
            const priceToken0InToken1 = ethers.utils.formatUnits(
                reserve1.mul(ethers.utils.parseUnits("1", token0Info.decimals)).div(reserve0),
                token1Info.decimals
            );

            // Amount of token0 needed for 1 unit of token1
            const priceToken1InToken0 = ethers.utils.formatUnits(
                reserve0.mul(ethers.utils.parseUnits("1", token1Info.decimals)).div(reserve1),
                token0Info.decimals
            );

            const priceInfo: DexPairPriceInfo = {
                pairAddress,
                dexName,
                token0: token0Info,
                token1: token1Info,
                reserve0,
                reserve1,
                blockTimestampLast,
                priceToken0InToken1,
                priceToken1InToken0,
                lastUpdatedAt: Date.now()
            };

            this.priceCache.set(cacheKey, { ...priceInfo, timestamp: Date.now() });
            logger.debug({ pair: pairAddress, priceT0inT1: priceToken0InToken1, priceT1inT0: priceToken1InToken0 }, `PriceService: Updated prices for ${token0Info.symbol}/${token1Info.symbol} on ${dexName}.`);
            return priceInfo;

        } catch (error) {
            logger.error({ err: error, pairAddress }, `PriceService: Error calculating prices for pair ${pairAddress}.`);
            return null;
        }
    }

    /**
     * Gets the USD price of a token, typically the base token like WETH.
     * For MVP, this might be a hardcoded value or fetched from a simple, less frequent source.
     * A full implementation would use a robust oracle or CEX feed.
     * @param tokenSymbol Symbol of the token (e.g., "WETH").
     * @returns USD price as a number, or a default/error value.
     */
    public async getUsdPrice(tokenSymbol: string): Promise<number> {
        // MVP Placeholder: In a real system, this would query an oracle or reliable CEX price feed.
        // For now, let's assume WETH is the base and use a placeholder value.
        if (tokenSymbol.toUpperCase() === 'WETH' || tokenSymbol.toUpperCase() === 'ETH') {
            // This should come from config or a dynamic feed for real use.
            const wethUsdPrice = parseFloat(this.configService.get('WETH_USD_PRICE_ESTIMATE') || '2000.0');
            logger.debug(`PriceService: Returning USD price for ${tokenSymbol}: ${wethUsdPrice} (MVP placeholder/config)`);
            return wethUsdPrice;
        }
        logger.warn(`PriceService: USD price for ${tokenSymbol} not available in MVP. Returning 0.`);
        return 0; // Or throw an error
    }
}

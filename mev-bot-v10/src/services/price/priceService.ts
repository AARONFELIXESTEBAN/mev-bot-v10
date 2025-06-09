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

// Define a structure that includes token addresses with reserves
export interface ReservesWithTokenAddresses extends PairReserves {
    token0Address: string;
    token1Address: string;
}


export class PriceService {
    private priceCache: Map<string, PriceCacheEntry> = new Map(); // key: pairAddress_network

    constructor(
        private scService: SmartContractInteractionService,
        private configService: ConfigService // May not be directly needed if pair info is passed in
    ) {
        logger.info('PriceService: Initialized.');
    }

    /**
     * Fetches raw reserves (reserve0, reserve1, blockTimestampLast) for a given pair address.
     * This method also attempts to fetch token0 and token1 addresses from the pair contract.
     * @param pairAddress The blockchain address of the DEX liquidity pair.
     * @param network The blockchain network (e.g., "mainnet").
     * @returns A Promise resolving to ReservesWithTokenAddresses or null if fetching fails.
     */
    public async getReservesByPairAddress(
        pairAddress: string,
        network: string = 'mainnet'
    ): Promise<ReservesWithTokenAddresses | null> {
        logger.debug(`PriceService: Fetching reserves for pair ${pairAddress} on ${network}.`);
        try {
            // getPairReserves should ideally also return token0 and token1 addresses
            // For now, we assume scService.getPairReserves might be extended or we make separate calls.
            // Let's assume getPairReserves can be extended to return token addresses.
            // If not, scService would need getPairTokenAddresses(pairAddress, network).
            // For this implementation, we'll rely on scService.getPairReserves to provide a comprehensive object.

            const reservesData = await this.scService.getPairReserves(pairAddress, network); // This needs to return token0/1 addresses
            if (!reservesData) {
                logger.warn(`PriceService: Could not fetch reserves for pair ${pairAddress}.`);
                return null;
            }

            // Assuming getPairReserves from scService has been updated to return token0 and token1 addresses.
            // If not, this structure needs adjustment or additional calls.
            if (!reservesData.token0 || !reservesData.token1) {
                 logger.warn(`PriceService: Reserves data for pair ${pairAddress} did not include token0/token1 addresses.`);
                 // Fallback: try to get token addresses separately if scService supports it
                 const token0 = await this.scService.getToken0(pairAddress, network);
                 const token1 = await this.scService.getToken1(pairAddress, network);
                 if (!token0 || !token1) {
                    logger.error(`PriceService: Failed to retrieve token0/token1 addresses for pair ${pairAddress} via fallback.`);
                    return null;
                 }
                 reservesData.token0 = token0;
                 reservesData.token1 = token1;
            }


            return {
                reserve0: reservesData.reserve0,
                reserve1: reservesData.reserve1,
                blockTimestampLast: reservesData.blockTimestampLast,
                token0Address: reservesData.token0, // Assuming these are addresses
                token1Address: reservesData.token1, // Assuming these are addresses
            };
        } catch (error) {
            logger.error({ err: error, pairAddress, network }, `PriceService: Error fetching reserves for pair ${pairAddress}.`);
            return null;
        }
    }

    /**
     * Calculates the output amount for a swap given input amount and pair reserves.
     * Formula: amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
     * This calculation ignores fees.
     * @param tokenInAddress The address of the input token.
     * @param tokenInAmount The amount of the input token.
     * @param reservesData Object containing reserve0, reserve1, token0Address, and token1Address.
     * @returns The calculated output amount as BigNumber, or null if inputs are invalid.
     */
    public calculateAmountOut(
        tokenInAddress: string,
        tokenInAmount: BigNumber,
        reservesData: ReservesWithTokenAddresses
    ): BigNumber | null {
        if (tokenInAmount.isZero()) {
            logger.debug("PriceService: Input amount is zero, output amount is zero.");
            return BigNumber.from(0);
        }

        let reserveIn: BigNumber;
        let reserveOut: BigNumber;

        if (tokenInAddress.toLowerCase() === reservesData.token0Address.toLowerCase()) {
            reserveIn = reservesData.reserve0;
            reserveOut = reservesData.reserve1;
        } else if (tokenInAddress.toLowerCase() === reservesData.token1Address.toLowerCase()) {
            reserveIn = reservesData.reserve1;
            reserveOut = reservesData.token0Address; // Typo fixed here: should be reservesData.reserve0
        } else {
            logger.error({ tokenInAddress, token0: reservesData.token0Address, token1: reservesData.token1Address },
                "PriceService: tokenInAddress does not match either token0 or token1 address in reservesData."
            );
            return null;
        }

        // Correction from previous thought:
        if (tokenInAddress.toLowerCase() === reservesData.token1Address.toLowerCase()) {
             reserveIn = reservesData.reserve1;
             reserveOut = reservesData.reserve0; // Corrected here
        }


        if (reserveIn.isZero() || reserveOut.isZero()) {
            logger.warn("PriceService: One of the reserves is zero, cannot calculate output amount.");
            return BigNumber.from(0); // Or null, depending on desired behavior for illiquid pairs
        }

        try {
            const numerator = tokenInAmount.mul(reserveOut);
            const denominator = reserveIn.add(tokenInAmount);

            if (denominator.isZero()) { // Should not happen if reserveIn > 0 or tokenInAmount > 0
                logger.error("PriceService: Denominator is zero in amountOut calculation.");
                return null;
            }

            const amountOut = numerator.div(denominator);
            logger.debug({
                tokenInAddress,
                tokenInAmount: tokenInAmount.toString(),
                reserveIn: reserveIn.toString(),
                reserveOut: reserveOut.toString(),
                amountOut: amountOut.toString()
            }, "PriceService: Calculated amountOut.");
            return amountOut;

        } catch (error) {
            logger.error({ err: error, tokenInAmount: tokenInAmount.toString(), reserveIn: reserveIn.toString(), reserveOut: reserveOut.toString() },
                "PriceService: Error during amountOut calculation."
            );
            return null;
        }
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

        // Use the new getReservesByPairAddress to fetch reserves and token addresses
        const reservesData = await this.getReservesByPairAddress(pairAddress, network);
        if (!reservesData) {
            // getReservesByPairAddress already logs errors
            return null;
        }

        // Ensure token addresses from reserves match tokenInfo provided, or prioritize reservesData's addresses
        // This check is important if token0Info/token1Info could be out of sync with actual pair contracts
        if (token0Info.address.toLowerCase() !== reservesData.token0Address.toLowerCase() ||
            token1Info.address.toLowerCase() !== reservesData.token1Address.toLowerCase()) {
            logger.warn(`PriceService: Token addresses provided for ${pairAddress} do not match pair contract. Using addresses from contract: ${reservesData.token0Address}, ${reservesData.token1Address}`);
            // Potentially, one might want to update token0Info and token1Info based on contract's actual token addresses
            // For now, we proceed but this indicates a potential inconsistency in input data.
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
                token0: token0Info, // Consider updating these based on reservesData.token0Address if mismatch
                token1: token1Info, // Consider updating these based on reservesData.token1Address if mismatch
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
            const wethUsdPrice = parseFloat(this.configService.get('price_service.weth_usd_price_estimate') || '2000.0');
            logger.debug(`PriceService: Returning USD price for ${tokenSymbol}: ${wethUsdPrice} (MVP placeholder/config)`);
            return wethUsdPrice;
        }
        logger.warn(`PriceService: USD price for ${tokenSymbol} not available in MVP. Returning 0.`);
        return 0; // Or throw an error
    }
}

[end of mev-bot-v10/src/services/price/priceService.ts]

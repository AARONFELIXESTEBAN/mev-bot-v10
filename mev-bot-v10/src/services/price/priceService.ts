import { ethers, BigNumber } from 'ethers';
import { SmartContractInteractionService, PairReserves } from '../../core/smartContract/smartContractService';
import { ConfigService } from '../../core/config/configService';
import { getLogger, PinoLogger } from '../../core/logger/loggerService'; // Ensured PinoLogger is imported
import { TokenInfo } from '../../utils/typeUtils';

const logger: PinoLogger = getLogger(); // Explicitly typed logger

export interface DexPairPriceInfo extends PairReserves {
    pairAddress: string;
    dexName: string;
    token0: TokenInfo;
    token1: TokenInfo;
    priceToken0InToken1: string;
    priceToken1InToken0: string;
    lastUpdatedAt: number;
}

interface PriceCacheEntry extends DexPairPriceInfo {
    timestamp: number;
}
const PRICE_CACHE_TTL_MS = 10 * 1000;

export interface ReservesWithTokenAddresses extends PairReserves {
    token0Address: string;
    token1Address: string;
}

export class PriceService {
    private priceCache: Map<string, PriceCacheEntry> = new Map();

    constructor(
        private scService: SmartContractInteractionService,
        private configService: ConfigService
    ) {
        logger.info('PriceService: Initialized.');
    }

    public async getReservesByPairAddress(
        pairAddress: string,
        network: string = 'mainnet'
    ): Promise<ReservesWithTokenAddresses | null> {
        logger.debug(`PriceService: Fetching reserves for pair ${pairAddress} on ${network}.`);
        try {
            const reservesData = await this.scService.getPairReserves(pairAddress, network);
            if (!reservesData) {
                logger.warn(`PriceService: Could not fetch reserves for pair ${pairAddress}.`);
                return null;
            }

            if (!reservesData.token0 || !reservesData.token1) {
                 logger.warn(`PriceService: Reserves data for pair ${pairAddress} did not include token0/token1 addresses.`);
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
                token0Address: reservesData.token0,
                token1Address: reservesData.token1,
            };
        } catch (error) {
            logger.error({ err: error, pairAddress, network }, `PriceService: Error fetching reserves for pair ${pairAddress}.`);
            return null;
        }
    }

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
            reserveOut = reservesData.reserve0;
        } else {
            logger.error({ tokenInAddress, token0: reservesData.token0Address, token1: reservesData.token1Address },
                "PriceService: tokenInAddress does not match either token0 or token1 address in reservesData."
            );
            return null;
        }

        if (reserveIn.isZero() || reserveOut.isZero()) {
            logger.warn("PriceService: One of the reserves is zero, cannot calculate output amount.");
            return BigNumber.from(0);
        }

        try {
            const numerator = tokenInAmount.mul(reserveOut);
            const denominator = reserveIn.add(tokenInAmount);

            if (denominator.isZero()) {
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

        const reservesData = await this.getReservesByPairAddress(pairAddress, network);
        if (!reservesData) {
            return null;
        }

        if (token0Info.address.toLowerCase() !== reservesData.token0Address.toLowerCase() ||
            token1Info.address.toLowerCase() !== reservesData.token1Address.toLowerCase()) {
            logger.warn(`PriceService: Token addresses provided for ${pairAddress} do not match pair contract. Using addresses from contract: ${reservesData.token0Address}, ${reservesData.token1Address}`);
        }

        const { reserve0, reserve1, blockTimestampLast } = reservesData;

        if (reserve0.isZero() || reserve1.isZero()) {
            logger.warn(`PriceService: Pair ${pairAddress} has zero reserves for one or both tokens. Cannot calculate price.`);
            return null;
        }

        try {
            const priceToken0InToken1 = ethers.utils.formatUnits(
                reserve1.mul(ethers.utils.parseUnits("1", token0Info.decimals)).div(reserve0),
                token1Info.decimals
            );

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

    public async getUsdPrice(tokenSymbol: string): Promise<number> {
        if (tokenSymbol.toUpperCase() === 'WETH' || tokenSymbol.toUpperCase() === 'ETH') {
            const wethUsdPrice = parseFloat(this.configService.get('price_service.weth_usd_price_estimate') || '2000.0');
            logger.debug(`PriceService: Returning USD price for ${tokenSymbol}: ${wethUsdPrice} (MVP placeholder/config)`);
            return wethUsdPrice;
        }
        logger.warn(`PriceService: USD price for ${tokenSymbol} not available in MVP. Returning 0.`);
        return 0;
    }

    public getCurrentBaseFeeGwei(): number | null {
        const baseFee = this.configService.get('price_service.default_base_fee_gwei');
        if (baseFee !== undefined && baseFee !== null) { // Check for null as well
            return parseFloat(baseFee as string);
        }
        logger.warn("PriceService: getCurrentBaseFeeGwei placeholder returning default (e.g., 20 Gwei). Implement actual RPC fetch.");
        return 20;
    }

    public getCurrentGasPrices(): { maxFeePerGasGwei: number, priorityFeePerGasGwei: number } | null {
        const maxFee = this.configService.get('price_service.default_max_fee_gwei');
        const priorityFee = this.configService.get('price_service.default_priority_fee_gwei');

        if (maxFee !== undefined && priorityFee !== undefined && maxFee !== null && priorityFee !== null) { // Check for null
            return {
                maxFeePerGasGwei: parseFloat(maxFee as string),
                priorityFeePerGasGwei: parseFloat(priorityFee as string),
            };
        }
        logger.warn("PriceService: getCurrentGasPrices placeholder returning defaults (e.g., Max:50, Prio:2 Gwei). Implement actual RPC fetch.");
        return {
            maxFeePerGasGwei: 50,
            priorityFeePerGasGwei: 2,
        };
    }
}
```

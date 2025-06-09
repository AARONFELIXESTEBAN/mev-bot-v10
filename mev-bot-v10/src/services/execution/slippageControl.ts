import { getLogger, PinoLogger } from '../../core/logger/loggerService';
import { ConfigService } from '../../core/config/configService';
import { PriceService } from '../price/priceService'; // For volatility or liquidity data if available
import { PathSegment } from '@utils/typeUtils'; // Changed from PotentialOpportunityPathSegment
import { EspPredictionResult } from '../esp/espService';
import { ethers, BigNumber } from 'ethers';

export class AdvancedSlippageControlModule {
    private logger: PinoLogger;
    private configService: ConfigService;
    private priceService: PriceService; // Optional, for future enhancements

    private baseMaxSlippageBps: number; // Basis points, e.g., 10 for 0.1%

    constructor(configService: ConfigService, priceService: PriceService) {
        this.logger = getLogger('AdvancedSlippageControlModule');
        this.configService = configService;
        this.priceService = priceService; // Store for future use

        this.baseMaxSlippageBps = parseInt(
            (this.configService.get('execution_config.max_slippage_bps_v10_base') as string || '10') // Default 0.1% = 10bps
        );
        this.logger.info(`Initialized with baseMaxSlippageBps: ${this.baseMaxSlippageBps} bps`);
    }

    /**
     * Calculates amountOutMin for a given swap segment.
     * @param expectedAmountOut The amount expected from the simulation without slippage.
     * @param segment The path segment for which to calculate slippage. tokenOutDecimals is important.
     * @param espResult Optional ESP prediction result to adjust slippage.
     * @returns The minimum amount out acceptable for this swap.
     */
    public getAmountOutMin(
        expectedAmountOut: BigNumber,
        segment: PathSegment,
        espResult?: EspPredictionResult
    ): BigNumber {
        let slippageToApplyBps = this.baseMaxSlippageBps;

        // Alpha MVP: Simple strategy - use configured base slippage.
        // More advanced: Adjust based on token volatility, DEX liquidity, ESP score.
        // Example of ESP-based adjustment (can be refined):
        if (espResult && espResult.executionSuccessProbability < 0.65 && espResult.executionSuccessProbability >= 0.5) {
            // For medium confidence, slightly tighten slippage if possible
            slippageToApplyBps = Math.max(5, Math.floor(this.baseMaxSlippageBps * 0.75)); // e.g., 75% of base, but at least 5bps
            this.logger.debug(`Using tighter slippage (${slippageToApplyBps} bps) due to moderate ESP score: ${espResult.executionSuccessProbability.toFixed(3)}`);
        } else if (espResult && espResult.executionSuccessProbability < 0.5) {
            // For very low confidence, use very tight slippage (if tx is even attempted)
            slippageToApplyBps = Math.max(1, Math.floor(this.baseMaxSlippageBps * 0.5)); // e.g., 50% of base, but at least 1bps
            this.logger.debug(`Using very tight slippage (${slippageToApplyBps} bps) due to low ESP score: ${espResult.executionSuccessProbability.toFixed(3)}`);
        }
        // For high confidence (e.g. > 0.75 or > 0.85), one might consider if baseMaxSlippageBps is already optimal
        // or if a slightly wider one is acceptable for higher inclusion probability, but this is risky.
        // Sticking to baseMaxSlippageBps or tighter is generally safer.

        // amountOutMin = expectedAmountOut * (1 - slippageTolerance)
        // expectedAmountOut * (10000 - slippageBps) / 10000
        const amountOutMin = expectedAmountOut.mul(BigNumber.from(10000 - slippageToApplyBps)).div(BigNumber.from(10000));

        const tokenOutDecimals = segment.tokenOutDecimals !== undefined ? segment.tokenOutDecimals : 18; // Default to 18 if not specified


        this.logger.info(
            `Calculated amountOutMin for segment ${segment.tokenInSymbol}->${segment.tokenOutSymbol} on ${segment.dexName}: ` +
            `${ethers.utils.formatUnits(amountOutMin, tokenOutDecimals)} ` +
            `(Expected: ${ethers.utils.formatUnits(expectedAmountOut, tokenOutDecimals)}, Slippage: ${slippageToApplyBps} bps)`
        );
        return amountOutMin;
    }
}
```

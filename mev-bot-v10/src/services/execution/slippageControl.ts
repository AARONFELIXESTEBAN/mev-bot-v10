import { ethers } from 'ethers';
import { getLogger, PinoLogger } from '@core/logger/loggerService';
import { ConfigService } from '@core/config/configService';
import { PotentialOpportunity, PathSegment } from '@shared/types';

export class SlippageControlService {
  private logger: PinoLogger;
  private configService: ConfigService;
  private maxSlippagePercent: number;

  constructor(configService: ConfigService) {
    this.logger = getLogger('SlippageControlService');
    this.configService = configService;
    this.maxSlippagePercent = Number(this.configService.get('execution_config.max_slippage_percent') || 1);
    this.logger.info(`Initialized with max slippage: ${this.maxSlippagePercent}%`);
  }

  public calculateMinAmountOut(
    opportunity: PotentialOpportunity,
    expectedAmountOut: ethers.BigNumberish
  ): ethers.BigNumberish {
    const slippageFactor = 100 - this.maxSlippagePercent;
    const minAmountOut = (BigInt(expectedAmountOut) * BigInt(slippageFactor)) / 100n;
    this.logger.debug(`Calculated minAmountOut: ${minAmountOut} for expected: ${expectedAmountOut}`);
    return minAmountOut;
  }

  public validateSlippage(
    pathSegments: PathSegment[],
    expectedAmountsOut: ethers.BigNumberish[]
  ): boolean {
    if (pathSegments.length !== expectedAmountsOut.length) {
      this.logger.error('Mismatch between path segments and amounts.');
      return false;
    }

    for (let i = 0; i < pathSegments.length; i++) {
      const minAmountOut = this.calculateMinAmountOut(
        { path: pathSegments, entryAmountBase: pathSegments[0].amountIn } as PotentialOpportunity,
        expectedAmountsOut[i]
      );
      if (BigInt(pathSegments[i].amountOutMin) < BigInt(minAmountOut)) {
        this.logger.warn(`Slippage too high for segment ${i}.`);
        return false;
      }
    }
    return true;
  }
}
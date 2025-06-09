import { getLogger, PinoLogger } from '../../core/logger/loggerService';
import { ConfigService } from '../../core/config/configService';
import { RpcService } from '../../core/rpc/rpcService'; // To get current base fee, priority fee estimates
import { PotentialOpportunity } from '../opportunity/opportunityService'; // If opportunity value influences gas
import { EspPredictionResult } from '../esp/espService'; // If ESP score influences gas
import { ethers } from 'ethers';

export interface GasParams {
    maxFeePerGas: ethers.BigNumber;
    maxPriorityFeePerGas: ethers.BigNumber;
}

export class DynamicGasStrategyModule {
    private logger: PinoLogger;
    private configService: ConfigService;
    private rpcService: RpcService;

    private basePriorityFeeWei_V10: ethers.BigNumber;
    private maxGasPriceWei_V10: ethers.BigNumber; // Absolute ceiling for maxFeePerGas

    constructor(configService: ConfigService, rpcService: RpcService) {
        this.logger = getLogger('DynamicGasStrategyModule');
        this.configService = configService;
        this.rpcService = rpcService;

        this.basePriorityFeeWei_V10 = ethers.utils.parseUnits(
            (this.configService.get('execution_config.base_priority_fee_gwei_v10') as string || '1'), // Default 1 Gwei
            'gwei'
        );
        this.maxGasPriceWei_V10 = ethers.utils.parseUnits(
            (this.configService.get('execution_config.max_gas_price_gwei_v10') as string || '250'), // Default 250 Gwei
            'gwei'
        );
        this.logger.info(`Initialized with basePriorityFee: ${ethers.utils.formatUnits(this.basePriorityFeeWei_V10, 'gwei')} Gwei, maxGasPrice: ${ethers.utils.formatUnits(this.maxGasPriceWei_V10, 'gwei')} Gwei`);
    }

    public async getOptimalGas(
        network: string = 'mainnet', // Network context for RPC calls
        opportunity?: PotentialOpportunity, // Optional: For opportunity value based bidding
        espResult?: EspPredictionResult     // Optional: For ESP confidence based bidding
    ): Promise<GasParams> {
        this.logger.debug("Calculating optimal gas parameters...");

        let currentBaseFee: ethers.BigNumber;
        let suggestedPriorityFee: ethers.BigNumber;

        try {
            const feeData = await this.rpcService.getFeeData(network);
            if (!feeData || !feeData.lastBaseFeePerGas || !feeData.maxPriorityFeePerGas) {
                this.logger.warn("Could not retrieve full fee data from RPC. Using default priority fee and estimated base fee if possible.");
                currentBaseFee = feeData?.lastBaseFeePerGas || ethers.utils.parseUnits(this.configService.get('price_service.default_base_fee_gwei') as string || '15', 'gwei'); // Fallback base fee
                suggestedPriorityFee = this.basePriorityFeeWei_V10;
            } else {
                currentBaseFee = feeData.lastBaseFeePerGas;
                suggestedPriorityFee = feeData.maxPriorityFeePerGas;
                 this.logger.debug(`RPC fee data: lastBaseFeePerGas: ${ethers.utils.formatUnits(currentBaseFee, 'gwei')}, suggested maxPriorityFeePerGas: ${ethers.utils.formatUnits(suggestedPriorityFee, 'gwei')}`);
            }
        } catch (error) {
            this.logger.error({ err: error }, "Error fetching fee data from RPC. Using default priority and estimated base fee.");
            currentBaseFee = ethers.utils.parseUnits(this.configService.get('price_service.default_base_fee_gwei') as string || '15', 'gwei'); // Fallback base fee
            suggestedPriorityFee = this.basePriorityFeeWei_V10;
        }

        let calculatedPriorityFee = suggestedPriorityFee;

        if (espResult && espResult.executionSuccessProbability > 0.75) {
            calculatedPriorityFee = calculatedPriorityFee.mul(120).div(100);
            this.logger.debug(`Increased priority fee by 20% due to high ESP score (${espResult.executionSuccessProbability.toFixed(2)}) to ${ethers.utils.formatUnits(calculatedPriorityFee, 'gwei')} Gwei`);
        } else {
            if (calculatedPriorityFee.lt(this.basePriorityFeeWei_V10)) {
                this.logger.debug(`RPC suggested priority fee (${ethers.utils.formatUnits(calculatedPriorityFee, 'gwei')}) is less than configured base (${ethers.utils.formatUnits(this.basePriorityFeeWei_V10, 'gwei')}). Using configured base.`);
                calculatedPriorityFee = this.basePriorityFeeWei_V10;
            }
        }

        // Calculate maxFeePerGas: typically 1.5x to 2x currentBaseFee + maxPriorityFeePerGas
        // Using 2x as a common strategy for quick inclusion.
        let calculatedMaxFee = currentBaseFee.mul(2).add(calculatedPriorityFee);

        if (calculatedMaxFee.gt(this.maxGasPriceWei_V10)) {
            this.logger.warn(`Calculated maxFeePerGas (${ethers.utils.formatUnits(calculatedMaxFee, 'gwei')}) exceeds absolute ceiling. Capping to ${ethers.utils.formatUnits(this.maxGasPriceWei_V10, 'gwei')}.`);
            calculatedMaxFee = this.maxGasPriceWei_V10;

            if (calculatedPriorityFee.gt(calculatedMaxFee.sub(currentBaseFee))) {
                // Ensure priority fee is not so high that tx becomes non-executable with current base fee
                calculatedPriorityFee = calculatedMaxFee.sub(currentBaseFee);
                if(calculatedPriorityFee.lt(0)) { // Should only happen if maxGasPrice < currentBaseFee
                     this.logger.warn(`maxGasPriceWei_V10 (${ethers.utils.formatUnits(this.maxGasPriceWei_V10, 'gwei')}) is less than currentBaseFee (${ethers.utils.formatUnits(currentBaseFee, 'gwei')}). Setting priority fee to 0.`);
                     calculatedPriorityFee = ethers.BigNumber.from(0);
                }
            }
        }

        if (calculatedPriorityFee.gt(calculatedMaxFee)) {
            // This should ideally not happen if logic above is correct, but as a safeguard:
            this.logger.warn(`Adjusting maxPriorityFeePerGas (${ethers.utils.formatUnits(calculatedPriorityFee, 'gwei')}) as it was greater than maxFeePerGas (${ethers.utils.formatUnits(calculatedMaxFee, 'gwei')}). Setting to maxFeePerGas.`);
            calculatedPriorityFee = calculatedMaxFee;
        }

        this.logger.info(`Calculated Gas Params: maxFeePerGas: ${ethers.utils.formatUnits(calculatedMaxFee, 'gwei')} Gwei, maxPriorityFeePerGas: ${ethers.utils.formatUnits(calculatedPriorityFee, 'gwei')} Gwei`);

        return {
            maxFeePerGas: calculatedMaxFee,
            maxPriorityFeePerGas: calculatedPriorityFee,
        };
    }
}
```

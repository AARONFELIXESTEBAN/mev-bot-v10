import { getLogger, PinoLogger } from '@core/logger/loggerService';
import { ConfigService } from '@core/config/configService';
import { PotentialOpportunity } from '@services/opportunity/opportunityService';
import { EspPredictionResult } from '@services/esp/espService';
import { ethers } from 'ethers';

interface RpcService {
    getProvider(network: string, type: 'http' | 'ws'): ethers.JsonRpcProvider;
    getFeeData(network: string): Promise<{
        lastBaseFeePerGas?: ethers.BigNumberish;
        maxPriorityFeePerGas?: ethers.BigNumberish;
    }>;
}

export interface GasParams {
    maxFeePerGas: ethers.BigNumberish;
    maxPriorityFeePerGas: ethers.BigNumberish;
}

export class DynamicGasStrategyModule {
    private logger: PinoLogger;
    private configService: ConfigService;
    private rpcService: RpcService;

    private basePriorityFeeWei_V10: ethers.BigNumberish;
    private maxGasPriceWei_V10: ethers.BigNumberish;

    constructor(configService: ConfigService, rpcService: RpcService) {
        this.logger = getLogger('DynamicGasStrategyModule');
        this.configService = configService;
        this.rpcService = rpcService;

        this.basePriorityFeeWei_V10 = ethers.parseUnits(
            (this.configService.get('execution_config.base_priority_fee_gwei_v10') as string || '1'),
            'gwei'
        );
        this.maxGasPriceWei_V10 = ethers.parseUnits(
            (this.configService.get('execution_config.max_gas_price_gwei_v10') as string || '250'),
            'gwei'
        );
        this.logger.info(`Initialized with basePriorityFee: ${ethers.formatUnits(this.basePriorityFeeWei_V10, 'gwei')} Gwei, maxGasPrice: ${ethers.formatUnits(this.maxGasPriceWei_V10, 'gwei')} Gwei`);
    }

    public async getOptimalGas(
        network: string = 'mainnet',
        opportunity?: PotentialOpportunity,
        espResult?: EspPredictionResult
    ): Promise<GasParams> {
        this.logger.debug("Calculating optimal gas parameters...");

        let currentBaseFee: ethers.BigNumberish;
        let suggestedPriorityFee: ethers.BigNumberish;

        try {
            const feeData = await this.rpcService.getFeeData(network);
            if (!feeData || !feeData.lastBaseFeePerGas || !feeData.maxPriorityFeePerGas) {
                this.logger.warn("Could not retrieve full fee data from RPC. Using default priority fee and estimated base fee if possible.");
                currentBaseFee = feeData?.lastBaseFeePerGas || ethers.parseUnits(this.configService.get('price_service.default_base_fee_gwei') as string || '15', 'gwei');
                suggestedPriorityFee = this.basePriorityFeeWei_V10;
            } else {
                currentBaseFee = feeData.lastBaseFeePerGas;
                suggestedPriorityFee = feeData.maxPriorityFeePerGas;
                this.logger.debug(`RPC fee data: lastBaseFeePerGas: ${ethers.formatUnits(currentBaseFee, 'gwei')} Gwei, suggested maxPriorityFeePerGas: ${ethers.formatUnits(suggestedPriorityFee, 'gwei')} Gwei`);
            }
        } catch (error: any) {
            this.logger.error({ err: error.message }, "Error fetching fee data from RPC. Using default priority and estimated base fee.");
            currentBaseFee = ethers.parseUnits(this.configService.get('price_service.default_base_fee_gwei') as string || '15', 'gwei');
            suggestedPriorityFee = this.basePriorityFeeWei_V10;
        }

        let calculatedPriorityFee = BigInt(suggestedPriorityFee);

        if (espResult && espResult.executionSuccessProbability > 0.75) {
            calculatedPriorityFee = (calculatedPriorityFee * 120n) / 100n;
            this.logger.debug(`Increased priority fee by 20% due to high ESP score (${espResult.executionSuccessProbability.toFixed(2)}) to ${ethers.formatUnits(calculatedPriorityFee, 'gwei')} Gwei`);
        } else {
            if (calculatedPriorityFee < BigInt(this.basePriorityFeeWei_V10)) {
                this.logger.debug(`RPC suggested priority fee (${ethers.formatUnits(calculatedPriorityFee, 'gwei')} Gwei) is less than configured base (${ethers.formatUnits(this.basePriorityFeeWei_V10, 'gwei')} Gwei). Using configured base.`);
                calculatedPriorityFee = BigInt(this.basePriorityFeeWei_V10);
            }
        }

        let calculatedMaxFee = BigInt(currentBaseFee) * 2n + calculatedPriorityFee;

        if (calculatedMaxFee > BigInt(this.maxGasPriceWei_V10)) {
            this.logger.warn(`Calculated maxFeePerGas (${ethers.formatUnits(calculatedMaxFee, 'gwei')} Gwei) exceeds absolute ceiling. Capping to ${ethers.formatUnits(this.maxGasPriceWei_V10, 'gwei')} Gwei.`);
            calculatedMaxFee = BigInt(this.maxGasPriceWei_V10);

            if (calculatedPriorityFee > calculatedMaxFee - BigInt(currentBaseFee)) {
                calculatedPriorityFee = calculatedMaxFee - BigInt(currentBaseFee);
                if (calculatedPriorityFee < 0) {
                    this.logger.warn(`maxGasPriceWei_V10 (${ethers.formatUnits(this.maxGasPriceWei_V10, 'gwei')} Gwei) is less than currentBaseFee (${ethers.formatUnits(currentBaseFee, 'gwei')} Gwei). Setting priority fee to 0.`);
                    calculatedPriorityFee = 0n;
                }
            }
        }

        if (calculatedPriorityFee > calculatedMaxFee) {
            this.logger.warn(`Adjusting maxPriorityFeePerGas (${ethers.formatUnits(calculatedPriorityFee, 'gwei')} Gwei) as it was greater than maxFeePerGas (${ethers.formatUnits(calculatedMaxFee, 'gwei')} Gwei). Setting to maxFeePerGas.`);
            calculatedPriorityFee = calculatedMaxFee;
        }

        this.logger.info(`Calculated Gas Params: maxFeePerGas: ${ethers.formatUnits(calculatedMaxFee, 'gwei')} Gwei, maxPriorityFeePerGas: ${ethers.formatUnits(calculatedPriorityFee, 'gwei')} Gwei`);

        return {
            maxFeePerGas: calculatedMaxFee,
            maxPriorityFeePerGas: calculatedPriorityFee,
        };
    }
}
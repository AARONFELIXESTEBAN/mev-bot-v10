import { ethers, BigNumber } from 'ethers';
import { ConfigService } from '../../core/config/configService';
import { getLogger } from '../../core/logger/loggerService';
import { RpcService } from '../../core/rpc/rpcService';
import { SmartContractInteractionService } from '../../core/smartContract/smartContractService';
import { PotentialOpportunity } from '../opportunity/opportunityService'; // Corrected path
import { PriceService } from '../price/price.service'; // Corrected path
import UniswapV2Router02ABI from '../../abis/UniswapV2Router02.json'; // For getAmountsOut

const logger = getLogger();

export interface SimulationResult {
    opportunity: PotentialOpportunity;
    pathId: string;
    isProfitable: boolean;
    grossProfitBaseToken: BigNumber;
    estimatedGasCostBaseToken: BigNumber;
    netProfitBaseToken: BigNumber;
    netProfitUsd: number;
    amountInLeg1: BigNumber;
    amountOutLeg1: BigNumber;
    amountOutLeg2: BigNumber;
    profitRealismCheckFailed?: boolean;
    maxProfitUsdCheckFailed?: boolean;
    freshnessCheckFailed?: boolean;
    blockAgeCheckFailed?: boolean;
    simulationTimestamp: number;
    error?: string;
}

export class SimulationService {
    private defaultSwapAmountBaseToken: BigNumber;
    private profitRealismMaxPercentage: number;
    private maxProfitUsd: number;
    private opportunityFreshnessLimitMs: number;
    private maxBlockAgeForOpportunity: number;
    private defaultSwapGasUnits: number;

    constructor(
        private configService: ConfigService,
        private rpcService: RpcService,
        private scService: SmartContractInteractionService,
        private priceService: PriceService
    ) {
        this.defaultSwapAmountBaseToken = ethers.utils.parseUnits(
            this.configService.get('DEFAULT_SWAP_AMOUNT_BASE_TOKEN') || '0.1',
            this.configService.get('BASE_TOKEN_DECIMALS') || 18
        );
        this.profitRealismMaxPercentage = parseFloat(this.configService.get('PROFIT_REALISM_MAX_PERCENTAGE') || '50.0');
        this.maxProfitUsd = parseFloat(this.configService.get('MAX_PROFIT_USD_V10') || '5000.0');
        this.opportunityFreshnessLimitMs = parseInt(this.configService.get('OPPORTUNITY_FRESHNESS_LIMIT_MS') || '15000', 10);
        this.maxBlockAgeForOpportunity = parseInt(this.configService.get('MAX_BLOCK_AGE_FOR_OPPORTUNITY') || '3', 10);
        this.defaultSwapGasUnits = parseInt(this.configService.get('DEFAULT_SWAP_GAS_UNITS') || '200000', 10);

        logger.info('SimulationService: Initialized with parameters:');
        logger.info(`  Default Swap Amount (Base Token): ${ethers.utils.formatUnits(this.defaultSwapAmountBaseToken, this.configService.get('BASE_TOKEN_DECIMALS') || 18)}`);
        logger.info(`  Profit Realism Max Percentage: ${this.profitRealismMaxPercentage}%`);
        logger.info(`  Max Profit USD V10: $${this.maxProfitUsd}`);
        logger.info(`  Opportunity Freshness Limit MS: ${this.opportunityFreshnessLimitMs}ms`);
        logger.info(`  Max Block Age for Opportunity: ${this.maxBlockAgeForOpportunity} blocks`);
        logger.info(`  Default Swap Gas Units: ${this.defaultSwapGasUnits}`);
    }

    private createErrorResult(
        opportunity: PotentialOpportunity,
        simTime: number,
        errorMsg: string,
        checkFailed?: { freshness?: boolean; blockAge?: boolean }
    ): SimulationResult {
        return {
            opportunity,
            pathId: opportunity.id,
            isProfitable: false,
            grossProfitBaseToken: BigNumber.from(0),
            estimatedGasCostBaseToken: BigNumber.from(0),
            netProfitBaseToken: BigNumber.from(0),
            netProfitUsd: 0,
            amountInLeg1: this.defaultSwapAmountBaseToken,
            amountOutLeg1: BigNumber.from(0),
            amountOutLeg2: BigNumber.from(0),
            simulationTimestamp: simTime,
            error: errorMsg,
            freshnessCheckFailed: checkFailed?.freshness,
            blockAgeCheckFailed: checkFailed?.blockAge,
        };
    }

    private async getRouterContract(dexName: string, network: string = 'mainnet'): Promise<ethers.Contract | null> {
        const routers = this.configService.getDexRouters(); // Use typed getter
        let routerAddress = routers[dexName];

        if (!routerAddress) {
            const dexNameLower = dexName.toLowerCase();
            if (dexNameLower.includes("uniswapv2")) routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Default UniV2
            else if (dexNameLower.includes("sushiswap")) routerAddress = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"; // Default Sushi
        }

        if (!routerAddress) {
            logger.error(`SimulationService: Router address for DEX "${dexName}" not found in configuration.`);
            return null;
        }
        return this.scService.getContract(routerAddress, UniswapV2Router02ABI, network);
    }

    public async simulateArbitragePath(
        opportunity: PotentialOpportunity,
        currentBlockNumber: number,
        network: string = 'mainnet'
    ): Promise<SimulationResult> {
        const simTime = Date.now();
        const baseTokenDecimals = opportunity.tokenPath[0].decimals;

        // 1. Opportunity Freshness (SSOT 8.3.B)
        if ((simTime - opportunity.discoveryTimestamp) > this.opportunityFreshnessLimitMs) {
            logger.warn({ pathId: opportunity.id }, "SimulationService: Opportunity failed freshness check (too old).");
            return this.createErrorResult(opportunity, simTime, "Freshness check failed (too old)", { freshness: true });
        }
        if (opportunity.blockNumber && (currentBlockNumber > 0 && (currentBlockNumber - opportunity.blockNumber > this.maxBlockAgeForOpportunity))) {
            logger.warn({ pathId: opportunity.id, currentBlock: currentBlockNumber, oppBlock: opportunity.blockNumber }, "SimulationService: Opportunity failed block age check.");
            return this.createErrorResult(opportunity, simTime, "Block age check failed", { blockAge: true });
        }

        const router1 = await this.getRouterContract(opportunity.leg1.dexName, network);
        const router2 = await this.getRouterContract(opportunity.leg2.dexName, network);

        if (!router1 || !router2) {
            return this.createErrorResult(opportunity, simTime, "Router contract(s) not found for simulation.");
        }

        let amountOutLeg1: BigNumber;
        let amountOutLeg2: BigNumber;

        try {
            const amounts1 = await router1.getAmountsOut(this.defaultSwapAmountBaseToken, [opportunity.tokenPath[0].address, opportunity.tokenPath[1].address]);
            amountOutLeg1 = amounts1[1];

            const amounts2 = await router2.getAmountsOut(amountOutLeg1, [opportunity.tokenPath[1].address, opportunity.tokenPath[2].address]);
            amountOutLeg2 = amounts2[1];

            logger.debug({pathId: opportunity.id, leg1In: this.defaultSwapAmountBaseToken.toString(), leg1Out: amountOutLeg1.toString(), leg2Out: amountOutLeg2.toString()}, "Simulation successful for both legs' getAmountsOut.");

        } catch (e: any) {
            logger.warn({ pathId: opportunity.id, err: e.message }, "SimulationService: Error during getAmountsOut simulation.");
            return this.createErrorResult(opportunity, simTime, `getAmountsOut failed: ${e.message}`);
        }

        const feeData = await this.rpcService.makeRpcCall(network, 'http', p => p.getFeeData());
        if (!feeData?.gasPrice) {
            logger.warn({ pathId: opportunity.id }, "SimulationService: Could not retrieve gas price for cost estimation.");
            return this.createErrorResult(opportunity, simTime, "Failed to get gas price.");
        }
        const gasPrice = feeData.gasPrice;
        const estimatedGasCostLeg1 = gasPrice.mul(this.defaultSwapGasUnits);
        const estimatedGasCostLeg2 = gasPrice.mul(this.defaultSwapGasUnits);
        const totalGasCostBaseToken = estimatedGasCostLeg1.add(estimatedGasCostLeg2);

        const grossProfitBaseToken = amountOutLeg2.sub(this.defaultSwapAmountBaseToken);
        const netProfitBaseToken = grossProfitBaseToken.sub(totalGasCostBaseToken);

        const baseTokenUsdPrice = await this.priceService.getUsdPrice(opportunity.tokenPath[0].symbol);
        const netProfitUsd = parseFloat(ethers.utils.formatUnits(netProfitBaseToken, baseTokenDecimals)) * baseTokenUsdPrice;

        const profitPercentage = !this.defaultSwapAmountBaseToken.isZero() ?
            grossProfitBaseToken.mul(10000).div(this.defaultSwapAmountBaseToken).toNumber() / 100 : 0;

        let profitRealismCheckFailed = false;
        if (profitPercentage > this.profitRealismMaxPercentage) {
            logger.warn({ pathId: opportunity.id, profitPercentage, max: this.profitRealismMaxPercentage }, "SimulationService: Potential profit failed realism check (too high %).");
            profitRealismCheckFailed = true;
        }

        let maxProfitUsdCheckFailed = false;
        if (netProfitUsd > this.maxProfitUsd) {
            logger.warn({ pathId: opportunity.id, netProfitUsd, max: this.maxProfitUsd }, "SimulationService: Potential profit failed USD limit check (too high USD).");
            maxProfitUsdCheckFailed = true;
        }

        const minNetProfitWei = BigNumber.from(this.configService.get('MIN_NET_PROFIT_BASE_TOKEN_WEI') || "0");
        const isProfitable = netProfitBaseToken.gt(minNetProfitWei);

        const finalResult: SimulationResult = {
            opportunity,
            pathId: opportunity.id,
            simulationTimestamp: simTime,
            amountInLeg1: this.defaultSwapAmountBaseToken,
            isProfitable: isProfitable && !profitRealismCheckFailed && !maxProfitUsdCheckFailed,
            grossProfitBaseToken,
            estimatedGasCostBaseToken: totalGasCostBaseToken,
            netProfitBaseToken,
            netProfitUsd,
            amountOutLeg1,
            amountOutLeg2,
            profitRealismCheckFailed,
            maxProfitUsdCheckFailed,
            // freshnessCheckFailed and blockAgeCheckFailed are already handled in early returns
        };

        if(finalResult.isProfitable) {
            logger.info({ pathId: opportunity.id, netProfitEth: ethers.utils.formatUnits(netProfitBaseToken, baseTokenDecimals), netProfitUsd: netProfitUsd.toFixed(2) }, "SimulationService: Profitable opportunity found and passed checks.");
        } else if (!finalResult.error && !finalResult.freshnessCheckFailed && !finalResult.blockAgeCheckFailed) { // Only log this if not already logged by an early exit
            logger.info({ pathId: opportunity.id, netProfitEth: ethers.utils.formatUnits(netProfitBaseToken, baseTokenDecimals), isProfitable, profitRealismCheckFailed, maxProfitUsdCheckFailed }, "SimulationService: Opportunity not profitable or failed secondary checks.");
        }

        return finalResult;
    }
}

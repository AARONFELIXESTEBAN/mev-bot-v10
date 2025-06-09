import { ethers, BigNumber, Overrides } from 'ethers'; // Added Overrides
import { ConfigService } from '@core/config/configService';
import { getLogger, PinoLogger } from '@core/logger/loggerService'; // Adjusted logger import
import { RpcService } from '@core/rpc/rpcService';
import { SmartContractInteractionService } from '@core/smartContract/smartContractService';
import { PotentialOpportunity, PathSegment } from '@services/opportunity/opportunityService'; // Added PathSegment
import { PriceService } from '@services/price/priceService';
import { GasParams } from '../execution/gasStrategy'; // Import GasParams

const logger: PinoLogger = getLogger(); // Explicitly type logger

export interface SimulatedPathSegmentDetails {
    segment: PathSegment; // The original segment from PotentialOpportunity
    expectedOutputAmount: BigNumber; // Output amount from this segment's simulation
    estimatedGasUnits: number; // Gas units for this specific swap
    // Potentially add routerAddress used, actual input amount for this leg if different from opp.entryAmountBase
}

export interface SimulationResult {
    opportunity: PotentialOpportunity;
    pathId: string;
    isProfitable: boolean;
    grossProfitBaseToken: BigNumber;
    estimatedGasCostBaseToken: BigNumber;
    netProfitBaseToken: BigNumber;
    netProfitUsd: number;
    amountInLeg1: BigNumber; // Initial amount input to the first leg
    // amountOutLeg1 and amountOutLeg2 can be inferred from pathSegmentSimulations[-1].expectedOutputAmount
    // but keeping them for now for direct access to final overall outputs.
    amountOutLeg1: BigNumber; // Final output of leg 1
    amountOutLeg2: BigNumber; // Final output of leg 2 (if 2-hop)
    pathSegmentSimulations: SimulatedPathSegmentDetails[]; // Detailed results for each leg
    gasParamsUsed?: GasParams; // Gas parameters used for this simulation run
    profitRealismCheckFailed?: boolean;
    maxProfitUsdCheckFailed?: boolean;
    freshnessCheckFailed?: boolean;
    blockAgeCheckFailed?: boolean;
    simulationTimestamp: number;
    error?: string;
}

export class SimulationService {
    private defaultSwapAmountBaseToken: BigNumber; // Initial amount for the *first* leg if not specified in opportunity
    private profitRealismMaxPercentage: number;
    private maxProfitUsd: number;
    private opportunityFreshnessLimitMs: number;
    private maxBlockAgeForOpportunity: number;
    private defaultSwapGasUnits: number; // Gas units for a single Uniswap V2 style swap

    constructor(
        private configService: ConfigService,
        private rpcService: RpcService,
        private scService: SmartContractInteractionService,
        private priceService: PriceService // For USD conversion of profit
    ) {
        this.defaultSwapAmountBaseToken = ethers.utils.parseUnits(
            this.configService.get('simulation_service.default_swap_amount_base_token') || '0.1', // e.g., 0.1 WETH
            this.configService.get('opportunity_service.base_token_decimals') || 18
        );
        this.profitRealismMaxPercentage = parseFloat(this.configService.get('simulation_service.profit_realism_max_percentage') || '50.0'); // 50%
        this.maxProfitUsd = parseFloat(this.configService.get('simulation_service.max_profit_usd_v10') || '5000.0'); // $5000
        this.opportunityFreshnessLimitMs = parseInt(this.configService.get('simulation_service.opportunity_freshness_limit_ms') || '15000', 10); // 15 seconds
        this.maxBlockAgeForOpportunity = parseInt(this.configService.get('simulation_service.max_block_age_for_opportunity') || '3', 10); // 3 blocks
        this.defaultSwapGasUnits = parseInt(this.configService.get('simulation_service.default_swap_gas_units') || '200000', 10);

        logger.info('SimulationService: Initialized with parameters:');
        logger.info(`  Default Swap Amount (Base Token): ${ethers.utils.formatUnits(this.defaultSwapAmountBaseToken, this.configService.get('opportunity_service.base_token_decimals') || 18)}`);
        logger.info(`  Profit Realism Max Percentage: ${this.profitRealismMaxPercentage}%`);
        logger.info(`  Max Profit USD V10: $${this.maxProfitUsd}`);
        logger.info(`  Opportunity Freshness Limit MS: ${this.opportunityFreshnessLimitMs}ms`);
        logger.info(`  Max Block Age for Opportunity: ${this.maxBlockAgeForOpportunity} blocks`);
        logger.info(`  Default Swap Gas Units: ${this.defaultSwapGasUnits}`);
    }

    private async getRouterContract(dexName: string, network: string = 'mainnet'): Promise<ethers.Contract | null> {
        // This should come from a more robust DEX registry in ConfigService or a dedicated DexRegistryService
        // Using a new config path for router addresses: 'opportunity_service.dex_routers'
        const routers = this.configService.get('opportunity_service.dex_routers') as { [name: string]: string } || {};

        let routerAddress = routers[dexName];
        if (!routerAddress) { // Fallback to check some common ones if not explicitly mapped by name
            if (dexName.toLowerCase().includes("uniswapv2")) routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
            else if (dexName.toLowerCase().includes("sushiswap")) routerAddress = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
        }

        if (!routerAddress) {
            logger.error(`SimulationService: Router address for DEX "${dexName}" not found in configuration.`);
            return null;
        }
        // Assuming UniswapV2Router02ABI is compatible for typical 2-hop swaps on these DEXs
        return this.scService.getContract(routerAddress, 'UniswapV2Router02', network);
    }

    public async simulateArbitragePath(
        opportunity: PotentialOpportunity,
        currentBlockNumber: number,
        network: string = 'mainnet',
        gasParamsOverride?: GasParams // Allow overriding gas params for pre-flight sim
    ): Promise<SimulationResult> {
        const simTime = Date.now();
        // Assuming opportunity.entryTokenAddress is the base token (e.g. WETH)
        // and its decimals are known or can be fetched via opportunity.path[0].tokenInDecimals
        const baseTokenDecimals = opportunity.path[0].tokenInDecimals;
        const amountInForLeg1 = opportunity.entryAmountBase || this.defaultSwapAmountBaseToken;

        // Initialize structure for path segment simulation details
        const pathSegmentSimulations: SimulatedPathSegmentDetails[] = [];

        // --- Pre-checks ---
        if ((simTime - opportunity.discoveryTimestamp) > this.opportunityFreshnessLimitMs) {
            logger.warn({ pathId: opportunity.id }, "SimulationService: Opportunity failed freshness check (too old).");
            return {
                opportunity, pathId: opportunity.id, simulationTimestamp: simTime,
                isProfitable: false, freshnessCheckFailed: true,
                grossProfitBaseToken: BigNumber.from(0), estimatedGasCostBaseToken: BigNumber.from(0),
                netProfitBaseToken: BigNumber.from(0), netProfitUsd: 0,
                amountInLeg1: amountInForLeg1,
                pathSegmentSimulations: [], amountOutLeg1: BigNumber.from(0), amountOutLeg2: BigNumber.from(0),
            };
        }
        if (opportunity.sourceTxHash && opportunity.discoveryTimestamp && // Assuming sourceTxBlockNumber might not always be present
            (currentBlockNumber - (opportunity.sourceTxBlockNumber || currentBlockNumber) > this.maxBlockAgeForOpportunity) ) {
            logger.warn({ pathId: opportunity.id, currentBlock: currentBlockNumber, oppBlock: opportunity.sourceTxBlockNumber }, "SimulationService: Opportunity failed block age check.");
            return {
                opportunity, pathId: opportunity.id, simulationTimestamp: simTime,
                isProfitable: false, blockAgeCheckFailed: true,
                grossProfitBaseToken: BigNumber.from(0), estimatedGasCostBaseToken: BigNumber.from(0),
                netProfitBaseToken: BigNumber.from(0), netProfitUsd: 0,
                amountInLeg1: amountInForLeg1,
                pathSegmentSimulations: [], amountOutLeg1: BigNumber.from(0), amountOutLeg2: BigNumber.from(0),
            };
        }
        // --- End Pre-checks ---

        let currentLegAmountIn = amountInForLeg1;
        let overallFinalAmountOut = BigNumber.from(0); // This will be the final amount of baseToken after all legs

        for (let i = 0; i < opportunity.path.length; i++) {
            const segment = opportunity.path[i];
            const router = await this.getRouterContract(segment.dexName, network);
            if (!router) {
                return {
                    opportunity, pathId: opportunity.id, simulationTimestamp: simTime, isProfitable: false,
                    error: `Router contract for DEX ${segment.dexName} not found.`,
                    grossProfitBaseToken: BigNumber.from(0), estimatedGasCostBaseToken: BigNumber.from(0),
                    netProfitBaseToken: BigNumber.from(0), netProfitUsd: 0,
                    amountInLeg1: amountInForLeg1, pathSegmentSimulations,
                    amountOutLeg1: pathSegmentSimulations[0]?.expectedOutputAmount || BigNumber.from(0),
                    amountOutLeg2: pathSegmentSimulations[1]?.expectedOutputAmount || BigNumber.from(0),
                };
            }

            try {
                const amountsOut = await router.getAmountsOut(currentLegAmountIn, [segment.tokenInAddress, segment.tokenOutAddress]);
                const legOutputAmount = amountsOut[1];

                pathSegmentSimulations.push({
                    segment,
                    expectedOutputAmount: legOutputAmount,
                    estimatedGasUnits: this.defaultSwapGasUnits, // For now, same for all legs
                });
                currentLegAmountIn = legOutputAmount; // Output of this leg is input to next
                if (i === opportunity.path.length - 1) {
                    overallFinalAmountOut = legOutputAmount; // Final output of the entire path
                }
            } catch (e: any) {
                logger.warn({ pathId: opportunity.id, leg: i + 1, dex: segment.dexName, err: e.message }, "SimulationService: Error during getAmountsOut for a leg.");
                return {
                    opportunity, pathId: opportunity.id, simulationTimestamp: simTime, isProfitable: false,
                    error: `getAmountsOut failed for leg ${i + 1} on ${segment.dexName}: ${e.message}`,
                    grossProfitBaseToken: BigNumber.from(0), estimatedGasCostBaseToken: BigNumber.from(0),
                    netProfitBaseToken: BigNumber.from(0), netProfitUsd: 0,
                    amountInLeg1: amountInForLeg1, pathSegmentSimulations,
                    amountOutLeg1: pathSegmentSimulations[0]?.expectedOutputAmount || BigNumber.from(0),
                    amountOutLeg2: pathSegmentSimulations[1]?.expectedOutputAmount || BigNumber.from(0),
                };
            }
        }

        logger.debug({ pathId: opportunity.id, legOutputs: pathSegmentSimulations.map(p => p.expectedOutputAmount.toString()) }, "Simulation successful for all legs.");

        // Gas Cost Estimation
        let gasPriceToUse: BigNumber;
        if (gasParamsOverride) {
            gasPriceToUse = gasParamsOverride.maxFeePerGas; // Use the effective gas price for cost estimation
        } else {
            const feeData = await this.rpcService.getFeeData(network);
            if (!feeData || !feeData.gasPrice) { // Using gasPrice for simplicity if no override
                logger.warn({ pathId: opportunity.id }, "SimulationService: Could not retrieve gas price for cost estimation. Using zero cost.");
                // Return error or zero cost based on strictness
                return {
                    opportunity, pathId: opportunity.id, simulationTimestamp: simTime, isProfitable: false,
                    error: "Failed to get gas price for estimation.",
                    grossProfitBaseToken: BigNumber.from(0), estimatedGasCostBaseToken: BigNumber.from(0),
                    netProfitBaseToken: BigNumber.from(0), netProfitUsd: 0,
                    amountInLeg1: amountInForLeg1, pathSegmentSimulations,
                    amountOutLeg1: pathSegmentSimulations[0]?.expectedOutputAmount || BigNumber.from(0),
                    amountOutLeg2: pathSegmentSimulations[1]?.expectedOutputAmount || BigNumber.from(0),
                    gasParamsUsed: gasParamsOverride,
                };
            }
            gasPriceToUse = feeData.gasPrice;
        }

        const totalGasUnits = pathSegmentSimulations.reduce((sum, leg) => sum + leg.estimatedGasUnits, 0);
        const totalGasCostBaseToken = gasPriceToUse.mul(totalGasUnits);

        // Profit Calculation
        const grossProfitBaseToken = overallFinalAmountOut.sub(amountInForLeg1);
        const netProfitBaseToken = grossProfitBaseToken.sub(totalGasCostBaseToken);
        const baseTokenUsdPrice = await this.priceService.getUsdPrice(opportunity.path[0].tokenInSymbol);
        const netProfitUsd = parseFloat(ethers.utils.formatUnits(netProfitBaseToken, baseTokenDecimals)) * baseTokenUsdPrice;

        // Profit Realism Checks
        const profitPercentage = amountInForLeg1.isZero() ? BigNumber.from(0) : grossProfitBaseToken.mul(10000).div(amountInForLeg1);
        const profitPercentageNum = profitPercentage.toNumber() / 100;
        let profitRealismCheckFailed = false;
        if (profitPercentageNum > this.profitRealismMaxPercentage) {
            logger.warn({ pathId: opportunity.id, profitPercentage: profitPercentageNum, max: this.profitRealismMaxPercentage }, "SimulationService: Potential profit failed realism check (too high %).");
            profitRealismCheckFailed = true;
        }

        let maxProfitUsdCheckFailed = false;
        if (netProfitUsd > this.maxProfitUsd) {
            logger.warn({ pathId: opportunity.id, netProfitUsd, max: this.maxProfitUsd }, "SimulationService: Potential profit failed USD limit check (too high USD).");
            maxProfitUsdCheckFailed = true;
        }

        const minNetProfitWei = BigNumber.from(this.configService.get('simulation_service.min_net_profit_base_token_wei') || "0");
        const isProfitable = netProfitBaseToken.gt(minNetProfitWei);

        const result: SimulationResult = {
            opportunity, pathId: opportunity.id,
            isProfitable: isProfitable && !profitRealismCheckFailed && !maxProfitUsdCheckFailed,
            grossProfitBaseToken, estimatedGasCostBaseToken: totalGasCostBaseToken,
            netProfitBaseToken, netProfitUsd,
            amountInLeg1: amountInForLeg1,
            amountOutLeg1: pathSegmentSimulations[0]?.expectedOutputAmount || BigNumber.from(0), // Output of leg 1
            amountOutLeg2: (pathSegmentSimulations.length > 1 ? pathSegmentSimulations[1]?.expectedOutputAmount : BigNumber.from(0)) || BigNumber.from(0), // Output of leg 2
            pathSegmentSimulations,
            gasParamsUsed: gasParamsOverride,
            profitRealismCheckFailed, maxProfitUsdCheckFailed,
            simulationTimestamp: simTime,
        };

        if (result.isProfitable) {
            logger.info({ pathId: opportunity.id, netProfitBase: ethers.utils.formatUnits(netProfitBaseToken, baseTokenDecimals), netProfitUsd: netProfitUsd.toFixed(2) }, "SimulationService: Profitable opportunity found and passed checks.");
        } else {
            logger.info({ pathId: opportunity.id, netProfitBase: ethers.utils.formatUnits(netProfitBaseToken, baseTokenDecimals), isProfitable: result.isProfitable, profitRealismCheckFailed, maxProfitUsdCheckFailed }, "SimulationService: Opportunity not profitable or failed checks.");
        }
        return result;
    }
}
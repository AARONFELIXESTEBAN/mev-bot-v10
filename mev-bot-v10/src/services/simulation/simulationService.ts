import { ethers, BigNumber } from 'ethers';
import { ConfigService } from '../../core/config/configService';
import { getLogger } from '../../core/logger/loggerService';
import { RpcService } from '../../core/rpc/rpcService';
import { SmartContractInteractionService } from '../../core/smartContract/smartContractService';
import { PotentialOpportunity } from './opportunityService'; // Assuming this is where PotentialOpportunity is defined
import { PriceService } from './priceService'; // For USD price conversion
import UniswapV2Router02ABI from '../../abis/UniswapV2Router02.json'; // For getAmountsOut

const logger = getLogger();

export interface SimulationResult {
    opportunity: PotentialOpportunity;
    pathId: string;
    isProfitable: boolean;
    grossProfitBaseToken: BigNumber; // Profit before gas, in base token (e.g., WETH)
    estimatedGasCostBaseToken: BigNumber; // Total gas cost for both legs, in base token
    netProfitBaseToken: BigNumber; // Net profit in base token
    netProfitUsd: number; // Net profit in USD
    amountInLeg1: BigNumber; // Amount of tokenIn for leg1 (usually default swap amount)
    amountOutLeg1: BigNumber; // Amount of intermediateToken from leg1
    amountOutLeg2: BigNumber; // Amount of baseToken from leg2 (final output)
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
    private defaultSwapGasUnits: number; // Gas units for a single Uniswap V2 style swap

    constructor(
        private configService: ConfigService,
        private rpcService: RpcService,
        private scService: SmartContractInteractionService,
        private priceService: PriceService // For USD conversion of profit
    ) {
        this.defaultSwapAmountBaseToken = ethers.utils.parseUnits(
            this.configService.get('DEFAULT_SWAP_AMOUNT_BASE_TOKEN') || '0.1', // e.g., 0.1 WETH
            this.configService.get('BASE_TOKEN_DECIMALS') || 18
        );
        this.profitRealismMaxPercentage = parseFloat(this.configService.get('PROFIT_REALISM_MAX_PERCENTAGE') || '50.0'); // 50%
        this.maxProfitUsd = parseFloat(this.configService.get('MAX_PROFIT_USD_V10') || '5000.0'); // $5000
        this.opportunityFreshnessLimitMs = parseInt(this.configService.get('OPPORTUNITY_FRESHNESS_LIMIT_MS') || '15000', 10); // 15 seconds
        this.maxBlockAgeForOpportunity = parseInt(this.configService.get('MAX_BLOCK_AGE_FOR_OPPORTUNITY') || '3', 10); // 3 blocks
        this.defaultSwapGasUnits = parseInt(this.configService.get('DEFAULT_SWAP_GAS_UNITS') || '200000', 10);

        logger.info('SimulationService: Initialized with parameters:');
        logger.info(`  Default Swap Amount (Base Token): ${ethers.utils.formatUnits(this.defaultSwapAmountBaseToken, this.configService.get('BASE_TOKEN_DECIMALS') || 18)}`);
        logger.info(`  Profit Realism Max Percentage: ${this.profitRealismMaxPercentage}%`);
        logger.info(`  Max Profit USD V10: $${this.maxProfitUsd}`);
        logger.info(`  Opportunity Freshness Limit MS: ${this.opportunityFreshnessLimitMs}ms`);
        logger.info(`  Max Block Age for Opportunity: ${this.maxBlockAgeForOpportunity} blocks`);
        logger.info(`  Default Swap Gas Units: ${this.defaultSwapGasUnits}`);
    }

    private async getRouterContract(dexName: string, network: string = 'mainnet'): Promise<ethers.Contract | null> {
        // This should come from a more robust DEX registry in ConfigService or a dedicated DexRegistryService
        const dexConfigs = this.configService.get('KNOWN_DEX_POOLS_CONFIG') as any[] || []; // This is not router config, but might contain it or imply it
        const routers = this.configService.get('DEX_ROUTERS') as {[name: string]: string} || {}; // e.g. { "UniswapV2": "0x...", "SushiSwap": "0x..." }

        let routerAddress = routers[dexName];
        if (!routerAddress) { // Fallback to check some common ones if not explicitly mapped
            if (dexName.toLowerCase().includes("uniswapv2")) routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
            else if (dexName.toLowerCase().includes("sushiswap")) routerAddress = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
        }

        if (!routerAddress) {
            logger.error(`SimulationService: Router address for DEX "${dexName}" not found in configuration.`);
            return null;
        }
        // Assuming UniswapV2Router02ABI is compatible for typical 2-hop swaps on these DEXs
        return this.scService.getContract(routerAddress, UniswapV2Router02ABI, network);
    }

    public async simulateArbitragePath(
        opportunity: PotentialOpportunity,
        currentBlockNumber: number, // For freshness check
        network: string = 'mainnet'
    ): Promise<SimulationResult> {
        const simTime = Date.now();
        const baseTokenDecimals = opportunity.tokenPath[0].decimals; // Assuming start and end token is base token

        const resultTemplate: Partial<SimulationResult> = {
            opportunity,
            pathId: opportunity.id,
            simulationTimestamp: simTime,
            amountInLeg1: this.defaultSwapAmountBaseToken,
        };

        // 1. Opportunity Freshness (SSOT 8.3.B)
        if ((simTime - opportunity.discoveryTimestamp) > this.opportunityFreshnessLimitMs) {
            logger.warn({ pathId: opportunity.id }, "SimulationService: Opportunity failed freshness check (too old).");
            return { ...resultTemplate, isProfitable: false, freshnessCheckFailed: true } as SimulationResult;
        }
        if (opportunity.blockNumber && (currentBlockNumber - opportunity.blockNumber > this.maxBlockAgeForOpportunity)) {
            logger.warn({ pathId: opportunity.id, currentBlock: currentBlockNumber, oppBlock: opportunity.blockNumber }, "SimulationService: Opportunity failed block age check.");
            return { ...resultTemplate, isProfitable: false, blockAgeCheckFailed: true } as SimulationResult;
        }

        const router1 = await this.getRouterContract(opportunity.leg1.dexName, network);
        const router2 = await this.getRouterContract(opportunity.leg2.dexName, network);

        if (!router1 || !router2) {
            return { ...resultTemplate, isProfitable: false, error: "Router contract(s) not found." } as SimulationResult;
        }

        let amountOutLeg1: BigNumber;
        let amountOutLeg2: BigNumber;

        try {
            // Simulate Leg 1: tokenPath[0] -> tokenPath[1] on DEX1
            const amounts1 = await router1.getAmountsOut(this.defaultSwapAmountBaseToken, [opportunity.tokenPath[0].address, opportunity.tokenPath[1].address]);
            amountOutLeg1 = amounts1[1];

            // Simulate Leg 2: tokenPath[1] -> tokenPath[2] (should be baseToken) on DEX2
            const amounts2 = await router2.getAmountsOut(amountOutLeg1, [opportunity.tokenPath[1].address, opportunity.tokenPath[2].address]);
            amountOutLeg2 = amounts2[1];

            logger.debug({pathId: opportunity.id, leg1In: this.defaultSwapAmountBaseToken.toString(), leg1Out: amountOutLeg1.toString(), leg2Out: amountOutLeg2.toString()}, "Simulation successful for both legs.");

        } catch (e: any) {
            logger.warn({ pathId: opportunity.id, err: e.message }, "SimulationService: Error during getAmountsOut simulation.");
            return { ...resultTemplate, isProfitable: false, error: `getAmountsOut failed: ${e.message}` } as SimulationResult;
        }

        // Gas Cost Estimation
        const feeData = await this.rpcService.makeRpcCall(network, 'http', p => p.getFeeData());
        if (!feeData?.gasPrice) { // Using gasPrice for simplicity, could use EIP-1559 fields
            logger.warn({ pathId: opportunity.id }, "SimulationService: Could not retrieve gas price for cost estimation.");
            return { ...resultTemplate, isProfitable: false, error: "Failed to get gas price." } as SimulationResult;
        }
        const gasPrice = feeData.gasPrice;
        const estimatedGasCostLeg1 = gasPrice.mul(this.defaultSwapGasUnits);
        const estimatedGasCostLeg2 = gasPrice.mul(this.defaultSwapGasUnits);
        const totalGasCostBaseToken = estimatedGasCostLeg1.add(estimatedGasCostLeg2);

        // Profit Calculation (in BaseToken)
        const grossProfitBaseToken = amountOutLeg2.sub(this.defaultSwapAmountBaseToken);
        const netProfitBaseToken = grossProfitBaseToken.sub(totalGasCostBaseToken);

        // Profit in USD
        const baseTokenUsdPrice = await this.priceService.getUsdPrice(opportunity.tokenPath[0].symbol); // Assumes tokenPath[0] is base (e.g. WETH)
        const netProfitUsd = parseFloat(ethers.utils.formatUnits(netProfitBaseToken, baseTokenDecimals)) * baseTokenUsdPrice;


        // Profit Realism Checks (SSOT 8.3.A)
        const profitPercentage = grossProfitBaseToken.mul(10000).div(this.defaultSwapAmountBaseToken).toNumber() / 100; // In percentage basis points
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

        const isProfitable = netProfitBaseToken.gt(this.configService.get('MIN_NET_PROFIT_BASE_TOKEN_WEI') || "0"); // Compare with min profit threshold from config

        const finalResult: SimulationResult = {
            ...resultTemplate,
            isProfitable: isProfitable && !profitRealismCheckFailed && !maxProfitUsdCheckFailed,
            grossProfitBaseToken,
            estimatedGasCostBaseToken: totalGasCostBaseToken,
            netProfitBaseToken,
            netProfitUsd,
            amountOutLeg1,
            amountOutLeg2,
            profitRealismCheckFailed,
            maxProfitUsdCheckFailed,
            // freshnessCheckFailed and blockAgeCheckFailed are set at the beginning
        };

        if(finalResult.isProfitable) {
            logger.info({ pathId: opportunity.id, netProfitEth: ethers.utils.formatUnits(netProfitBaseToken, baseTokenDecimals), netProfitUsd: netProfitUsd.toFixed(2) }, "SimulationService: Profitable opportunity found and passed checks.");
        } else {
            logger.info({ pathId: opportunity.id, netProfitEth: ethers.utils.formatUnits(netProfitBaseToken, baseTokenDecimals), isProfitable, profitRealismCheckFailed, maxProfitUsdCheckFailed }, "SimulationService: Opportunity not profitable or failed checks.");
        }

        return finalResult;
    }
}

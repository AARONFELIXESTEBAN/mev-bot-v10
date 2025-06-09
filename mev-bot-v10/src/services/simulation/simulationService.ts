import { ethers } from 'ethers';
import { getLogger, PinoLogger } from '@core/logger/loggerService';
import { ConfigService } from '@core/config/configService';
import { KmsService } from '@core/kms/kmsService';
import { FlashbotsBundleProvider, FlashbotsBundleRawTransaction } from '@flashbots/ethers-provider-bundle';
import { PotentialOpportunity, PathSegment, SimulationResult, SimulatedPathSegmentDetails } from '@shared/types';
import { GasParams } from '@services/execution/gasStrategy';

interface RpcService {
  getProvider(network: string, type: 'http' | 'ws'): ethers.JsonRpcProvider;
}

interface DataCollectionService {
  logData(data: any, collection: string, id: string): Promise<void>;
}

export class SimulationService {
  private logger: PinoLogger;
  private configService: ConfigService;
  private rpcService: RpcService;
  private kmsService: KmsService;
  private dataCollectionService: DataCollectionService;
  private flashbotsProvider: FlashbotsBundleProvider | null = null;

  constructor(
    configService: ConfigService,
    rpcService: RpcService,
    kmsService: KmsService,
    dataCollectionService: DataCollectionService
  ) {
    this.logger = getLogger('SimulationService');
    this.configService = configService;
    this.rpcService = rpcService;
    this.kmsService = kmsService;
    this.dataCollectionService = dataCollectionService;
  }

  public async init(): Promise<void> {
    this.logger.info('Initializing SimulationService...');
    try {
      const flashbotsRelayUrl = this.configService.get('execution_config.flashbots_relay_url') as string;
      const flashbotsSigningKey = this.configService.get('execution_config.flashbots_signing_key') as string;

      if (flashbotsRelayUrl && flashbotsSigningKey) {
        const provider = this.rpcService.getProvider('mainnet', 'http');
        const authSigner = new ethers.Wallet(flashbotsSigningKey);
        this.flashbotsProvider = await FlashbotsBundleProvider.create(
          provider,
          authSigner,
          flashbotsRelayUrl,
          'mainnet'
        );
        this.logger.info(`FlashbotsBundleProvider initialized for simulation.`);
      } else {
        this.logger.info('Flashbots not configured for simulation. Using public provider.');
      }
    } catch (error: any) {
      this.logger.error({ err: error.message }, 'Failed to initialize SimulationService.');
      throw error;
    }
  }

  public async simulateArbitrage(opportunity: PotentialOpportunity): Promise<SimulationResult> {
    this.logger.info({ opportunityId: opportunity.id }, 'Simulating arbitrage opportunity...');
    try {
      const provider = this.rpcService.getProvider('mainnet', 'http');
      const botAddress = await this.kmsService.getBotAddress();
      const simulatedPathDetails: SimulatedPathSegmentDetails[] = [];
      let currentAmount = opportunity.entryAmountBase;
      let totalGasCostWei = 0n;
      let totalExpectedProfit = 0n;

      for (const segment of opportunity.path) {
        const routerAddress = this.configService.get(`opportunity_service.dex_routers.${segment.dexName}`) as string;
        if (!routerAddress) {
          throw new Error(`Router address for ${segment.dexName} not found.`);
        }

        const routerContract = new ethers.Contract(
          routerAddress,
          this.getRouterAbi(segment.dexName),
          provider
        );

        let callData: string;
        const isNativeEthIn = segment.tokenInAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        if (isNativeEthIn) {
          callData = routerContract.interface.encodeFunctionData('swapExactETHForTokens', [
            segment.amountOutMin,
            [segment.tokenInAddress, segment.tokenOutAddress],
            botAddress,
            Math.floor(Date.now() / 1000) + 120,
          ]);
        } else {
          callData = routerContract.interface.encodeFunctionData('swapExactTokensForTokens', [
            currentAmount,
            segment.amountOutMin,
            [segment.tokenInAddress, segment.tokenOutAddress],
            botAddress,
            Math.floor(Date.now() / 1000) + 120,
          ]);
        }

        const gasEstimate = await provider.estimateGas({
          to: routerAddress,
          data: callData,
          value: isNativeEthIn ? currentAmount : 0,
          from: botAddress,
        });

        const feeData = await provider.getFeeData();
        const gasCostWei = BigInt(gasEstimate) * (BigInt(feeData.maxFeePerGas || 1000000000n)); // Fallback to 1 Gwei
        totalGasCostWei += gasCostWei;

        const simulatedAmountOut = await routerContract.getAmountsOut(currentAmount, [segment.tokenInAddress, segment.tokenOutAddress]);
        currentAmount = simulatedAmountOut[1];

        simulatedPathDetails.push({
          segment,
          expectedAmountOut: currentAmount,
          estimatedGasUnits: gasEstimate,
        });
      }

      const netProfitBaseToken = BigInt(currentAmount) - BigInt(opportunity.entryAmountBase) - totalGasCostWei;
      const isProfitable = netProfitBaseToken > 0n;
      const netProfitUsd = Number(netProfitBaseToken) / 1e18 * 2000; // Assume 1 ETH = $2000

      const result: SimulationResult = {
        success: true,
        isProfitable,
        opportunity,
        simulatedPathDetails,
        totalExpectedProfitBase: netProfitBaseToken,
        totalEstimatedGasCostWei: totalGasCostWei,
        netProfitBaseToken,
        netProfitUsd,
        amountInLeg1: opportunity.entryAmountBase,
        amountOutLeg2: currentAmount,
        estimatedGasCostBaseToken: totalGasCostWei,
        simulationTimestamp: Date.now(),
        pathId: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(opportunity.path))),
      };

      await this.dataCollectionService.logData(result, 'simulations', result.opportunity.id);
      this.logger.info({ opportunityId: opportunity.id, isProfitable }, 'Simulation completed.');
      return result;
    } catch (error: any) {
      this.logger.error({ err: error.message, opportunityId: opportunity.id }, 'Simulation failed.');
      return {
        success: false,
        isProfitable: false,
        opportunity,
        simulatedPathDetails: [],
        totalExpectedProfitBase: 0n,
        totalEstimatedGasCostWei: 0n,
        netProfitBaseToken: 0n,
        netProfitUsd: 0,
        amountInLeg1: 0n,
        amountOutLeg2: 0n,
        estimatedGasCostBaseToken: 0n,
        simulationTimestamp: Date.now(),
        pathId: '',
      };
    }
  }

  private async simulateWithFlashbots(
    opportunity: PotentialOpportunity,
    simulatedPathDetails: SimulatedPathSegmentDetails[],
    gasParams: GasParams
  ): Promise<SimulationResult> {
    if (!this.flashbotsProvider) {
      this.logger.error('Flashbots provider not initialized.');
      return this.simulateArbitrage(opportunity);
    }

    try {
      const provider = this.rpcService.getProvider('mainnet', 'http');
      const botAddress = await this.kmsService.getBotAddress();
      const currentBlock = await provider.getBlockNumber();
      const targetBlock = currentBlock + 1;

      const txs: FlashbotsBundleRawTransaction[] = [];
      let currentAmount = opportunity.entryAmountBase;

      for (const simDetail of simulatedPathDetails) {
        const segment = simDetail.segment;
        const routerAddress = this.configService.get(`opportunity_service.dex_routers.${segment.dexName}`) as string;
        if (!routerAddress) throw new Error(`Router address for ${segment.dexName} not found.`);

        const routerInterface = new ethers.Interface(this.getRouterAbi(segment.dexName));
        let txData: string;
        const isNativeEthIn = segment.tokenInAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

        if (isNativeEthIn) {
          txData = routerInterface.encodeFunctionData('swapExactETHForTokens', [
            simDetail.expectedAmountOut,
            [segment.tokenInAddress, segment.tokenOutAddress],
            botAddress,
            Math.floor(Date.now() / 1000) + 120,
          ]);
        } else {
          txData = routerInterface.encodeFunctionData('swapExactTokensForTokens', [
            currentAmount,
            simDetail.expectedAmountOut,
            [segment.tokenInAddress, segment.tokenOutAddress],
            botAddress,
            Math.floor(Date.now() / 1000) + 120,
          ]);
        }

        const tx: ethers.TransactionRequest = {
          to: routerAddress,
          data: txData,
          value: isNativeEthIn ? currentAmount : 0,
          gasLimit: simDetail.estimatedGasUnits,
          maxFeePerGas: gasParams.maxFeePerGas,
          maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
          nonce: await provider.getTransactionCount(botAddress, 'pending'),
          chainId: (await provider.getNetwork()).chainId,
          type: 2,
        };

        const signedTx = await this.kmsService.signTransaction(tx);
        txs.push({ signedTransaction: signedTx });
        currentAmount = simDetail.expectedAmountOut;
      }

      const bundleSubmission = await this.flashbotsProvider.simulate(txs.map(tx => tx.signedTransaction), targetBlock);
      if ('error' in bundleSubmission) {
        this.logger.error({ err: bundleSubmission.error }, 'Flashbots simulation failed.');
        return this.simulateArbitrage(opportunity);
      }

      const totalGasCostWei = bundleSubmission.results.reduce(
        (sum, result) => sum + BigInt(result.gasUsed) * BigInt(gasParams.maxFeePerGas || 0),
        0n
      );
      const netProfitBaseToken = BigInt(currentAmount) - BigInt(opportunity.entryAmountBase) - totalGasCostWei;
      const isProfitable = netProfitBaseToken > 0n;
      const netProfitUsd = Number(netProfitBaseToken) / 1e18 * 2000;

      const result: SimulationResult = {
        success: true,
        isProfitable,
        opportunity,
        simulatedPathDetails,
        totalExpectedProfitBase: netProfitBaseToken,
        totalEstimatedGasCostWei: totalGasCostWei,
        netProfitBaseToken,
        netProfitUsd,
        amountInLeg1: opportunity.entryAmountBase,
        amountOutLeg2: currentAmount,
        estimatedGasCostBaseToken: totalGasCostWei,
        simulationTimestamp: Date.now(),
        pathId: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(opportunity.path))),
      };

      await this.dataCollectionService.logData(result, 'simulations_flashbots', result.opportunity.id);
      this.logger.info({ opportunityId: opportunity.id, isProfitable }, 'Flashbots simulation completed.');
      return result;
    } catch (error: any) {
      this.logger.error({ err: error.message, opportunityId: opportunity.id }, 'Flashbots simulation failed.');
      return this.simulateArbitrage(opportunity);
    }
  }

  private getRouterAbi(dexName: string): any {
    const uniswapV2RouterABI = [
      'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
      'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
      'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] memory amounts)',
    ];
    if (dexName.toLowerCase().includes('uniswap') || dexName.toLowerCase().includes('sushi')) {
      return uniswapV2RouterABI;
    }
    this.logger.error(`No ABI found for DEX: ${dexName}. Using default UniswapV2Router ABI.`);
    return uniswapV2RouterABI;
  }
}
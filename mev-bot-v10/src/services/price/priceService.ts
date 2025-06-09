import { ethers } from 'ethers';
import { getLogger, PinoLogger } from '@core/logger/loggerService';
import { ConfigService } from '@core/config/configService';
import { PriceData, MarketData, DexPair } from '@shared/types';

interface RpcService {
  getProvider(network: string, type: 'http' | 'ws'): ethers.JsonRpcProvider;
}

export class PriceService {
  private logger: PinoLogger;
  private configService: ConfigService;
  private rpcService: RpcService;

  constructor(configService: ConfigService, rpcService: RpcService) {
    this.logger = getLogger('PriceService');
    this.configService = configService;
    this.rpcService = rpcService;
    this.logger.info('PriceService initialized.');
  }

  public async fetchPrice(pair: DexPair, network: string = 'mainnet'): Promise<PriceData | null> {
    try {
      const provider = this.rpcService.getProvider(network, 'http');
      const pairContract = new ethers.Contract(
        pair.pairAddress,
        ['function getReserves() external view returns (uint112, uint112, uint32)'],
        provider
      );
      const [reserve0, reserve1] = await pairContract.getReserves();
      const price = (BigInt(reserve1) * BigInt(1e18)) / BigInt(reserve0);
      const priceData: PriceData = {
        tokenPair: pair,
        price,
        timestamp: Date.now(),
        dexName: pair.dexName,
      };
      this.logger.info(`Fetched price for ${pair.token0.symbol}/${pair.token1.symbol}: ${price}`);
      return priceData;
    } catch (error: any) {
      this.logger.error({ err: error.message }, 'Error fetching price.');
      return null;
    }
  }

  public async updateMarketData(pairs: DexPair[]): Promise<MarketData> {
    const marketData: MarketData = {};
    for (const pair of pairs) {
      const priceData = await this.fetchPrice(pair);
      if (priceData) {
        const pairKey = `${pair.token0.address}-${pair.token1.address}`;
        marketData[pairKey] = marketData[pairKey] || [];
        marketData[pairKey].push(priceData);
      }
    }
    this.logger.info(`Updated market data for ${pairs.length} pairs.`);
    return marketData;
  }
}
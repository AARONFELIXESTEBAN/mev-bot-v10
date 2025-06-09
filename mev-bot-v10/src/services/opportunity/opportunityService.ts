import { ConfigService } from '@core/config/configService';
import { getLogger } from '@core/logger/loggerService';
import { PriceService } from '@services/price/priceService';
import { TokenInfo, PathSegment } from '@utils/typeUtils';
// Re-export PathSegment to make it available to importers of this module
export { PathSegment } from '@utils/typeUtils';
import { SmartContractInteractionService } from '@core/smartContract/smartContractService';
import { ethers, BigNumber } from 'ethers';

const logger = getLogger();

export interface ProcessedMempoolTransaction {
    txHash: string;
    routerName: string;
    path: string[];
    amountIn?: BigNumber;
    value?: BigNumber;
}

export interface PotentialOpportunity {
    id: string;
    path: PathSegment[];
    entryTokenAddress: string;
    entryAmountBase: BigNumber;
    sourceTxHash: string;
    discoveryTimestamp: number;
    sourceTxBlockNumber?: number; // Added for block age check
    // Optional fields that might be useful for ESP or advanced logic later
    usesFlashLoan?: boolean;
    flashLoanAmountUsd?: number;
    flashLoanFeeUsdEstimate?: number;
    isOpportunistic?: boolean;
    minPathLiquidityUsd?: number;
    avgPathLiquidityUsd?: number;
}

export class OpportunityIdentificationService {
    private baseToken!: TokenInfo;
    private coreWhitelistedTokens: TokenInfo[] = [];
    private dexRouters: { [name: string]: string } = {};
    private dexFactories: { [name: string]: string } = {};
    private network: string = 'mainnet';
    private isInitialized: boolean = false;

    constructor(
        private configService: ConfigService,
        private priceService: PriceService,
        private scService: SmartContractInteractionService
    ) {
        const baseTokenAddress = this.configService.getOrThrow('opportunity_service.base_token_address');
        const baseTokenSymbol = this.configService.get('opportunity_service.base_token_symbol') || "WETH";
        const baseTokenDecimals = parseInt(this.configService.get('opportunity_service.base_token_decimals') || "18");
        this.baseToken = {
            address: baseTokenAddress,
            symbol: baseTokenSymbol,
            decimals: baseTokenDecimals,
            name: baseTokenSymbol
        };

        this.dexRouters = this.configService.get('opportunity_service.dex_routers') || {};
        this.dexFactories = this.configService.get('opportunity_service.dex_factories') || {};
        const primaryNetwork = this.configService.get('rpc_urls.primary_network');
        if (primaryNetwork && typeof primaryNetwork === 'string') {
            this.network = primaryNetwork;
        }
    }

    public async init(): Promise<void> {
        if (this.isInitialized) return;
        await this.initializeWhitelistedTokens();
        this.isInitialized = true;
        logger.info(`OpportunityIdentificationService: Initialized. Base Token: ${this.baseToken.symbol}. Network: ${this.network}`);
    }

    private async initializeWhitelistedTokens(): Promise<void> {
        const whitelistedAddressesCsv = this.configService.get('opportunity_service.core_whitelisted_tokens_csv') || "";
        const addresses = whitelistedAddressesCsv.split(',').map((a: string) => a.trim()).filter((a: string) => ethers.utils.isAddress(a));
        this.coreWhitelistedTokens = [];

        for (const addr of addresses) {
            if (addr.toLowerCase() === this.baseToken.address.toLowerCase()) continue;
            try {
                const symbol = await this.scService.readFunction({ network: this.network, contractAddress: addr, abi: 'ERC20', functionName: 'symbol' }) as string;
                const name = await this.scService.readFunction({ network: this.network, contractAddress: addr, abi: 'ERC20', functionName: 'name' }) as string;
                const decimals = await this.scService.readFunction({ network: this.network, contractAddress: addr, abi: 'ERC20', functionName: 'decimals' }) as number;

                if (symbol && name && typeof decimals === 'number') {
                    this.coreWhitelistedTokens.push({ address: addr, symbol, name, decimals });
                } else {
                    logger.warn(`Could not fetch full details for whitelisted token ${addr}.`);
                }
            } catch (error: any) {
                logger.error({ err: error.message, tokenAddress: addr }, `Failed to fetch details for whitelisted token ${addr}.`);
            }
        }
    }

    private getTokenInfo(address: string): TokenInfo | undefined {
        const lowerAddress = address.toLowerCase();
        if (lowerAddress === this.baseToken.address.toLowerCase()) return this.baseToken;
        if ((lowerAddress === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
             lowerAddress === "0x0000000000000000000000000000000000000000") &&
            this.baseToken.symbol === "WETH") {
            return this.baseToken;
        }
        return this.coreWhitelistedTokens.find(t => t.address.toLowerCase() === lowerAddress);
    }

    private async getPairAddressWithFactory(dexName: string, tokenAAddress: string, tokenBAddress: string): Promise<string | null> {
        const factoryAddress = this.dexFactories[dexName];
        if (!factoryAddress) return null;
        try {
            const pairAddress = await this.scService.getPairAddress(factoryAddress, tokenAAddress, tokenBAddress, this.network);
            return (pairAddress && pairAddress !== ethers.constants.AddressZero) ? pairAddress : null;
        } catch (error) { return null; }
    }

    public async identifyOpportunitiesFromMempoolTx(
        tx: ProcessedMempoolTransaction
    ): Promise<PotentialOpportunity[]> {
        if (!this.isInitialized || !tx.path || tx.path.length < 2) return [];

        const tokenInLeg1UserAddress = tx.path[0];
        const tokenMidAddress = tx.path[1];

        const tokenInLeg1Info = this.getTokenInfo(tokenInLeg1UserAddress);
        const tokenMidInfo = this.getTokenInfo(tokenMidAddress);

        if (!tokenInLeg1Info || !tokenMidInfo) return [];

        let entryAmountBase = BigNumber.from(0);
        const actualContractInputTokenAddress = tokenInLeg1Info.address;

        if (actualContractInputTokenAddress.toLowerCase() === this.baseToken.address.toLowerCase()) {
            if ((tokenInLeg1UserAddress.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
                 tokenInLeg1UserAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") &&
                this.baseToken.symbol === "WETH") {
                 entryAmountBase = tx.value || BigNumber.from(0);
            } else {
                 entryAmountBase = tx.amountIn || BigNumber.from(0);
            }
        } else {
            return []; // Not starting with base token
        }

        if (entryAmountBase.isZero()) return [];

        const dexNameLeg1 = tx.routerName;
        const leg1PairAddress = await this.getPairAddressWithFactory(dexNameLeg1, actualContractInputTokenAddress, tokenMidInfo.address);
        if (!leg1PairAddress) return [];

        const reservesLeg1 = await this.priceService.getReservesByPairAddress(leg1PairAddress, this.network);
        if (!reservesLeg1) return [];

        const opportunities: PotentialOpportunity[] = [];
        const discoveryTimestamp = Date.now();

        for (const dexNameLeg2 of Object.keys(this.dexRouters)) {
            const leg2PairAddress = await this.getPairAddressWithFactory(dexNameLeg2, tokenMidInfo.address, this.baseToken.address); // Leg 2 back to base token

            if (!leg2PairAddress || leg2PairAddress.toLowerCase() === leg1PairAddress.toLowerCase()) { // Avoid same pool or if pool not found
                continue;
            }

            const reservesLeg2 = await this.priceService.getReservesByPairAddress(leg2PairAddress, this.network);
            if (reservesLeg2) { // Check if reserves were successfully fetched
                const pathSegments: PathSegment[] = [
                    {
                        poolAddress: leg1PairAddress,
                        tokenInAddress: actualContractInputTokenAddress, // Use actual contract input address
                        tokenOutAddress: tokenMidInfo.address,
                        dexName: dexNameLeg1,
                        tokenInSymbol: tokenInLeg1Info.symbol, // Symbol from resolved TokenInfo
                        tokenOutSymbol: tokenMidInfo.symbol,
                        tokenInDecimals: tokenInLeg1Info.decimals,
                        tokenOutDecimals: tokenMidInfo.decimals,
                    },
                    {
                        poolAddress: leg2PairAddress,
                        tokenInAddress: tokenMidInfo.address,
                        tokenOutAddress: this.baseToken.address,
                        dexName: dexNameLeg2,
                        tokenInSymbol: tokenMidInfo.symbol,
                        tokenOutSymbol: this.baseToken.symbol,
                        tokenInDecimals: tokenMidInfo.decimals,
                        tokenOutDecimals: this.baseToken.decimals,
                    }
                ];

                const opportunityId = ethers.utils.id(`${tx.txHash}-${leg1PairAddress}-${leg2PairAddress}`);

                opportunities.push({
                    id: opportunityId,
                    path: pathSegments,
                    entryTokenAddress: this.baseToken.address, // Entry point for the whole arb is base token
                    entryAmountBase: entryAmountBase,
                    sourceTxHash: tx.txHash,
                    discoveryTimestamp: discoveryTimestamp,
                    sourceTxBlockNumber: tx.blockNumber, // Populate from ProcessedMempoolTransaction
                    // Initialize other optional fields if data is available or set to undefined/defaults
                    usesFlashLoan: false, // Example default, logic for this would be more complex
                    isOpportunistic: false, // Example default
                });
                logger.info({ pathId: opportunityId, leg1Dex: dexNameLeg1, leg2Dex: dexNameLeg2 }, "Identified potential 2-hop opportunity.");
            }
        }
        return opportunities;
    }
}
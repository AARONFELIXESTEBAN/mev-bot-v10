import { ethers, Contract, utils as ethersUtils, BigNumber } from 'ethers';
import { RpcService } from '../rpc/rpcService'; // Adjust path
import { getLogger } from '../logger/loggerService'; // Adjust path

// Import ABIs directly (ensure they are in the specified path relative to the output `dist` directory, or use a robust pathing/loading mechanism)
// For this structure, assuming `abis` folder is copied to `dist` or paths are resolved correctly.
import UniswapV2PairABIJson from '../../abis/UniswapV2Pair.json';
import ERC20ABIJson from '../../abis/ERC20.json';

const logger = getLogger();

export interface ContractCallParams {
    contractAddress: string;
    abi: any; // Can be the full ABI array or a name to lookup if ABI cache is implemented
    functionName: string;
    args?: any[];
    network?: string; // Defaults to 'mainnet' or a configured default
}

export interface PairReserves {
    reserve0: BigNumber;
    reserve1: BigNumber;
    blockTimestampLast: number;
}

export class SmartContractInteractionService {
    private abiCache: Map<string, ethersUtils.Interface> = new Map();

    constructor(private rpcService: RpcService) {
        logger.info("SmartContractInteractionService: Initialized.");
        // Pre-load/cache common ABIs
        this.loadAbi('UniswapV2Pair', UniswapV2PairABIJson);
        this.loadAbi('ERC20', ERC20ABIJson);
    }

    private loadAbi(name: string, abi: any): boolean {
        try {
            const iface = new ethersUtils.Interface(abi);
            this.abiCache.set(name.toLowerCase(), iface);
            logger.info(`SmartContractInteractionService: Loaded ABI for ${name}`);
            return true;
        } catch (error) {
            logger.error({ err: error, abiName: name }, `SmartContractInteractionService: Failed to load ABI for ${name}`);
            return false;
        }
    }

    public getInterface(abiNameOrAbi: string | any[]): ethersUtils.Interface | null {
        if (typeof abiNameOrAbi === 'string') {
            const iface = this.abiCache.get(abiNameOrAbi.toLowerCase());
            if (!iface) {
                logger.error(`SmartContractInteractionService: ABI ${abiNameOrAbi} not found in cache.`);
                return null;
            }
            return iface;
        } else if (Array.isArray(abiNameOrAbi)) {
            try {
                return new ethersUtils.Interface(abiNameOrAbi);
            } catch (error) {
                logger.error({ err: error }, "SmartContractInteractionService: Failed to parse provided ABI array.");
                return null;
            }
        }
        logger.error("SmartContractInteractionService: Invalid ABI format provided.");
        return null;
    }

    public async getContract(
        address: string,
        abiNameOrAbi: string | any[],
        network: string = 'mainnet'
    ): Promise<Contract | null> {
        const provider = this.rpcService.getJsonRpcProvider(network); // Prefer JSON-RPC for static calls
        if (!provider) {
            logger.error(`SmartContractInteractionService: No provider for network ${network}.`);
            return null;
        }

        const iface = this.getInterface(abiNameOrAbi);
        if (!iface) return null;

        try {
            return new ethers.Contract(address, iface, provider);
        } catch (error) {
            logger.error({ err: error, contractAddress: address }, `SmartContractInteractionService: Error creating contract instance for ${address}.`);
            return null;
        }
    }

    public async readFunction(params: ContractCallParams): Promise<any | null> {
        const { contractAddress, abi, functionName, args = [], network = 'mainnet' } = params;
        // Using makeRpcCall from RpcService for retries and circuit breaking
        return this.rpcService.makeRpcCall(network, 'http', async (provider) => {
            // Inside makeRpcCall, provider is already selected (JsonRpc or WebSocket)
            // For read, JsonRpcProvider is generally fine.
            const contract = new ethers.Contract(contractAddress, abi, provider);
            // const contract = await this.getContract(contractAddress, abi, network); // This would create a new instance using its own provider logic
            if (contract && typeof contract[functionName] === 'function') {
                logger.debug({ ...params }, `SmartContractInteractionService: Calling read function ${functionName} on ${contractAddress}`);
                const result = await contract[functionName](...args);
                return result;
            } else {
                const errorMsg = `SmartContractInteractionService: Function ${functionName} not found or contract invalid for ${contractAddress}.`;
                logger.error(errorMsg);
                throw new Error(errorMsg); // Throw to allow makeRpcCall to handle retries
            }
        });
    }

    // Phase 1: Read-only operations
    public async getPairReserves(pairAddress: string, network: string = 'mainnet'): Promise<PairReserves | null> {
        logger.debug(`SmartContractInteractionService: Fetching reserves for pair ${pairAddress} on ${network}`);
        const result = await this.readFunction({
            contractAddress: pairAddress,
            abi: 'UniswapV2Pair', // Use cached ABI name
            functionName: 'getReserves',
            network: network,
        });

        if (result && result.length === 3) {
            return {
                reserve0: result[0] as BigNumber,
                reserve1: result[1] as BigNumber,
                blockTimestampLast: result[2] as number, // Solidity uint32 fits in number
            };
        }
        logger.warn(`SmartContractInteractionService: Could not retrieve valid reserves for pair ${pairAddress}`);
        return null;
    }

    public async getTokenBalance(
        tokenAddress: string,
        ownerAddress: string,
        network: string = 'mainnet'
    ): Promise<BigNumber | null> {
        logger.debug(`SmartContractInteractionService: Fetching balance of token ${tokenAddress} for owner ${ownerAddress} on ${network}`);
        const result = await this.readFunction({
            contractAddress: tokenAddress,
            abi: 'ERC20', // Use cached ABI name
            functionName: 'balanceOf',
            args: [ownerAddress],
            network: network,
        });
        return result ? (result as BigNumber) : null;
    }

    public async getTokenDecimals(tokenAddress: string, network: string = 'mainnet'): Promise<number | null> {
        const result = await this.readFunction({
            contractAddress: tokenAddress,
            abi: 'ERC20',
            functionName: 'decimals',
            network: network,
        });
        return result !== null && typeof result === 'number' ? result : null;
    }

    public async getPairAddress(factoryAddress: string, tokenA: string, tokenB: string, network: string = 'mainnet'): Promise<string | null> {
        try {
            // Assuming a common UniswapV2Factory ABI is available or add it.
            // For now, using a minimal ABI inline for getPair.
            const factoryAbi = ['function getPair(address tokenA, address tokenB) external view returns (address pair)'];
            const factoryContract = await this.getContract(factoryAddress, factoryAbi, network); // Added await
            if (!factoryContract) {
                logger.warn({ factoryAddress, tokenA, tokenB }, `Factory contract not found at ${factoryAddress}`);
                return null;
            }
            const pairAddress = await factoryContract.getPair(tokenA, tokenB);
            if (pairAddress && pairAddress !== ethers.constants.AddressZero) {
                return pairAddress;
            }
            logger.warn({ factoryAddress, tokenA, tokenB, pairAddress }, "getPair returned zero address.");
            return null;
        } catch (error) {
            logger.error({ err: error, factoryAddress, tokenA, tokenB }, `Error calling getPair on factory ${factoryAddress}.`);
            return null;
        }
    }

    // Future: Write functions (would require a Signer)
    // public async writeFunction(params: ContractCallParams, signer: ethers.Signer): Promise<ethers.providers.TransactionResponse | null> { ... }
}

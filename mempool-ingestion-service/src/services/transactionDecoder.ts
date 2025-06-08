import { ethers, utils as ethersUtils, providers as ethersProviders } from 'ethers';
import logger from '../utils/logger';
import UniswapV2Router02ABI from '../abis/UniswapV2Router02.json';
import SushiSwapRouterABI from '../abis/SushiSwapRouter.json';
// ERC20 ABI could be useful for decoding token details from paths, but not directly for router functions
// import ERC20ABI from '../abis/ERC20.json';

interface RouterInterface {
    address: string;
    name: string;
    iface: ethersUtils.Interface;
}

export interface DecodedTransactionInput {
    functionName: string;
    signature: string;
    args: ethersUtils.Result;
    // Common parameters for swaps
    path?: string[]; // Array of token addresses
    amountOutMin?: ethers.BigNumber; // For swapExactETHForTokens, swapExactTokensForTokens
    amountIn?: ethers.BigNumber; // For swapExactTokensForETH, swapExactTokensForTokens
    amountOut?: ethers.BigNumber; // For swapETHForExactTokens, swapTokensForExactTokens
    amountInMax?: ethers.BigNumber; // For swapETHForExactTokens, swapTokensForExactTokens
    to?: string; // Recipient address
    deadline?: ethers.BigNumber;
    // Common parameters for liquidity
    tokenA?: string;
    tokenB?: string;
    amountADesired?: ethers.BigNumber;
    amountBDesired?: ethers.BigNumber;
    amountAMin?: ethers.BigNumber;
    amountBMin?: ethers.BigNumber;
    liquidity?: ethers.BigNumber;
}

export class TransactionDecoder {
    private routerInterfaces: RouterInterface[] = [];

    constructor(knownRouters: { address: string, name: string, abi: any }[]) {
        knownRouters.forEach(router => {
            try {
                this.routerInterfaces.push({
                    address: router.address.toLowerCase(),
                    name: router.name,
                    iface: new ethersUtils.Interface(router.abi)
                });
                logger.info(`Initialized interface for router: ${router.name} at ${router.address}`);
            } catch (error) {
                logger.error({ err: error, routerName: router.name }, `Failed to initialize interface for router ${router.name}`);
            }
        });
    }

    public decodeTransaction(tx: ethersProviders.TransactionResponse): (DecodedTransactionInput & { routerName: string }) | null {
        if (!tx || !tx.data || tx.data === '0x' || !tx.to) {
            return null;
        }

        const targetRouterAddress = tx.to.toLowerCase();
        const router = this.routerInterfaces.find(r => r.address === targetRouterAddress);

        if (!router) {
            // Not a transaction to one of our known routers
            return null;
        }

        try {
            const parsedTx = router.iface.parseTransaction({ data: tx.data, value: tx.value });
            if (parsedTx) {
                const decoded: DecodedTransactionInput = {
                    functionName: parsedTx.name,
                    signature: parsedTx.signature,
                    args: parsedTx.args,
                };

                // Populate common fields based on function name
                this.extractCommonParams(decoded, parsedTx.name, parsedTx.args);

                logger.debug({ txHash: tx.hash, router: router.name, function: parsedTx.name }, "Decoded transaction");
                return { ...decoded, routerName: router.name };
            }
        } catch (error) {
            // Not an error, just means data didn't match any function in this router's ABI
            // logger.trace({ txHash: tx.hash, router: router.name, data: tx.data }, "Data did not match router ABI");
        }
        return null;
    }

    private extractCommonParams(decodedOutput: DecodedTransactionInput, functionName: string, args: ethersUtils.Result): void {
        // Uniswap V2 / SushiSwap style router functions
        switch (functionName) {
            case 'swapExactETHForTokens':
            case 'swapExactETHForTokensSupportingFeeOnTransferTokens':
                decodedOutput.amountOutMin = args.amountOutMin;
                decodedOutput.path = args.path;
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            case 'swapETHForExactTokens':
                decodedOutput.amountOut = args.amountOut;
                decodedOutput.path = args.path;
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            case 'swapExactTokensForTokens':
            case 'swapExactTokensForTokensSupportingFeeOnTransferTokens':
                decodedOutput.amountIn = args.amountIn;
                decodedOutput.amountOutMin = args.amountOutMin;
                decodedOutput.path = args.path;
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            case 'swapTokensForExactTokens':
                decodedOutput.amountOut = args.amountOut;
                decodedOutput.amountInMax = args.amountInMax;
                decodedOutput.path = args.path;
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            case 'swapExactTokensForETH':
            case 'swapExactTokensForETHSupportingFeeOnTransferTokens':
                decodedOutput.amountIn = args.amountIn;
                decodedOutput.amountOutMin = args.amountOutMin;
                decodedOutput.path = args.path;
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            case 'swapTokensForExactETH':
                decodedOutput.amountOut = args.amountOut;
                decodedOutput.amountInMax = args.amountInMax;
                decodedOutput.path = args.path;
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            case 'addLiquidity':
                decodedOutput.tokenA = args.tokenA;
                decodedOutput.tokenB = args.tokenB;
                decodedOutput.amountADesired = args.amountADesired;
                decodedOutput.amountBDesired = args.amountBDesired;
                decodedOutput.amountAMin = args.amountAMin;
                decodedOutput.amountBMin = args.amountBMin;
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            case 'addLiquidityETH':
                decodedOutput.tokenA = args.token; // Typically tokenA is the ERC20
                // tokenB is ETH implicitly
                decodedOutput.amountADesired = args.amountTokenDesired;
                decodedOutput.amountAMin = args.amountTokenMin;
                // amountBMin is amountETHMin
                decodedOutput.amountBMin = args.amountETHMin;
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            case 'removeLiquidity':
                decodedOutput.tokenA = args.tokenA;
                decodedOutput.tokenB = args.tokenB;
                decodedOutput.liquidity = args.liquidity;
                decodedOutput.amountAMin = args.amountAMin;
                decodedOutput.amountBMin = args.amountBMin;
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            case 'removeLiquidityETH':
            case 'removeLiquidityETHSupportingFeeOnTransferTokens':
            case 'removeLiquidityETHWithPermit': // Permit params differ slightly but core is similar
            case 'removeLiquidityETHWithPermitSupportingFeeOnTransferTokens':
                decodedOutput.tokenA = args.token; // ERC20 token
                decodedOutput.liquidity = args.liquidity;
                decodedOutput.amountAMin = args.amountTokenMin; // ERC20 min
                decodedOutput.amountBMin = args.amountETHMin; // ETH min
                decodedOutput.to = args.to;
                decodedOutput.deadline = args.deadline;
                break;
            // Add other functions as needed, e.g., multicall or specific SushiSwap functions
        }
    }
}

// Helper function to initialize decoder with default known routers
export function initializeDefaultDecoder(): TransactionDecoder {
    const defaultRouters = [
        { address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", name: "UniswapV2Router02", abi: UniswapV2Router02ABI },
        { address: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F", name: "SushiSwapRouter", abi: SushiSwapRouterABI },
        // Add other routers from config.knownRouters if they use these standard ABIs
        // Or allow dynamic addition based on config.
    ];
    return new TransactionDecoder(defaultRouters);
}

// In shared/types/index.ts

// +++ FIX: Added this import statement for ethers types.
import { ethers, utils as ethersUtils } from 'ethers';

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

export interface FilterableTransaction extends ethers.providers.TransactionResponse {
    decodedInput?: DecodedTransactionInput & { routerName: string };
}
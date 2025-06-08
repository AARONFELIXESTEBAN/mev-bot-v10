import { ethers, utils as ethersUtils, providers } from 'ethers';

export interface DecodedTransactionInput {
    functionName: string;
    signature: string;
    args: ethersUtils.Result;
    path?: string[];
    amountOutMin?: ethers.BigNumber;
    amountIn?: ethers.BigNumber;
    amountOut?: ethers.BigNumber;
    amountInMax?: ethers.BigNumber;
    to?: string;
    deadline?: ethers.BigNumber;
    tokenA?: string;
    tokenB?: string;
    amountADesired?: ethers.BigNumber;
    amountBDesired?: ethers.BigNumber;
    amountAMin?: ethers.BigNumber;
    amountBMin?: ethers.BigNumber;
    liquidity?: ethers.BigNumber;
}

export interface FilterableTransaction extends providers.TransactionResponse {
    decodedInput?: DecodedTransactionInput & { routerName: string };
}
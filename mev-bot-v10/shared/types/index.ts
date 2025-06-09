import { TransactionResponse, BigNumberish, Result } from "ethers"; // Ethers v6 specific imports

export interface DecodedTransactionInput {
    functionName: string;
    signature: string;
    args: Result; // Ethers v6 Result type
    path?: string[];
    amountOutMin?: BigNumberish;
    amountIn?: BigNumberish;
    amountOut?: BigNumberish;
    amountInMax?: BigNumberish;
    to?: string;
    deadline?: BigNumberish;
    tokenA?: string;
    tokenB?: string;
    amountADesired?: BigNumberish;
    amountBDesired?: BigNumberish;
    amountAMin?: BigNumberish;
    amountBMin?: BigNumberish;
    liquidity?: BigNumberish;
}

export interface FilterableTransaction extends TransactionResponse { // Ethers v6 TransactionResponse
    decodedInput?: DecodedTransactionInput & { routerName: string };
}
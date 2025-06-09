export type Dict<T = any> = { [key: string]: T };

export interface EthereumTransaction {
    hash: string;
    from: string;
    to?: string | null;
    value: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasLimit: string;
    inputData: string;
    nonce: number;
    blockNumber?: number | null;
    blockHash?: string | null;
    timestamp?: number;
}

export interface TokenInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
}

export interface DexPair {
    pairAddress: string;
    token0: TokenInfo;
    token1: TokenInfo;
    dexName: string;
}

export interface RpcConfig {
    [networkName: string]: string;
}

export interface KmsConfig {
    keyPath: string;
}

export interface FirestoreDbConfig {
    projectId?: string;
}

export interface StrategyConfig {
    name: string;
    minProfitThreshold?: number;
    tradeAmount?: string;
}
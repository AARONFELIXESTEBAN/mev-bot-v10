// Placeholder for Common Type Definitions

export interface EthereumTransaction {
    hash: string;
    from: string;
    to?: string | null;
    value: string; // Store as string to handle large numbers
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasLimit: string;
    inputData: string;
    nonce: number;
    blockNumber?: number | null;
    blockHash?: string | null;
    timestamp?: number; // Optional: block timestamp or ingestion timestamp
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
    dexName: string; // e.g., "UniswapV2", "SushiSwap"
    // Add other relevant info like factory address, fee tier for V3 etc.
}

// Configuration types - these might be more detailed in specific config service
export interface RpcConfig {
    [networkName: string]: string; // e.g., mainnet: "http://..."
}

export interface KmsConfig {
    keyPath: string;
}

export interface FirestoreDbConfig {
    projectId?: string; // Optional, uses ADC default if not set
    // Potentially other settings like specific database ID if not default
}

export interface StrategyConfig {
    name: string;
    // Strategy specific parameters
    minProfitThreshold?: number; // Example
    tradeAmount?: string; // Example
}

// You can expand this with more shared types as the project grows.
// For example, standardized error types, API response types, etc.

// Ensure to keep this DRY - if types are defined well in their respective
// service interfaces (e.g., ProcessedTransaction in mempool ingestion),
// decide if they need to be duplicated/re-exported here or imported directly.
// For truly global types used across many independent modules, this is a good place.
console.log("Type Utilities Loaded (Placeholder).");

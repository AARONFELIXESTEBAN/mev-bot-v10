// src/interfaces/appConfig.interface.ts

export interface NetworkRpcConfig {
    httpUrl?: string;
    wssUrl?: string;
}

export interface DexRouterConfig {
    [dexName: string]: string; // e.g., "UniswapV2Router02": "0x7a25..."
}

export interface KnownDexPoolTokenConfig {
    address: string; // Not needed if symbol is enough to find in TokenInfo list
    symbol: string;
    // Decimals will be fetched or taken from a TokenInfo list
}

export interface KnownDexPoolEntryConfig {
    pairAddress: string;
    dexName: string; // Key to find router address in DexRouterConfig
    token0Symbol: string; // Symbol to find TokenInfo in a preloaded list
    token1Symbol: string; // Symbol to find TokenInfo in a preloaded list
}

export interface InitialPortfolioAssetConfig {
    [tokenSymbolOrAddress: string]: string; // e.g., "WETH": "10.0" (amount as string, to be parsed to BigNumber)
}


export interface AppConfig {
    NODE_ENV: 'development' | 'production' | 'test';
    LOG_LEVEL: string;
    GCP_PROJECT_ID?: string;

    // RPC Configuration
    RPC_URL_MAINNET_HTTP?: string;
    RPC_URL_MAINNET_WSS?: string;
    RPC_URL_SEPOLIA_HTTP?: string;
    RPC_URL_SEPOLIA_WSS?: string;
    // Add other network RPCs as needed, e.g., RPC_URL_ARBITRUM_HTTP

    // KMS Configuration
    KMS_KEY_PATH?: string; // Full KMS key path for signing

    // Firestore Configuration
    FIRESTORE_PROJECT_ID?: string; // Optional, defaults to GCP_PROJECT_ID or ADC
    FIRESTORE_COLLECTION_V10: string; // Main collection for bot data
    FIRESTORE_PAPER_TRADE_COLLECTION: string; // Specific collection for paper trades

    // Mempool Ingestion Service WebSocket URL (for this bot to connect to)
    MEV_BOT_MEMPOOL_WS_URL: string;
    MEMPOOL_MAX_RECONNECT_ATTEMPTS?: string; // Parsed to number
    MEMPOOL_RECONNECT_INTERVAL_MS?: string; // Parsed to number

    // Token Configuration
    BASE_TOKEN_ADDRESS: string; // e.g., WETH address
    BASE_TOKEN_SYMBOL: string;
    BASE_TOKEN_DECIMALS: string; // Parsed to number
    CORE_WHITELISTED_TOKENS_CSV: string; // CSV of whitelisted token addresses for arbitrage

    // DEX and Arbitrage Configuration
    // Example: KNOWN_DEX_POOLS_CONFIG='[{"pairAddress":"0x...", "dexName":"UniswapV2", "token0Symbol":"WETH", "token1Symbol":"USDC"}]'
    KNOWN_DEX_POOLS_CONFIG?: string; // JSON string of KnownDexPoolEntryConfig[]
    // Example: DEX_ROUTERS='{"UniswapV2":"0x7a...", "SushiSwap":"0xd9e..."}'
    DEX_ROUTERS?: string; // JSON string of DexRouterConfig

    // Simulation & Opportunity Parameters
    DEFAULT_SWAP_AMOUNT_BASE_TOKEN: string; // Amount of base token for simulation (e.g., "0.1" for 0.1 WETH)
    MIN_NET_PROFIT_BASE_TOKEN_WEI: string; // Min profit in WEI of base token to consider trade

    PROFIT_REALISM_MAX_PERCENTAGE: string; // e.g., "50.0" for 50%
    MAX_PROFIT_USD_V10: string; // e.g., "5000.0" for $5000 USD
    OPPORTUNITY_FRESHNESS_LIMIT_MS: string; // e.g., "15000" for 15 seconds
    MAX_BLOCK_AGE_FOR_OPPORTUNITY: string; // e.g., "3" blocks
    DEFAULT_SWAP_GAS_UNITS: string; // e.g., "200000"
    WETH_USD_PRICE_ESTIMATE: string; // For USD profit calculation, e.g., "2000.0"

    // Bot Operation Mode
    PAPER_TRADING_MODE: string; // "true" or "false"
    EXECUTION_ENABLED: string; // "true" or "false" (Safety flag)
    LOG_DISCARDED_OPPORTUNITIES?: string; // "true" or "false"
    BLOCK_UPDATE_INTERVAL_MS?: string; // Interval to update current block number

    // Initial Portfolio for Paper Trading (JSON string)
    // Example: INITIAL_PORTFOLIO='{"WETH_ADDRESS_PLACEHOLDER":"10000000000000000000"}'
    // It's better to use symbols if possible and resolve addresses later.
    INITIAL_PORTFOLIO?: string; // JSON string of InitialPortfolioAssetConfig

    // Secrets to load from GCP Secret Manager in production (CSV)
    SECRETS_TO_LOAD?: string;
}

// Type guard to ensure all required keys are present (basic check)
export function isValidAppConfig(config: any): config is AppConfig {
    const requiredKeys: Array<keyof AppConfig> = [
        'NODE_ENV', 'LOG_LEVEL', 'MEV_BOT_MEMPOOL_WS_URL',
        'BASE_TOKEN_ADDRESS', 'BASE_TOKEN_SYMBOL', 'BASE_TOKEN_DECIMALS',
        'CORE_WHITELISTED_TOKENS_CSV', 'DEFAULT_SWAP_AMOUNT_BASE_TOKEN',
        'MIN_NET_PROFIT_BASE_TOKEN_WEI', 'PROFIT_REALISM_MAX_PERCENTAGE',
        'MAX_PROFIT_USD_V10', 'OPPORTUNITY_FRESHNESS_LIMIT_MS',
        'MAX_BLOCK_AGE_FOR_OPPORTUNITY', 'DEFAULT_SWAP_GAS_UNITS',
        'WETH_USD_PRICE_ESTIMATE', 'PAPER_TRADING_MODE', 'EXECUTION_ENABLED',
        'FIRESTORE_COLLECTION_V10', 'FIRESTORE_PAPER_TRADE_COLLECTION'
    ];
    for (const key of requiredKeys) {
        if (!(key in config) || config[key] === undefined || config[key] === '') {
            console.error(`AppConfig Validation Error: Missing or empty required key: ${key}`);
            return false;
        }
    }
    if (!config.RPC_URL_MAINNET_HTTP && !config.RPC_URL_MAINNET_WSS) {
        // At least one RPC for mainnet should be provided if mainnet is the target
        // This logic can be expanded based on active network requirements.
        console.warn("AppConfig Validation Warning: No mainnet RPC HTTP or WSS URL provided.");
    }
    return true;
}

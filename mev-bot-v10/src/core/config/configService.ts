import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import pino from 'pino'; // Temporary logger for config service itself

// Temporary simple logger for setup phase
const tempLogger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Load .env file from project root if it exists (mainly for local development)
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

export interface NetworkRpcConfig {
    httpUrl?: string;
    wssUrl?: string;
}

export interface AppConfig {
    nodeEnv: 'development' | 'production' | 'test';
    logLevel: string;
    gcpProjectId?: string; // Optional, as it might be inferred from ADC or YAML

    // rpcUrls, kmsKeyPath, firestore settings will now primarily come from YAML
    // and be accessed via get('path.to.key')
    // For example: get('rpc_urls.mainnet.httpUrl')

    // For Secret Manager
    // Array of secret names (short names, not full paths) to load if in production
    // This can remain to indicate which secrets to fetch, which then override specific YAML paths via env var mapping
    secretsToLoad?: string[];
}

export class ConfigService {
    private config: Record<string, any> = {};

    constructor() {
        this.loadConfigFromFile(); // Load YAML first
        this.overrideWithEnv();    // Then override with ENV
        tempLogger.info('Configuration initialized from YAML and/or environment variables.');
    }

    private loadConfigFromFile(): void {
        const yamlPath = path.resolve(process.cwd(), 'config', 'config.yaml');
        const yamlExamplePath = path.resolve(process.cwd(), 'config', 'config.yaml.example');
        let effectivePath = '';

        if (fs.existsSync(yamlPath)) {
            effectivePath = yamlPath;
        } else if (fs.existsSync(yamlExamplePath)) {
            effectivePath = yamlExamplePath;
            tempLogger.warn('config.yaml not found, using config.yaml.example as fallback.');
        } else {
            tempLogger.warn('Neither config.yaml nor config.yaml.example found. Relying solely on environment variables and defaults.');
            return;
        }

        try {
            const fileContents = fs.readFileSync(effectivePath, 'utf8');
            this.config = yaml.load(fileContents) as Record<string, any> || {}; // Ensure config is an object
            tempLogger.info(`Configuration loaded from ${effectivePath}`);
        } catch (e) {
            tempLogger.error({ err: e, path: effectivePath }, `Error loading configuration file ${effectivePath}.`);
            this.config = {}; // Initialize to empty if error
        }
    }

    private overrideWithEnv(): void {
        // Define a mapping for environment variables to config paths
        const envToConfigMap: Record<string, string> = {
            'NODE_ENV': 'node_env',
            'LOG_LEVEL': 'log_level',
            'GCP_PROJECT_ID': 'gcp_project_id',
            'RPC_URL_MAINNET_HTTP': 'rpc_urls.mainnet.httpUrl',
            'RPC_URL_MAINNET_WSS': 'rpc_urls.mainnet.wssUrl',
            'RPC_URL_SEPOLIA_HTTP': 'rpc_urls.sepolia.httpUrl',
            'RPC_URL_SEPOLIA_WSS': 'rpc_urls.sepolia.wssUrl',
            'KMS_KEY_PATH': 'kms_config.operational_wallet_key_path',
            'FIRESTORE_PROJECT_ID': 'firestore_config.project_id',
            'FIRESTORE_COLLECTION_V10': 'firestore_config.main_collection_v10',
            'MEV_BOT_MEMPOOL_WS_URL': 'mempool_ingestion.publisher_url',
            'CORE_WHITELISTED_TOKENS_CSV': 'opportunity_service.core_whitelisted_tokens_csv',
            'BASE_TOKEN_ADDRESS': 'opportunity_service.base_token_address',
            'BASE_TOKEN_SYMBOL': 'opportunity_service.base_token_symbol',
            'BASE_TOKEN_DECIMALS': 'opportunity_service.base_token_decimals',
            'DEFAULT_SWAP_AMOUNT_BASE_TOKEN': 'simulation_service.default_swap_amount_base_token',
            'MIN_NET_PROFIT_BASE_TOKEN_WEI': 'simulation_service.min_net_profit_base_token_wei',
            'SECRETS_TO_LOAD': 'secrets_to_load',
            'LOG_DISCARDED_OPPORTUNITIES': 'data_collection.log_discarded_opportunities',
            'MEMPOOL_MAX_RECONNECT_ATTEMPTS': 'mempool_ingestion.max_reconnect_attempts',
            'MEMPOOL_RECONNECT_INTERVAL_MS': 'mempool_ingestion.reconnect_interval_ms',
            'MIN_PROFIT_THRESHOLD_USD': 'simulation_service.min_profit_threshold_usd',
            'PAPER_TRADING_ENABLED': 'paper_trading_config.enabled',
            'EXECUTION_ENABLED': 'execution_config.enabled',
            'BLOCK_UPDATE_INTERVAL_MS': 'orchestrator.block_update_interval_ms',
            'UNISWAPV2_ROUTER_ADDRESS': 'opportunity_service.dex_routers.UniswapV2Router02',
            'SUSHISWAP_ROUTER_ADDRESS': 'opportunity_service.dex_routers.SushiSwapRouter',
            'WETH_USD_PRICE_ESTIMATE': 'price_service.weth_usd_price_estimate',
        };

        for (const envVar in envToConfigMap) {
            if (process.env[envVar] !== undefined) {
                const configPath = envToConfigMap[envVar];
                let value: any = process.env[envVar];
                if (typeof value === 'string') {
                    if (!isNaN(Number(value)) && value.trim() !== '') {
                        value = Number(value);
                    } else if (value.toLowerCase() === 'true') {
                        value = true;
                    } else if (value.toLowerCase() === 'false') {
                        value = false;
                    } else if (configPath === 'secrets_to_load' && typeof value === 'string') {
                        value = value.split(',').map(s => s.trim());
                    }
                }
                this.setNestedProperty(this.config, configPath, value);
            }
        }

        this.config.nodeEnv = process.env.NODE_ENV || this.get('node_env') || 'development';
        this.config.logLevel = process.env.LOG_LEVEL || this.get('log_level') || 'info';
        this.config.gcpProjectId = process.env.GCP_PROJECT_ID || this.get('gcp_project_id');
        if(process.env.SECRETS_TO_LOAD) {
            this.config.secretsToLoad = process.env.SECRETS_TO_LOAD.split(',').map(s => s.trim());
        } else if (!this.get('secrets_to_load')) {
            this.config.secretsToLoad = [];
        }
    }

    private setNestedProperty(obj: Record<string, any>, path: string, value: any) {
        const keys = path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (current[keys[i]] === undefined || typeof current[keys[i]] !== 'object') {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
    }

    // Keep loadSecretsFromGcp, but it will need adjustment for how it sets values
    // For now, it might set ENV VARS which then overrideWithEnv picks up, or directly set via setNestedProperty
    public async loadSecretsFromGcp(): Promise<void> {
        if (this.config.nodeEnv !== 'production' || !this.config.secretsToLoad || this.config.secretsToLoad.length === 0) {
            tempLogger.info('Not in production or no secrets specified to load from GCP Secret Manager.');
            return;
        }

        if (!this.config.gcpProjectId) {
            tempLogger.error('GCP_PROJECT_ID is not set. Cannot load secrets from Secret Manager.');
            // In a real app, you might throw an error here or have a fallback.
            return;
        }

        const secretClient = new SecretManagerServiceClient();
        tempLogger.info(`Loading secrets from GCP Secret Manager for project ${this.config.gcpProjectId}: ${this.config.secretsToLoad.join(', ')}`);

        for (const secretName of this.config.secretsToLoad) {
            try {
                const [version] = await secretClient.accessSecretVersion({
                    name: `projects/${this.config.gcpProjectId}/secrets/${secretName}/versions/latest`,
                });

                if (version.payload?.data) {
                    const secretValue = version.payload.data.toString();
                    // How to map secretName to a config property?
                    // For now, let's assume secretName directly maps to an env var name.
                    // process.env[secretName] = secretValue; // This makes it available via process.env

                    // Or, update config object directly if names match AppConfig keys or a predefined mapping
                    // This requires a more sophisticated mapping logic if secret names don't match config keys.
                    // Example: if secretName is "RPC_URL_MAINNET_HTTP_SECRET", map to rpcUrls.mainnet.httpUrl
                    // For simplicity, let's log and user must ensure env vars are set by this process or startup script
                    tempLogger.info(`Secret ${secretName} loaded. Set it as process.env.${secretName.toUpperCase()} if not already.`);

                    // A more direct update (example - requires careful key mapping):
                    if (secretName === 'RPC_URL_MAINNET_HTTP' && this.config.rpcUrls?.mainnet) this.config.rpcUrls.mainnet.httpUrl = secretValue;
                    else if (secretName === 'RPC_URL_MAINNET_WSS' && this.config.rpcUrls?.mainnet) this.config.rpcUrls.mainnet.wssUrl = secretValue;
                    else if (secretName === 'KMS_KEY_PATH') this.config.kmsKeyPath = secretValue;
                    // ... add more mappings as needed based on your secret naming strategy

                } else {
                    tempLogger.warn(`Secret ${secretName} has no payload data.`);
                }
            } catch (error) {
                tempLogger.error({ err: error, secretName }, `Failed to load secret: ${secretName}`);
                // Decide if this is fatal or if defaults are acceptable
            }
        }
        tempLogger.info('Finished attempting to load secrets from GCP Secret Manager.');
        // Re-log or re-validate critical configs if they were expected from secrets
    }


    // Helper to get the envToConfigMap, potentially useful for loadSecretsFromGcp
    private getEnvToConfigMap(): Record<string, string> {
        return {
            'NODE_ENV': 'node_env',
            'LOG_LEVEL': 'log_level',
            'GCP_PROJECT_ID': 'gcp_project_id',
            'RPC_URL_MAINNET_HTTP': 'rpc_urls.mainnet.httpUrl',
            'RPC_URL_MAINNET_WSS': 'rpc_urls.mainnet.wssUrl',
            'RPC_URL_SEPOLIA_HTTP': 'rpc_urls.sepolia.httpUrl',
            'RPC_URL_SEPOLIA_WSS': 'rpc_urls.sepolia.wssUrl',
            'KMS_KEY_PATH': 'kms_config.operational_wallet_key_path',
            'FIRESTORE_PROJECT_ID': 'firestore_config.project_id',
            'FIRESTORE_COLLECTION_V10': 'firestore_config.main_collection_v10',
            'MEV_BOT_MEMPOOL_WS_URL': 'mempool_ingestion.publisher_url',
            'CORE_WHITELISTED_TOKENS_CSV': 'opportunity_service.core_whitelisted_tokens_csv',
            'BASE_TOKEN_ADDRESS': 'opportunity_service.base_token_address',
            'BASE_TOKEN_SYMBOL': 'opportunity_service.base_token_symbol',
            'BASE_TOKEN_DECIMALS': 'opportunity_service.base_token_decimals',
            'DEFAULT_SWAP_AMOUNT_BASE_TOKEN': 'simulation_service.default_swap_amount_base_token',
            'MIN_NET_PROFIT_BASE_TOKEN_WEI': 'simulation_service.min_net_profit_base_token_wei',
            'SECRETS_TO_LOAD': 'secrets_to_load',
            'LOG_DISCARDED_OPPORTUNITIES': 'data_collection.log_discarded_opportunities',
            'MEMPOOL_MAX_RECONNECT_ATTEMPTS': 'mempool_ingestion.max_reconnect_attempts',
            'MEMPOOL_RECONNECT_INTERVAL_MS': 'mempool_ingestion.reconnect_interval_ms',
            'MIN_PROFIT_THRESHOLD_USD': 'simulation_service.min_profit_threshold_usd',
            'PAPER_TRADING_ENABLED': 'paper_trading_config.enabled',
            'EXECUTION_ENABLED': 'execution_config.enabled',
            'BLOCK_UPDATE_INTERVAL_MS': 'orchestrator.block_update_interval_ms',
            'UNISWAPV2_ROUTER_ADDRESS': 'opportunity_service.dex_routers.UniswapV2Router02',
            'SUSHISWAP_ROUTER_ADDRESS': 'opportunity_service.dex_routers.SushiSwapRouter',
            'WETH_USD_PRICE_ESTIMATE': 'price_service.weth_usd_price_estimate',
        };
    }

    public get(path: string): any | undefined {
        const keys = path.split('.');
        let current = this.config;
        for (const key of keys) {
            if (current === null || typeof current !== 'object' || !(key in current)) {
                return undefined;
            }
            current = current[key];
        }
        return current;
    }

    public getOrThrow(path: string): any {
        const value = this.get(path);
        if (value === undefined || value === null) { // Allow empty string by not checking value === ''
            throw new Error(`Configuration error: Missing required config path '${path}'`);
        }
        // Allow empty CSV for tokens, otherwise throw if string is empty
        if (typeof value === 'string' && value.trim() === '' && path !== 'opportunity_service.core_whitelisted_tokens_csv') {
             throw new Error(`Configuration error: Empty required config path '${path}'`);
        }
        return value;
    }

    // Specific getter for RPC URLs for convenience - adjust to new structure
    public getRpcConfig(networkName: string): NetworkRpcConfig | undefined {
        const httpUrl = this.get(`rpc_urls.${networkName}.httpUrl`);
        const wssUrl = this.get(`rpc_urls.${networkName}.wssUrl`);
        if (httpUrl || wssUrl) {
            return { httpUrl, wssUrl };
        }
        return undefined;
    }

    public isProduction(): boolean {
        return this.get('node_env') === 'production';
    }
}

// Export a singleton instance
// The initialization of secrets should be handled asynchronously at app startup.
// const configService = new ConfigService();
// export default configService;

// Usage:
// import { ConfigService } from './config.service';
// const configService = new ConfigService();
// await configService.loadSecretsFromGcp(); // Call this early in app bootstrap
// export default configService;
// This pattern is better for async init.
// For this file structure, we'll export the class and expect instantiation and async loading in main.ts or similar.
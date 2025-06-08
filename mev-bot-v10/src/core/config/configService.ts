import dotenv from 'dotenv';
import path from 'path';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import pino from 'pino'; // Temporary logger for config service itself

// Import shared interfaces
import {
    AppConfig, // Imported, local definition will be removed
    NetworkRpcConfig, // Imported, local definition will be removed
    DexRouterConfig,
    KnownDexPoolEntryConfig,
    InitialPortfolioAssetConfig,
    isValidAppConfig // Optional: for validation after loading
} from '../../interfaces/appConfig.interface';

// Temporary simple logger for setup phase, as main logger depends on this config
const tempLogger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Load .env file from project root if it exists (mainly for local development)
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

// Local interface definitions for NetworkRpcConfig and AppConfig REMOVED as they are now imported.

export class ConfigService {
    // Use the imported AppConfig. All values are initially undefined or string from process.env
    private envVars: { [key: string]: string | undefined } = process.env;
    private config: AppConfig; // This will hold the parsed and typed config

    constructor() {
        this.config = this.loadAndParseEnv();
        tempLogger.info('ConfigService: Initial configuration loaded and parsed from environment variables.');
        // Optionally validate after loading
        if (!isValidAppConfig(this.config)) {
            // isValidAppConfig should log specific errors from appConfig.interface.ts
            tempLogger.fatal("ConfigService: Initial configuration is invalid. Please check environment variables and .env file against appConfig.interface.ts requirements.");
            // Depending on severity, you might throw an error or exit
            // For now, we'll allow the app to continue starting so other services can report missing specific configs.
            // throw new Error("Initial configuration is invalid.");
        }
    }

    private loadAndParseEnv(): AppConfig {
        // All values from process.env are strings or undefined.
        // The AppConfig interface defined in appConfig.interface.ts expects these raw string values.
        // Parsing to numbers, booleans, arrays, or JSON objects happens in specific getters or service constructors.
        return {
            NODE_ENV: (this.envVars.NODE_ENV || 'development') as AppConfig['NODE_ENV'],
            LOG_LEVEL: this.envVars.LOG_LEVEL || 'info',
            GCP_PROJECT_ID: this.envVars.GCP_PROJECT_ID,

            RPC_URL_MAINNET_HTTP: this.envVars.RPC_URL_MAINNET_HTTP,
            RPC_URL_MAINNET_WSS: this.envVars.RPC_URL_MAINNET_WSS,
            RPC_URL_SEPOLIA_HTTP: this.envVars.RPC_URL_SEPOLIA_HTTP,
            RPC_URL_SEPOLIA_WSS: this.envVars.RPC_URL_SEPOLIA_WSS,

            KMS_KEY_PATH: this.envVars.KMS_KEY_PATH,

            FIRESTORE_PROJECT_ID: this.envVars.FIRESTORE_PROJECT_ID || this.envVars.GCP_PROJECT_ID,
            FIRESTORE_COLLECTION_V10: this.envVars.FIRESTORE_COLLECTION_V10 || 'mevBotV10Data_default',
            FIRESTORE_PAPER_TRADE_COLLECTION: this.envVars.FIRESTORE_PAPER_TRADE_COLLECTION || 'paperTradesV10_default',

            MEV_BOT_MEMPOOL_WS_URL: this.envVars.MEV_BOT_MEMPOOL_WS_URL || '', // Required, checked by isValidAppConfig
            MEMPOOL_MAX_RECONNECT_ATTEMPTS: this.envVars.MEMPOOL_MAX_RECONNECT_ATTEMPTS,
            MEMPOOL_RECONNECT_INTERVAL_MS: this.envVars.MEMPOOL_RECONNECT_INTERVAL_MS,

            BASE_TOKEN_ADDRESS: this.envVars.BASE_TOKEN_ADDRESS || '', // Required
            BASE_TOKEN_SYMBOL: this.envVars.BASE_TOKEN_SYMBOL || 'WETH',
            BASE_TOKEN_DECIMALS: this.envVars.BASE_TOKEN_DECIMALS || '18',
            CORE_WHITELISTED_TOKENS_CSV: this.envVars.CORE_WHITELISTED_TOKENS_CSV || '',

            KNOWN_DEX_POOLS_CONFIG: this.envVars.KNOWN_DEX_POOLS_CONFIG,
            DEX_ROUTERS: this.envVars.DEX_ROUTERS,

            DEFAULT_SWAP_AMOUNT_BASE_TOKEN: this.envVars.DEFAULT_SWAP_AMOUNT_BASE_TOKEN || '0.1',
            MIN_NET_PROFIT_BASE_TOKEN_WEI: this.envVars.MIN_NET_PROFIT_BASE_TOKEN_WEI || '1000000000000000', // 0.001 ETH

            PROFIT_REALISM_MAX_PERCENTAGE: this.envVars.PROFIT_REALISM_MAX_PERCENTAGE || '50.0',
            MAX_PROFIT_USD_V10: this.envVars.MAX_PROFIT_USD_V10 || '5000.0',
            OPPORTUNITY_FRESHNESS_LIMIT_MS: this.envVars.OPPORTUNITY_FRESHNESS_LIMIT_MS || '15000',
            MAX_BLOCK_AGE_FOR_OPPORTUNITY: this.envVars.MAX_BLOCK_AGE_FOR_OPPORTUNITY || '3',
            DEFAULT_SWAP_GAS_UNITS: this.envVars.DEFAULT_SWAP_GAS_UNITS || '200000',
            WETH_USD_PRICE_ESTIMATE: this.envVars.WETH_USD_PRICE_ESTIMATE || '2000.0',

            PAPER_TRADING_MODE: this.envVars.PAPER_TRADING_MODE || 'true',
            EXECUTION_ENABLED: this.envVars.EXECUTION_ENABLED || 'false',
            LOG_DISCARDED_OPPORTUNITIES: this.envVars.LOG_DISCARDED_OPPORTUNITIES,
            BLOCK_UPDATE_INTERVAL_MS: this.envVars.BLOCK_UPDATE_INTERVAL_MS,
            INITIAL_PORTFOLIO: this.envVars.INITIAL_PORTFOLIO,
            SECRETS_TO_LOAD: this.envVars.SECRETS_TO_LOAD,
        };
    }

    public async loadSecretsFromGcp(): Promise<void> {
        if (this.config.NODE_ENV !== 'production' || !this.config.SECRETS_TO_LOAD) {
            tempLogger.info('ConfigService: Not in production or no SECRETS_TO_LOAD specified.');
            return;
        }

        const secretsToLoadArray = this.config.SECRETS_TO_LOAD.split(',').map(s => s.trim()).filter(s => s);
        if (secretsToLoadArray.length === 0) {
            tempLogger.info('ConfigService: SECRETS_TO_LOAD was empty after parsing.');
            return;
        }

        if (!this.config.GCP_PROJECT_ID) {
            tempLogger.error('ConfigService: GCP_PROJECT_ID is not set. Cannot load secrets from Secret Manager.');
            return; // Or throw
        }

        const secretClient = new SecretManagerServiceClient();
        tempLogger.info(`ConfigService: Loading secrets from GCP Secret Manager for project ${this.config.GCP_PROJECT_ID}: ${secretsToLoadArray.join(', ')}`);

        for (const secretName of secretsToLoadArray) {
            try {
                const fullSecretPath = `projects/${this.config.GCP_PROJECT_ID}/secrets/${secretName}/versions/latest`;
                const [version] = await secretClient.accessSecretVersion({ name: fullSecretPath });

                if (version.payload?.data) {
                    const secretValue = version.payload.data.toString();
                    // Override the corresponding key in this.config.
                    // The secretName from SECRETS_TO_LOAD should match a key in AppConfig.
                    if (secretName in this.config) {
                        (this.config as any)[secretName] = secretValue; // Type assertion needed here
                        tempLogger.info(`ConfigService: Secret '${secretName}' loaded and updated in config.`);
                    } else {
                        tempLogger.warn(`ConfigService: Secret '${secretName}' loaded from GCP, but it does not directly map to a key in AppConfig. It will be available via process.env.${secretName} if set by GCP environment, but prefer direct AppConfig mapping.`);
                    }
                } else {
                    tempLogger.warn(`ConfigService: Secret ${secretName} has no payload data.`);
                }
            } catch (error) {
                tempLogger.error({ err: error, secretName }, `ConfigService: Failed to load secret: ${secretName}`);
            }
        }
        tempLogger.info('ConfigService: Finished attempting to load secrets from GCP Secret Manager.');
        if (!isValidAppConfig(this.config)) {
             tempLogger.warn("ConfigService: Configuration may still be invalid after attempting to load secrets.");
        }
    }

    public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
        return this.config[key];
    }

    public getOrThrow<K extends keyof AppConfig>(key: K): NonNullable<AppConfig[K]> {
        const value = this.config[key];
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
            const errorMsg = `Configuration error: Missing or empty required config key '${key}'`;
            tempLogger.fatal(errorMsg);
            throw new Error(errorMsg);
        }
        return value as NonNullable<AppConfig[K]>;
    }

    public getRpcUrlsForNetwork(networkName: string): NetworkRpcConfig | undefined {
        const httpKey = `RPC_URL_${networkName.toUpperCase()}_HTTP` as keyof AppConfig;
        const wssKey = `RPC_URL_${networkName.toUpperCase()}_WSS` as keyof AppConfig;

        const httpUrl = this.config[httpKey] as string | undefined;
        const wssUrl = this.config[wssKey] as string | undefined;

        if (httpUrl || wssUrl) {
            return { httpUrl, wssUrl };
        }
        return undefined;
    }

    public getKnownDexPools(): KnownDexPoolEntryConfig[] {
        const jsonString = this.get('KNOWN_DEX_POOLS_CONFIG');
        if (jsonString) {
            try {
                return JSON.parse(jsonString) as KnownDexPoolEntryConfig[];
            } catch (e) {
                tempLogger.error({err: e, jsonString}, "Failed to parse KNOWN_DEX_POOLS_CONFIG JSON string.");
                return [];
            }
        }
        return [];
    }

    public getDexRouters(): DexRouterConfig {
        const jsonString = this.get('DEX_ROUTERS');
        if (jsonString) {
            try {
                return JSON.parse(jsonString) as DexRouterConfig;
            } catch (e) {
                tempLogger.error({err: e, jsonString}, "Failed to parse DEX_ROUTERS JSON string.");
                return {};
            }
        }
        return {};
    }

    public getInitialPortfolio(): InitialPortfolioAssetConfig {
        const jsonString = this.get('INITIAL_PORTFOLIO');
        if (jsonString) {
            try {
                return JSON.parse(jsonString) as InitialPortfolioAssetConfig;
            } catch (e) {
                tempLogger.error({err: e, jsonString}, "Failed to parse INITIAL_PORTFOLIO JSON string.");
                return {};
            }
        }
        return {};
    }

    public isProduction(): boolean {
        return this.config.NODE_ENV === 'production';
    }
}

import dotenv from 'dotenv';
import path from 'path';
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
    gcpProjectId?: string; // Optional, as it might be inferred from ADC

    rpcUrls: { [networkName: string]: NetworkRpcConfig };

    kmsKeyPath?: string; // Full path to KMS key version for signing

    firestoreProjectId?: string; // Optional, can be same as gcpProjectId
    firestoreCollectionV10: string;

    // For Secret Manager
    // Array of secret names (short names, not full paths) to load if in production
    secretsToLoad?: string[];
}

export class ConfigService {
    private config: Partial<AppConfig> = {}; // Partial initially, becomes full after load

    constructor() {
        this.loadFromEnv();
    }

    private loadFromEnv(): void {
        this.config = {
            nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) || 'development',
            logLevel: process.env.LOG_LEVEL || 'info',
            gcpProjectId: process.env.GCP_PROJECT_ID,
            rpcUrls: {
                mainnet: { // Example, should be defined in .env or secrets
                    httpUrl: process.env.RPC_URL_MAINNET_HTTP,
                    wssUrl: process.env.RPC_URL_MAINNET_WSS,
                },
                sepolia: {
                    httpUrl: process.env.RPC_URL_SEPOLIA_HTTP,
                    wssUrl: process.env.RPC_URL_SEPOLIA_WSS,
                }
                // Add other networks as needed, loaded from env
            },
            kmsKeyPath: process.env.KMS_KEY_PATH,
            firestoreProjectId: process.env.FIRESTORE_PROJECT_ID || process.env.GCP_PROJECT_ID,
            firestoreCollectionV10: process.env.FIRESTORE_COLLECTION_V10 || 'mevBotV10Data',
            secretsToLoad: process.env.SECRETS_TO_LOAD?.split(',').map(s => s.trim()) || [],
        };
        tempLogger.info('Configuration loaded from environment variables.');
    }

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


    public get<K extends keyof AppConfig>(key: K): AppConfig[K] | undefined {
        return this.config[key];
    }

    public getOrThrow<K extends keyof AppConfig>(key: K): AppConfig[K] {
        const value = this.config[key];
        if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
            throw new Error(`Configuration error: Missing required config key '${key}'`);
        }
        return value;
    }

    // Specific getter for RPC URLs for convenience
    public getRpcConfig(networkName: string): NetworkRpcConfig | undefined {
        return this.config.rpcUrls?.[networkName];
    }

    public isProduction(): boolean {
        return this.config.nodeEnv === 'production';
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
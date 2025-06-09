import dotenv from 'dotenv';
import path from 'path';

// Load .env file from project root if it exists there
// This ensures that when running from `dist` or `src` during dev, it finds the .env
// For production, environment variables are preferred.
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });


export interface AppConfig {
    nodeEnv: string;
    logLevel: string;
    gcpNbeWssUrl: string;
    thirdPartyRpcWssUrl: string;
    mempoolKnownRouterAddressesCsv: string;
    knownRouters: string[]; // Derived from the CSV string
    publisherPort: number;
    maxReconnectAttempts: number;
    reconnectIntervalMs: number;
    fetchTxTimeoutMs: number;
    websocketUrl: string; // Derived based on NODE_ENV
}

const knownRoutersCsv = process.env.MEMPOOL_KNOWN_ROUTER_ADDRESSES_CSV ||
    "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D,0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"; // Default to UniV2 and SushiSwap Router

const nodeEnv = process.env.NODE_ENV || 'development';
const gcpNbeWssUrl = process.env.GCP_NBE_WSS_URL || '';
const thirdPartyRpcWssUrl = process.env.THIRD_PARTY_RPC_WSS_URL || '';

let websocketUrl: string;

if (nodeEnv === 'development') {
    if (!thirdPartyRpcWssUrl) {
        console.error("FATAL: THIRD_PARTY_RPC_WSS_URL is not defined for development environment.");
        process.exit(1);
    }
    websocketUrl = thirdPartyRpcWssUrl;
} else {
    if (!gcpNbeWssUrl) {
        console.error("FATAL: GCP_NBE_WSS_URL is not defined for non-development environment.");
        process.exit(1);
    }
    websocketUrl = gcpNbeWssUrl;
}

const config: AppConfig = {
    nodeEnv,
    logLevel: process.env.LOG_LEVEL || 'info',
    gcpNbeWssUrl,
    thirdPartyRpcWssUrl,
    mempoolKnownRouterAddressesCsv: knownRoutersCsv,
    knownRouters: knownRoutersCsv.split(',').map(address => address.trim().toLowerCase()),
    publisherPort: parseInt(process.env.PUBLISHER_PORT || '3001', 10),
    maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '10', 10), // Increased default
    reconnectIntervalMs: parseInt(process.env.RECONNECT_INTERVAL_MS || '5000', 10), // 5 seconds
    fetchTxTimeoutMs: parseInt(process.env.FETCH_TX_TIMEOUT_MS || '10000', 10), // 10 seconds
    websocketUrl, // Assign the derived websocketUrl
};

// The fatal error checks for whether the necessary URL is defined are now handled
// in the logic above that assigns `websocketUrl`. If either THIRD_PARTY_RPC_WSS_URL (in dev)
// or GCP_NBE_WSS_URL (in prod) is missing, the process will exit.

export default config;

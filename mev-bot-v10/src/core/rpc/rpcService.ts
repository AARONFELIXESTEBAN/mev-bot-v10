import { ethers, providers } from 'ethers';
import { ConfigService, NetworkRpcConfig } from '../config/configService'; // Adjust path
import { getLogger } from '../logger/loggerService'; // Adjust path

const logger = getLogger(); // Assuming logger is initialized by the time RpcService is used

interface ProviderStats {
    errors: number;
    successes: number;
    lastErrorTimestamp?: number;
}

const MAX_CONSECUTIVE_ERRORS = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30 * 1000; // 30 seconds

export class RpcService {
    private jsonRpcProviders: Map<string, providers.JsonRpcProvider> = new Map();
    private webSocketProviders: Map<string, providers.WebSocketProvider> = new Map();
    private providerStats: Map<string, ProviderStats> = new Map(); // Key: networkName/url

    constructor(private configService: ConfigService) {
        const rpcUrlsConfig = this.configService.get('rpc_urls'); // Changed 'rpcUrls' to 'rpc_urls'
        if (rpcUrlsConfig) {
            for (const network in rpcUrlsConfig) {
                const networkConfig = rpcUrlsConfig[network];
                if (networkConfig.httpUrl) {
                    this.initializeJsonRpcProvider(network, networkConfig.httpUrl);
                }
                if (networkConfig.wssUrl) {
                    this.initializeWebSocketProvider(network, networkConfig.wssUrl);
                }
            }
        } else {
            logger.warn('RpcService: No RPC URLs configured.');
        }
    }

    private initializeJsonRpcProvider(network: string, httpUrl: string): void {
        try {
            const provider = new providers.JsonRpcProvider(httpUrl);
            this.jsonRpcProviders.set(network, provider);
            this.providerStats.set(`${network}_http`, { errors: 0, successes: 0 });
            logger.info(`RpcService: Initialized JSON-RPC provider for ${network} at ${httpUrl}`);
        } catch (error) {
            logger.error({ err: error, network, httpUrl }, `RpcService: Failed to initialize JSON-RPC provider for ${network}`);
        }
    }

    private initializeWebSocketProvider(network: string, wssUrl: string): void {
        try {
            const provider = new providers.WebSocketProvider(wssUrl);
            // Handle WS provider lifecycle (connect, disconnect, errors) for robustness if needed
            // For MVP, keeping it simple. Reconnection logic is complex for WS providers.
            this.webSocketProviders.set(network, provider);
            this.providerStats.set(`${network}_wss`, { errors: 0, successes: 0 });
            logger.info(`RpcService: Initialized WebSocket provider for ${network} at ${wssUrl}`);

            // Monitor WS connection status
            provider._websocket.onopen = () => {
                logger.info(`RpcService: WebSocket connected for ${network} at ${wssUrl}`);
                this.providerStats.get(`${network}_wss`)!.errors = 0; // Reset errors on connect
            };
            provider._websocket.onclose = (event: CloseEvent) => {
                logger.warn({ network, wssUrl, code: event.code, reason: event.reason }, `RpcService: WebSocket disconnected for ${network}. Will attempt to re-establish on next use or via explicit reconnect method.`);
                // Basic attempt to re-initialize, or rely on next access to trigger re-init
                // This can lead to cascading failures if not handled carefully.
                // For true robustness, a dedicated WS manager like in mempool-ingestion is needed.
                this.webSocketProviders.delete(network); // Remove stale provider
                // setTimeout(() => this.initializeWebSocketProvider(network, wssUrl), 5000); // Simple retry
            };
            provider._websocket.onerror = (error: Event) => {
                 logger.error({ network, wssUrl, errorType: error.type }, `RpcService: WebSocket error for ${network}.`);
            };

        } catch (error) {
            logger.error({ err: error, network, wssUrl }, `RpcService: Failed to initialize WebSocket provider for ${network}`);
        }
    }

    private getStatsKey(network: string, type: 'http' | 'wss'): string {
        return `${network}_${type}`;
    }

    private isCircuitOpen(statsKey: string): boolean {
        const stats = this.providerStats.get(statsKey);
        if (stats && stats.errors >= MAX_CONSECUTIVE_ERRORS) {
            if (stats.lastErrorTimestamp && (Date.now() - stats.lastErrorTimestamp) < CIRCUIT_BREAKER_COOLDOWN_MS) {
                logger.warn(`RpcService: Circuit breaker OPEN for ${statsKey}. Last error at ${new Date(stats.lastErrorTimestamp).toISOString()}`);
                return true; // Circuit is open
            } else {
                // Cooldown passed, try closing the circuit (half-open state)
                logger.info(`RpcService: Circuit breaker cooldown passed for ${statsKey}. Resetting errors.`);
                stats.errors = 0; // Reset errors to allow new attempts
            }
        }
        return false; // Circuit is closed
    }

    private recordSuccess(statsKey: string): void {
        const stats = this.providerStats.get(statsKey);
        if (stats) {
            stats.successes++;
            stats.errors = 0; // Reset errors on success
        }
    }

    private recordError(statsKey: string): void {
        const stats = this.providerStats.get(statsKey);
        if (stats) {
            stats.errors++;
            stats.lastErrorTimestamp = Date.now();
        }
    }

    public getJsonRpcProvider(network: string = 'mainnet'): providers.JsonRpcProvider | undefined {
        const statsKey = this.getStatsKey(network, 'http');
        if (this.isCircuitOpen(statsKey)) return undefined;

        let provider = this.jsonRpcProviders.get(network);
        if (!provider) {
            // Attempt to re-initialize if missing (e.g., after config update or initial failure)
            const networkConfig = this.configService.getRpcConfig(network);
            if (networkConfig?.httpUrl) {
                this.initializeJsonRpcProvider(network, networkConfig.httpUrl);
                provider = this.jsonRpcProviders.get(network);
            }
        }
        return provider;
    }

    public getWebSocketProvider(network: string = 'mainnet'): providers.WebSocketProvider | undefined {
        const statsKey = this.getStatsKey(network, 'wss');
        if (this.isCircuitOpen(statsKey)) return undefined;

        let provider = this.webSocketProviders.get(network);
        if (!provider || provider._websocket.readyState === WebSocket.CLOSED || provider._websocket.readyState === WebSocket.CLOSING) {
             logger.warn(`RpcService: WebSocketProvider for ${network} is not connected or missing. Attempting re-initialization.`);
            const networkConfig = this.configService.getRpcConfig(network);
            if (networkConfig?.wssUrl) {
                // Clean up old one if it exists and is closed/closing
                if(provider) {
                    provider.removeAllListeners(); // ethers v5 might need this
                    try { provider._websocket.close(); } catch(e) {/*ignore*/}
                }
                this.initializeWebSocketProvider(network, networkConfig.wssUrl);
                provider = this.webSocketProviders.get(network);
            } else {
                logger.error(`RpcService: No WSS URL configured for ${network} to re-initialize WebSocketProvider.`);
                return undefined;
            }
        }
        return provider;
    }

    // Wrapper for a generic RPC call with retry and circuit breaker
    public async makeRpcCall<T>(
        network: string,
        providerType: 'http' | 'wss',
        action: (provider: providers.Provider) => Promise<T>,
        retries: number = 3
    ): Promise<T | null> {
        const provider = providerType === 'http'
            ? this.getJsonRpcProvider(network)
            : this.getWebSocketProvider(network);

        const statsKey = this.getStatsKey(network, providerType);

        if (!provider) {
            logger.error(`RpcService: No ${providerType} provider available for ${network} for RPC call.`);
            this.recordError(statsKey); // Record error even if provider is not found due to circuit breaker
            return null;
        }
        if (this.isCircuitOpen(statsKey)) { // Re-check, provider might have been undefined due to circuit
             logger.warn(`RpcService: Call aborted for ${statsKey} due to open circuit breaker.`);
             return null;
        }

        for (let i = 0; i < retries; i++) {
            try {
                const result = await action(provider);
                this.recordSuccess(statsKey);
                return result;
            } catch (error: any) {
                logger.warn({ err: error, network, providerType, attempt: i + 1, totalRetries: retries }, `RpcService: RPC call failed (attempt ${i + 1}/${retries})`);
                if (i === retries - 1) { // Last attempt
                    this.recordError(statsKey);
                    logger.error({ err: error, network, providerType }, `RpcService: RPC call failed after ${retries} attempts.`);
                    return null; // Or throw custom error
                }
                // Simple fixed delay, consider exponential backoff
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
        return null; // Should not be reached if retries > 0
    }

    public async getFeeData(network: string, retries: number = 3): Promise<ethers.providers.FeeData | null> {
        logger.debug({ network }, `RpcService: getFeeData called for network ${network}`);
        const feeData = await this.makeRpcCall(
            network,
            'http', // Fee data is typically fetched via HTTP RPC
            (provider) => provider.getFeeData(),
            retries
        );
        if (!feeData) {
            logger.warn(`RpcService: getFeeData returned null for network ${network} after ${retries} retries.`);
        }
        return feeData;
    }

    public closeAllWebSocketProviders(): void {
        logger.info("RpcService: Attempting to close all active WebSocket providers...");
        this.webSocketProviders.forEach((provider, network) => {
            try {
                if (provider && provider._websocket) {
                    logger.info(`RpcService: Closing WebSocket provider for network: ${network}`);
                    provider.removeAllListeners(); // Clean up any direct listeners on the provider itself
                    provider._websocket.close(1000, "RpcService shutting down all WebSockets");
                }
            } catch (e) {
                logger.error({ err: e, network }, `RpcService: Error closing WebSocket provider for ${network}.`);
            }
        });
        this.webSocketProviders.clear(); // Clear the map
        logger.info("RpcService: All WebSocket providers closure attempts finished and map cleared.");
    }
}

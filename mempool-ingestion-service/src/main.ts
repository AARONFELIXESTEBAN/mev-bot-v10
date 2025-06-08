import config from './utils/config';
import logger from './utils/logger';
import { WebsocketConnector } from './services/websocketConnector';
import { TransactionFetcher } from './services/transactionFetcher';
import { TransactionDecoder, initializeDefaultDecoder } from './services/transactionDecoder';
import { DecodedTransactionInput } from '@shared/types'; // Added this line
import { FilterService, FilterableTransaction } from './services/filter';
import { PublisherService } from './services/publisher';
import { ethers } from 'ethers'; // Import ethers for TransactionResponse type

let wsConnector: WebsocketConnector;
let txFetcher: TransactionFetcher | null = null; // Initialized once provider is ready
let txDecoder: TransactionDecoder;
let publisher: PublisherService;

async function main() {
    logger.info(`Starting Mempool Ingestion Service in ${config.nodeEnv} mode...`);
    logger.info(`Known routers for filtering: ${config.knownRouters.join(', ')}`);

    wsConnector = new WebsocketConnector();
    txDecoder = initializeDefaultDecoder(); // Using default routers for now
    publisher = new PublisherService(config.publisherPort);

    try {
        await publisher.start();
        logger.info('Publisher service started successfully.');
    } catch (error) {
        logger.fatal({ err: error }, 'Failed to start publisher service. Exiting.');
        process.exit(1);
    }

    wsConnector.on('connected', () => {
        logger.info('WebSocket Connector: Connected to mempool stream.');
        const providerInstance = wsConnector.getProviderInstance();
        if (providerInstance) {
            if (!txFetcher) {
                txFetcher = new TransactionFetcher(providerInstance);
            } else {
                // Update provider instance if it was reconnected
                txFetcher.updateProvider(providerInstance);
            }
            publisher.broadcast('Mempool WebSocket connected', 'status');
        } else {
            logger.error('WebSocket Connector: Provider instance is null after connection. Cannot initialize TransactionFetcher.');
            // This state should ideally not be reached if 'connected' is emitted correctly.
        }
    });

    wsConnector.on('disconnected', (type: string) => {
        logger.warn(`WebSocket Connector: Disconnected (${type}). Transaction fetching paused.`);
        // txFetcher's provider might be stale now, but it will be updated on 'connected'
        publisher.broadcast(`Mempool WebSocket disconnected (${type})`, 'status');
    });

    wsConnector.on('reconnectFailed', () => {
        logger.fatal('WebSocket Connector: Failed to reconnect after max attempts. Exiting.');
        // Gracefully shut down other services before exiting
        shutdown('reconnect_failed').catch(e => logger.error({err: e}, "Error during shutdown after reconnect failed."));
    });

    wsConnector.on('closed', () => {
        logger.info('WebSocket Connector: Connection explicitly closed.');
        publisher.broadcast('Mempool WebSocket connection closed by application', 'status');
    });

    wsConnector.on('txHash', async (txHash: string) => {
        if (!txFetcher) {
            logger.warn({ txHash }, "Received txHash but TransactionFetcher is not initialized. Skipping.");
            return;
        }
        if (!txHash || typeof txHash !== 'string') {
            logger.warn({ received: txHash }, "Received invalid txHash. Skipping.");
            return;
        }

        logger.trace({ txHash }, "Received pending transaction hash.");

        try {
            const fullTx = await txFetcher.fetchTransactionDetails(txHash);

            if (fullTx) {
                const filterableTx: FilterableTransaction = fullTx as FilterableTransaction;

                if (FilterService.isTransactionToKnownRouter(filterableTx)) {
                    logger.debug({ txHash: filterableTx.hash, to: filterableTx.to }, "Transaction to known router, attempting decode.");
                    const decodedData = txDecoder.decodeTransaction(fullTx);
                    filterableTx.decodedInput = decodedData || undefined; // Attach decoded data if successful

                    if (filterableTx.decodedInput) {
                         logger.info({
                            txHash: filterableTx.hash,
                            router: filterableTx.decodedInput.routerName,
                            function: filterableTx.decodedInput.functionName
                        }, "Decoded transaction to known router.");
                        publisher.broadcast(filterableTx, 'decoded_transaction');
                    } else {
                        // Still publish if it's to a known router but not decoded (e.g. direct transfers to router, or unhandled function)
                        logger.debug({ txHash: filterableTx.hash, to: filterableTx.to }, "Transaction to known router NOT decoded (unknown function), publishing raw.");
                        publisher.broadcast(filterableTx, 'transaction');
                    }
                } else {
                    // logger.trace({ txHash: filterableTx.hash, to: filterableTx.to }, "Transaction not to a known router. Skipping broadcast.");
                }
            } else {
                // logger.debug({ txHash }, "Transaction details not found after fetch attempt.");
            }
        } catch (error) {
            logger.error({ err: error, txHash }, "Error processing transaction hash from queue.");
        }
    });

    // Start the initial connection
    wsConnector.connect();

    // Graceful shutdown
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    signals.forEach(signal => {
        process.on(signal, async () => {
            logger.info(`Received ${signal}, shutting down gracefully...`);
            await shutdown(signal);
        });
    });
}

async function shutdown(signal?: string) {
    logger.info(`Initiating shutdown sequence (signal: ${signal || 'N/A'})...`);
    let exitCode = 0;
    try {
        wsConnector.close(); // Close WebSocket connector
        logger.info('WebSocket connector closed.');

        await publisher.stop(); // Stop publisher WebSocket server
        logger.info('Publisher service stopped.');

        // Add any other cleanup tasks here
        logger.info('Mempool Ingestion Service shut down successfully.');
    } catch (error) {
        logger.error({ err: error }, 'Error during graceful shutdown.');
        exitCode = 1;
    } finally {
        // Give logs a moment to flush
        setTimeout(() => process.exit(exitCode), 500);
    }
}


main().catch(error => {
    logger.fatal({ err: error }, "Unhandled error in main function. Exiting.");
    shutdown('main_catch').catch(e => logger.error({err: e}, "Error during shutdown after main catch."));
});

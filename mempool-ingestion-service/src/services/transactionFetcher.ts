import { ethers } from 'ethers';
import logger from '../utils/logger';
import config from '../utils/config';

export class TransactionFetcher {
    private provider: ethers.providers.WebSocketProvider; // Expecting a connected provider

    constructor(provider: ethers.providers.WebSocketProvider) {
        if (!provider) {
            throw new Error("TransactionFetcher requires a valid ethers Provider instance.");
        }
        this.provider = provider;
    }

    public async fetchTransactionDetails(txHash: string): Promise<ethers.providers.TransactionResponse | null> {
        if (!this.provider) {
            logger.error("Provider not initialized in TransactionFetcher.");
            return null;
        }
        try {
            // Add a timeout mechanism for the fetch operation
            const tx = await Promise.race([
                this.provider.getTransaction(txHash),
                new Promise<null>((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout fetching tx ${txHash}`)), config.fetchTxTimeoutMs)
                )
            ]);

            if (tx) {
                logger.debug({ txHash }, "Successfully fetched transaction details.");
                return tx as ethers.providers.TransactionResponse; // Cast needed if timeout promise isn't typed well
            } else {
                // This case might occur if the transaction was ephemeral (e.g., uncle-ed out quickly)
                // or if getTransaction returns null for a not-yet-mined tx that disappeared from node's mempool view
                logger.warn({ txHash }, "Transaction details not found or null response. It might have been mined or dropped.");
                return null;
            }
        } catch (error: any) {
            if (error.message.includes(`Timeout fetching tx ${txHash}`)) {
                logger.warn({ txHash, timeout: config.fetchTxTimeoutMs }, "Timeout fetching transaction details.");
            } else {
                logger.error({ err: error, txHash }, "Error fetching transaction details.");
            }
            return null;
        }
    }

    // Optional: Method to update provider if WebsocketConnector reconnects and gets a new instance
    public updateProvider(newProvider: ethers.providers.WebSocketProvider) {
        logger.info("TransactionFetcher received updated provider instance.");
        this.provider = newProvider;
    }
}

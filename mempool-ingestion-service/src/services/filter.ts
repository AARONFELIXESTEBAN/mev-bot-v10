import { ethers } from 'ethers';
import config from '../utils/config';
import logger from '../utils/logger';
import { DecodedTransactionInput } from './transactionDecoder'; // Optional: if filtering on decoded data

export interface FilterableTransaction extends ethers.providers.TransactionResponse {
    decodedInput?: DecodedTransactionInput & { routerName: string }; // Optional decoded data
}

export class FilterService {
    private knownRouterAddresses: Set<string>;

    constructor() {
        this.knownRouterAddresses = new Set(config.knownRouters.map(addr => addr.toLowerCase()));
        if (this.knownRouterAddresses.size === 0) {
            logger.warn("FilterService initialized with no known router addresses. All transactions to routers will be missed.");
        } else {
            logger.info({ knownRouters: Array.from(this.knownRouterAddresses) }, "FilterService initialized with known router addresses.");
        }
    }

    /**
     * Filters transactions based on whether they are sent to a known DEX router.
     * @param transaction The transaction object, potentially augmented with decoded data.
     * @returns True if the transaction should be processed further, false otherwise.
     */
    public static isTransactionToKnownRouter(transaction: FilterableTransaction): boolean {
        if (!transaction.to) {
            return false; // Not a contract interaction or direct ETH transfer without a specific 'to' for our interest
        }
        // Use the Set for efficient lookup
        const isKnown = config.knownRouters.includes(transaction.to.toLowerCase());
        if (isKnown) {
            logger.trace({ txHash: transaction.hash, to: transaction.to }, "Transaction to known router passed filter.");
        }
        return isKnown;
    }

    /**
     * Example of a more complex filter that might use decoded data.
     * This is just a placeholder for future expansion.
     * @param transaction The transaction object, MUST have `decodedInput` populated.
     * @returns True if the transaction passes the complex filter.
     */
    public static passesComplexFilter(transaction: FilterableTransaction): boolean {
        if (!transaction.decodedInput) {
            logger.warn({ txHash: transaction.hash }, "Complex filter called without decoded input.");
            return false;
        }

        // Example: Filter only for swaps involving WETH and a specific path length
        // if (transaction.decodedInput.functionName.toLowerCase().includes('swap')) {
        //     const path = transaction.decodedInput.path;
        //     const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".toLowerCase(); // Example WETH
        //     if (path && path.length === 2 && (path[0].toLowerCase() === wethAddress || path[1].toLowerCase() === wethAddress)) {
        //         logger.debug({ txHash: transaction.hash }, "Transaction passed complex WETH swap filter.");
        //         return true;
        //     }
        // }
        return true; // Default to pass if no specific complex logic for now
    }
}

// Export a default instance or static methods as preferred.
// For this simple filter, static methods are fine.
// If the FilterService needed state (e.g., dynamic filter rules), an instance would be better.
export const defaultFilterService = {
    isTransactionToKnownRouter: FilterService.isTransactionToKnownRouter,
    passesComplexFilter: FilterService.passesComplexFilter,
};

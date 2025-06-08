import { ethers, BigNumber } from 'ethers'; // ethers.BigNumber might not be needed if we use string for amounts here

// Interface for the result of decoding a transaction's input data
// Based on mempool-ingestion-service/src/services/transactionDecoder.ts
export interface DecodedTransactionInput {
    functionName: string;
    signature: string;
    args: ethers.utils.Result; // Raw arguments from ethers.utils.Interface.parseTransaction
    // Common parameters for swaps (populated by TransactionDecoder)
    path?: string[];
    amountOutMin?: ethers.BigNumber | string;
    amountIn?: ethers.BigNumber | string;
    amountOut?: ethers.BigNumber | string;
    amountInMax?: ethers.BigNumber | string;
    to?: string; // Recipient address in swap arguments
    deadline?: ethers.BigNumber | string;
    // Common parameters for liquidity (populated by TransactionDecoder)
    tokenA?: string;
    tokenB?: string;
    amountADesired?: ethers.BigNumber | string;
    amountBDesired?: ethers.BigNumber | string;
    amountAMin?: ethers.BigNumber | string;
    amountBMin?: ethers.BigNumber | string;
    liquidity?: ethers.BigNumber | string;
}

// Interface for a processed and decoded mempool transaction involving a swap
// Based on mev-bot-v10/src/arbitrage/pathFinder.ts and what Orchestrator expects
export interface DecodedMempoolSwap {
    // From ethers.providers.TransactionResponse (or a subset)
    hash: string;
    from: string;
    to: string; // Router address this transaction is interacting with
    value?: string; // ETH value sent with the transaction
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasLimit: string;
    blockNumber?: number; // If it got mined while processing

    // Added by mempool-ingestion-service processing steps
    ingestionTimestamp: number; // When mempool-ingestion first saw it
    processedTimestamp: number; // When mempool-ingestion finished processing it

    // From TransactionDecoder in mempool-ingestion-service
    decodedInput: DecodedTransactionInput & { routerName: string };
}


// Interface for the broadcast message from mempool-ingestion-service's PublisherService
// Based on mempool-ingestion-service/src/services/publisher.ts
export interface MempoolEventBroadcast {
    type: 'decoded_transaction' | 'transaction' | 'status' | 'error'; // 'transaction' for raw, 'decoded_transaction' for processed
    payload: DecodedMempoolSwap | ethers.providers.TransactionResponse | string | any; // Payload type depends on 'type'
    timestamp: number; // Timestamp of the broadcast
}

// Type guard to check if payload is DecodedMempoolSwap
export function isDecodedMempoolSwap(payload: any): payload is DecodedMempoolSwap {
    return payload && typeof payload === 'object' &&
           'hash' in payload &&
           'decodedInput' in payload &&
           typeof payload.decodedInput === 'object' &&
           'functionName' in payload.decodedInput;
}

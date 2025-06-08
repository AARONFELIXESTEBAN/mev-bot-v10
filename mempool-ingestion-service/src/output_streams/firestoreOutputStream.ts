// Placeholder for Firestore Output Stream
// Sends processed data to Firestore or another streaming output

import { Firestore } from '@google-cloud/firestore';
import { ProcessedTransaction } from '../processing/transformTransaction';

export class FirestoreOutputStream {
    private firestore: Firestore;
    private collectionName: string;

    constructor(collectionName: string = 'mempool_transactions') {
        this.firestore = new Firestore(); // Assumes ADC are set up
        this.collectionName = collectionName;
        console.log(`Firestore Output Stream initialized for collection: ${collectionName}`);
    }

    async write(transaction: ProcessedTransaction): Promise<void> {
        try {
            const docRef = this.firestore.collection(this.collectionName).doc(transaction.hash);
            await docRef.set(transaction);
            // console.log(`Transaction ${transaction.hash} written to Firestore.`);
        } catch (error) {
            console.error(`Error writing transaction ${transaction.hash} to Firestore:`, error);
            // Implement retry logic or dead-letter queue as needed
        }
    }

    // If a generic stream forwarder is needed instead:
    // constructor(private targetUrl?: string) {}
    // async forward(data: any) {
    //    if (this.targetUrl) { /* POST to targetUrl */ }
    //    else { console.log("Forwarding data:", data); }
    // }
}

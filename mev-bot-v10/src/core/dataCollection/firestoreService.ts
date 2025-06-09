import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import { ConfigService } from '../config/configService'; // Adjust path
import { getLogger } from '../logger/loggerService'; // Adjust path

const logger = getLogger();

export interface LoggableData {
    [key: string]: any; // Allow any fields
}

export class DataCollectionService {
    private firestore: Firestore;
    private mainCollection: string;
    private schemaVersion: string = "10.1"; // As per requirement

    constructor(private configService: ConfigService) {
        const firestoreProjectId = this.configService.get('firestore_config.project_id') || this.configService.get('gcp_project_id');
        this.mainCollection = this.configService.getOrThrow('firestore_config.main_collection_v10');

        if (!firestoreProjectId) {
            logger.warn("DataCollectionService: Firestore Project ID not explicitly set, relying on ADC default or GCE instance project.");
        }
        this.firestore = new Firestore(firestoreProjectId ? { projectId: firestoreProjectId } : {});

        logger.info(`DataCollectionService: Initialized. Project: ${firestoreProjectId || 'default'}, Main Collection: ${this.mainCollection}, Schema: ${this.schemaVersion}`);
    }

    public getMainCollectionName(): string {
        return this.mainCollection;
    }

    /**
     * Logs data to a specified sub-collection or the main collection if no sub-collection is given.
     * A document ID can be provided, or Firestore will auto-generate one.
     * @param data The data to log (must be a flat object for simple Firestore writes).
     * @param subCollectionName Optional: Name of the sub-collection under the main MEV Bot V10 collection.
     * @param documentId Optional: Custom ID for the document. If not provided, Firestore auto-generates one.
     * @returns The ID of the created document, or null on failure.
     */
    public async logData(
        data: LoggableData,
        subCollectionName?: string,
        documentId?: string
    ): Promise<string | null> {
        const collectionPath = subCollectionName ? `${this.mainCollection}/${subCollectionName}` : this.mainCollection;

        const dataToLog = {
            ...data,
            schemaVersion: this.schemaVersion,
            ingestionTimestamp: FieldValue.serverTimestamp(), // GCP server-side timestamp
            clientTimestamp: new Date(), // Client-side timestamp for reference
        };

        try {
            let docRef;
            if (documentId) {
                docRef = this.firestore.collection(collectionPath).doc(documentId);
                await docRef.set(dataToLog, { merge: true }); // Use set with merge to create or update
                logger.debug({ collectionPath, documentId, schema: this.schemaVersion }, "Data logged/updated in Firestore with specified ID.");
                return documentId;
            } else {
                docRef = await this.firestore.collection(collectionPath).add(dataToLog);
                logger.debug({ collectionPath, documentId: docRef.id, schema: this.schemaVersion }, "Data logged to Firestore with auto-generated ID.");
                return docRef.id;
            }
        } catch (error) {
            logger.error({ err: error, collectionPath, documentId, data }, "DataCollectionService: Error logging data to Firestore.");
            return null;
        }
    }

    /**
     * Retrieves a specific document from Firestore.
     * @param documentPath Full path to the document (e.g., "mainCollection/docId" or "mainCollection/subCollection/docId")
     * @returns The document data or null if not found or on error.
     */
    public async getDocument(documentPath: string): Promise<LoggableData | null> {
        try {
            const docRef = this.firestore.doc(documentPath);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                return docSnap.data() as LoggableData;
            } else {
                logger.warn(`DataCollectionService: Document not found at path: ${documentPath}`);
                return null;
            }
        } catch (error) {
            logger.error({ err: error, documentPath }, "DataCollectionService: Error fetching document from Firestore.");
            return null;
        }
    }

    /**
     * Queries a collection in Firestore.
     * @param collectionPath Path to the collection to query.
     * @param queryFn A function that takes a Firestore CollectionReference and returns a Query.
     *                Example: `ref => ref.where('field', '==', 'value').orderBy('timestamp', 'desc').limit(10)`
     * @returns An array of document data matching the query, or an empty array on error/no results.
     */
    public async queryCollection(
        collectionPath: string,
        queryFn: (ref: FirebaseFirestore.CollectionReference) => FirebaseFirestore.Query
    ): Promise<LoggableData[]> {
        try {
            const collectionRef = this.firestore.collection(collectionPath);
            const firestoreQuery = queryFn(collectionRef);
            const snapshot = await firestoreQuery.get();

            if (snapshot.empty) {
                return [];
            }
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LoggableData));
        } catch (error) {
            logger.error({ err: error, collectionPath }, `DataCollectionService: Error querying collection ${collectionPath}.`);
            return [];
        }
    }
}

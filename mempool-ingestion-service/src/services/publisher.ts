import WebSocket, { WebSocketServer } from 'ws';
import logger from '../utils/logger';
import config from '../utils/config';

// Define a type for the messages we expect to broadcast
// This can be expanded based on the actual data structure from the decoder
export interface BroadcastMessage {
    type: 'transaction' | 'decoded_transaction' | 'error' | 'status';
    payload: any;
    timestamp: number;
}

export class PublisherService {
    private wss: WebSocketServer | null = null;
    private port: number;
    private clients: Set<WebSocket> = new Set();

    constructor(port: number = config.publisherPort) {
        this.port = port;
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.wss) {
                logger.warn('PublisherService already started.');
                return resolve();
            }

            this.wss = new WebSocketServer({ port: this.port });

            this.wss.on('listening', () => {
                logger.info(`PublisherService WebSocket server started and listening on port ${this.port}`);
                resolve();
            });

            this.wss.on('connection', (ws: WebSocket) => {
                logger.info('PublisherService: A client connected.');
                this.clients.add(ws);

                ws.on('message', (message: Buffer | string) => {
                    // For this service, we are primarily broadcasting, not expecting many client messages.
                    // But good to handle them, e.g., for pings or subscription preferences.
                    try {
                        const parsedMessage = JSON.parse(message.toString());
                        logger.debug({ clientMessage: parsedMessage }, 'PublisherService received message from client.');
                        // Handle client messages if needed (e.g., client pings, subscriptions)
                        if (parsedMessage.type === 'ping') {
                            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                        }
                    } catch (e) {
                        logger.warn({ rawMessage: message.toString() }, 'PublisherService received non-JSON message or parse error.');
                    }
                });

                ws.on('close', (code, reason) => {
                    logger.info(`PublisherService: Client disconnected. Code: ${code}, Reason: ${reason ? reason.toString() : 'N/A'}`);
                    this.clients.delete(ws);
                });

                ws.on('error', (error: Error) => {
                    logger.error({ err: error }, 'PublisherService: Error on client WebSocket connection.');
                    this.clients.delete(ws); // Remove on error as well
                    // ws.terminate(); // Ensure connection is fully closed on error
                });

                // Send a welcome message or initial status
                ws.send(JSON.stringify({
                    type: 'status',
                    payload: 'Connected to Mempool Ingestion Publisher',
                    timestamp: Date.now()
                }));
            });

            this.wss.on('error', (error: Error) => {
                logger.error({ err: error }, `PublisherService WebSocket server error on port ${this.port}.`);
                this.wss = null; // Ensure it's nullified so start can be attempted again if applicable
                reject(error);
            });
        });
    }

    public broadcast(data: any, messageType: BroadcastMessage['type'] = 'decoded_transaction'): void {
        if (!this.wss) {
            logger.warn('PublisherService not started, cannot broadcast.');
            return;
        }

        const message: BroadcastMessage = {
            type: messageType,
            payload: data,
            timestamp: Date.now(),
        };
        const messageString = JSON.stringify(message);

        if (this.clients.size === 0) {
            // logger.trace('PublisherService: No clients connected, not broadcasting.');
            return;
        }

        logger.debug({ numClients: this.clients.size, type: messageType }, `Broadcasting message to ${this.clients.size} clients.`);

        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(messageString);
                } catch (error) {
                    logger.error({ err: error }, 'PublisherService: Error sending message to a client.');
                    // Consider removing client if send fails repeatedly
                }
            }
        });
    }

    public stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.wss) {
                logger.info('Stopping PublisherService WebSocket server...');
                // Gracefully close all client connections
                this.clients.forEach(client => {
                    client.close(1000, 'Server shutting down');
                });
                this.clients.clear();

                this.wss.close((err) => {
                    if (err) {
                        logger.error({ err }, 'Error closing PublisherService WebSocket server.');
                    } else {
                        logger.info('PublisherService WebSocket server stopped.');
                    }
                    this.wss = null;
                    resolve();
                });
            } else {
                logger.info('PublisherService already stopped or not started.');
                resolve();
            }
        });
    }

    public getClientCount(): number {
        return this.clients.size;
    }
}

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import config from '../utils/config';
import logger from '../utils/logger';

export class WebsocketConnector extends EventEmitter {
    private provider: ethers.providers.WebSocketProvider | null = null;
    private connectionUrl: string;
    private reconnectAttempts: number = 0;
    private isAttemptingConnection: boolean = false;
    private explicitlyClosed: boolean = false;
    private connectionTimer: NodeJS.Timeout | null = null;

    constructor(connectionUrl: string = config.gcpNbeWssUrl) {
        super();
        this.connectionUrl = connectionUrl;
        // Increase max listeners if many parts of the app listen to this emitter
        this.setMaxListeners(20);
    }

    public connect(): void {
        if (this.provider?.websocket?.readyState === WebSocket.OPEN && this.provider._wsReady) {
            logger.info('WebSocket connection already open and provider ready.');
            return;
        }
        if (this.isAttemptingConnection) {
            logger.warn('WebSocket connection attempt already in progress.');
            return;
        }
        this.explicitlyClosed = false;
        this.isAttemptingConnection = true;
        logger.info(`Attempting to connect to WebSocket: ${this.connectionUrl} (Attempt ${this.reconnectAttempts + 1})`);

        // Clear any existing connection timer
        if (this.connectionTimer) {
            clearTimeout(this.connectionTimer);
            this.connectionTimer = null;
        }

        try {
            this.provider = new ethers.providers.WebSocketProvider(this.connectionUrl);

            this.provider.on('pending', (txHash: string) => {
                if (txHash) { // Ensure txHash is not null or undefined
                    this.emit('txHash', txHash);
                } else {
                    logger.warn('Received null or undefined txHash from pending event.');
                }
            });

            // Monitor the 'open' event of the underlying websocket
            // The _websocket property is not part of the official API but commonly used for more control
            const underlyingWebsocket = (this.provider as any)._websocket;
            if (underlyingWebsocket) {
                underlyingWebsocket.onopen = () => {
                    logger.info('WebSocket connection successfully opened via onopen event.');
                    this.reconnectAttempts = 0; // Reset on successful connection
                    this.isAttemptingConnection = false;
                    if (this.connectionTimer) clearTimeout(this.connectionTimer);
                    this.emit('connected');
                };

                underlyingWebsocket.onclose = (event: CloseEvent) => {
                    logger.warn({ code: event.code, reason: event.reason }, 'WebSocket connection closed via onclose event.');
                    if (this.connectionTimer) clearTimeout(this.connectionTimer);
                    this.handleDisconnection('close');
                };

                underlyingWebsocket.onerror = (errorEvent: Event) => { // Changed 'error: Error' to 'errorEvent: Event'
                    // The error object from websocket.onerror is typically a generic Event, not an Error instance.
                    // For more detailed error, it's often logged by the library or leads to a close event.
                    logger.error({ error: errorEvent.type }, 'WebSocket connection error via onerror event.');
                    // This might trigger onclose as well.
                };
            } else {
                 logger.warn('Could not attach to underlying WebSocket events directly on this version of ethers.');
                 // Fallback to provider.ready for connection confirmation if underlying websocket isn't exposed as expected
                 this.provider.ready.then(() => {
                    logger.info('WebSocketProvider is ready (confirmed via provider.ready).');
                    if (this.isAttemptingConnection) { // Check if this was the attempt that succeeded
                        this.reconnectAttempts = 0;
                        this.isAttemptingConnection = false;
                        if (this.connectionTimer) clearTimeout(this.connectionTimer);
                        this.emit('connected');
                    }
                }).catch(error => {
                    logger.error({ err: error }, 'WebSocketProvider failed to become ready.');
                    if (this.connectionTimer) clearTimeout(this.connectionTimer);
                    this.handleDisconnection('ready_error');
                });
            }

            // Set a timer to ensure connection doesn't hang indefinitely
            this.connectionTimer = setTimeout(() => {
                if (this.isAttemptingConnection && (!this.provider || !this.provider._wsReady) ) {
                    logger.warn('WebSocket connection attempt timed out.');
                    this.handleDisconnection('timeout');
                }
            }, 30000); // 30 seconds timeout for connection attempt


        } catch (error) {
            logger.error({ err: error }, `Error instantiating WebSocketProvider for ${this.connectionUrl}`);
            this.isAttemptingConnection = false;
            if (this.connectionTimer) clearTimeout(this.connectionTimer);
            this.handleDisconnection('instantiation_error');
        }
    }

    private handleDisconnection(type: string): void {
        this.isAttemptingConnection = false;

        if (this.provider) {
            this.provider.removeAllListeners('pending');
            // Attempt to close the websocket connection if it exists
            const ws = (this.provider as any)._websocket;
            if (ws && typeof ws.close === 'function') {
                try {
                    ws.close();
                } catch (e) {
                    logger.warn({err: e}, "Error trying to close underlying websocket during handleDisconnection.");
                }
            }
            // Ethers v5 WebSocketProvider doesn't have a public destroy method.
            // Setting to null helps GC and signals it's no longer usable.
            this.provider = null;
        }


        if (this.explicitlyClosed) {
            logger.info('WebSocket connection was explicitly closed. Will not reconnect.');
            return;
        }

        this.emit('disconnected', type);

        if (this.reconnectAttempts < config.maxReconnectAttempts) {
            this.reconnectAttempts++;
            // Exponential backoff with a cap
            const delay = Math.min(config.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts -1), 30000);
            logger.info(`Attempting to reconnect in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${config.maxReconnectAttempts})...`);
            setTimeout(() => this.connect(), delay);
        } else {
            logger.error(`Max reconnect attempts (${config.maxReconnectAttempts}) reached for ${this.connectionUrl}. Giving up.`);
            this.emit('reconnectFailed');
        }
    }

    public getProviderInstance(): ethers.providers.WebSocketProvider | null {
        return this.provider;
    }

    public close(): void {
        logger.info('Explicitly closing WebSocket connection.');
        this.explicitlyClosed = true;
        if (this.connectionTimer) {
            clearTimeout(this.connectionTimer);
            this.connectionTimer = null;
        }
        if (this.provider) {
            const ws = (this.provider as any)._websocket;
            if (ws && typeof ws.close === 'function') {
                 ws.close(1000, 'Explicitly closed by application'); // 1000 is normal closure
            }
            this.provider.removeAllListeners('pending');
            this.provider = null; // Help GC
        }
        this.isAttemptingConnection = false;
        this.emit('closed');
    }
}

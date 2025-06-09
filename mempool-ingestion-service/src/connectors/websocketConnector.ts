import { ethers } from 'ethers';
import { EventEmitter } from 'node:events';
import config from '../utils/config';
import logger from '../utils/logger';

class WebsocketConnector extends EventEmitter {
    private provider: ethers.providers.WebSocketProvider | null = null;
    private url: string;
    private reconnectAttempts = 0;
    private explicitlyClosed = false;

    constructor() {
        super();
        this.url = config.websocketUrl;
        logger.info(`WebsocketConnector initialized with URL: ${this.url}`);
    }

    public connect(): void {
        if (this.provider) {
            logger.warn('Connection attempt while provider already exists. Closing existing one.');
            this.provider.removeAllListeners();
            // Attempt to close, but ignore errors as we are reconnecting anyway
            try {
                this.provider.websocket.close();
            } catch (error) {
                logger.warn('Error closing existing WebSocket during reconnect attempt:', error);
            }
            this.provider = null;
        }

        this.explicitlyClosed = false; // Reset explicit close flag on new connection attempt
        logger.info(`Connecting to WebSocket: ${this.url}`);

        try {
            this.provider = new ethers.providers.WebSocketProvider(this.url);
        } catch (error) {
            logger.error('Failed to create WebSocketProvider instance:', error);
            this.handleReconnect();
            return;
        }

        this.provider.on('open', () => {
            logger.info('WebSocket connection established.');
            this.emit('connected');
            this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        });

        this.provider.on('pending', (txHash: string) => {
            // logger.debug(`Received pending transaction hash: ${txHash}`);
            this.emit('txHash', txHash);
        });

        // Handle internal errors from the WebSocket connection itself
        // Using 'as any' to bypass strict type checking for WebSocketLike temporarily for diagnostics
        (this.provider.websocket as any).onerror = (event: Event) => {
            logger.error({ err: (event as any).error || event }, 'WebSocket internal error:');
            this.emit('error', (event as any).error || event);
        };

        // Handle errors from the ethers.js WebSocketProvider itself
        this.provider.on('error', (error: any) => {
            logger.error('WebSocketProvider (ethers) error:', error);
            this.emit('error', error);
        });

        // Handle the close event from the WebSocket connection
        (this.provider.websocket as any).onclose = (event: CloseEvent) => {
            logger.info(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}, Clean: ${event.wasClean}`);
            this.emit('disconnected', event.code, event.reason);
            if (!this.explicitlyClosed) {
                this.handleReconnect();
            } else {
                logger.info('Connection closed explicitly. Not attempting to reconnect.');
                this.emit('closed');
            }
        };
    }

    private handleReconnect(): void {
        if (this.explicitlyClosed) {
            logger.info("Reconnection skipped as connection was closed explicitly.");
            return;
        }

        if (this.reconnectAttempts >= config.maxReconnectAttempts) {
            logger.error(`Max reconnect attempts (${config.maxReconnectAttempts}) reached. Emitting reconnectFailed.`);
            this.emit('reconnectFailed');
            return;
        }

        this.reconnectAttempts++;
        // Exponential backoff with jitter
        const baseDelay = config.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts -1);
        const jitter = Math.random() * baseDelay * 0.3; // Add up to 30% jitter
        const delay = Math.min(baseDelay + jitter, 60000); // Cap delay at 60 seconds

        logger.info(`Attempting to reconnect (attempt ${this.reconnectAttempts}/${config.maxReconnectAttempts}) in ${delay.toFixed(0)}ms...`);

        setTimeout(() => {
            this.connect();
        }, delay);
    }

    public getProviderInstance(): ethers.providers.WebSocketProvider | null {
        return this.provider;
    }

    public close(): void {
        logger.info('Explicitly closing WebSocket connection.');
        this.explicitlyClosed = true;
        if (this.provider) {
            try {
                this.provider.websocket.close(1000, 'Closed by client'); // 1000 is a normal closure
                this.provider.removeAllListeners(); // Clean up listeners
            } catch (error) {
                logger.error('Error while closing WebSocket:', error);
            } finally {
                this.provider = null;
            }
        } else {
            logger.warn('Close called but no active provider to close.');
        }
        // Emit 'closed' here if you want immediate notification,
        // or rely on the onclose handler to emit it.
        // For clarity, emitting it from onclose handler when explicitlyClosed is true.
    }

    // on and emit methods are inherited from EventEmitter
}

export default WebsocketConnector;

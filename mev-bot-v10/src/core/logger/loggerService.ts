import pino from 'pino';
// Define and export the PinoLogger type alias
export type PinoLogger = pino.Logger;

// Create a default logger instance immediately for fallback or direct use if appropriate
const defaultLogger: PinoLogger = pino({ level: process.env.LOG_LEVEL || 'info' });

let loggerInstance: PinoLogger = defaultLogger;

// Config interface subset, assuming AppConfig might be complex or defined elsewhere
interface LoggerConfig {
    logLevel?: string;
    nodeEnv?: string;
}

export function initializeLogger(config?: LoggerConfig): PinoLogger {
    const effectiveConfig = {
        logLevel: config?.logLevel || process.env.LOG_LEVEL || 'info',
        nodeEnv: config?.nodeEnv || process.env.NODE_ENV || 'development'
    };

    const loggerOptions: pino.LoggerOptions = {
        level: effectiveConfig.logLevel,
        formatters: {
            level: (label) => {
                return { level: label };
            },
        },
    };

    if (effectiveConfig.nodeEnv === 'development') {
        loggerOptions.transport = {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        };
    }

    loggerInstance = pino(loggerOptions);
    loggerInstance.info(`Logger initialized. Level: ${effectiveConfig.logLevel}, Environment: ${effectiveConfig.nodeEnv}`);
    return loggerInstance;
}

export function getLogger(): PinoLogger {
    if (!loggerInstance) { // Should ideally be initialized by the time it's first called
        console.warn("Logger accessed before explicit initialization. Using default or last instance.");
        // defaultLogger was already created, so loggerInstance would have its value
        // If initializeLogger was never called, loggerInstance would be the initial defaultLogger.
    }
    return loggerInstance;
}

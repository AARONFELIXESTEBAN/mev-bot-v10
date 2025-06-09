import pino from 'pino';
import { AppConfig } from '../config/configService'; // Assuming AppConfig is exported or use a shared type

// This service can be a simple export of a configured logger instance,
// or a class if more complex logger management is needed.
// For MVP, a pre-configured instance is often sufficient.

// Define and export the PinoLogger type alias
export type PinoLogger = pino.Logger;

let loggerInstance: PinoLogger; // Use the exported type

export function initializeLogger(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>): PinoLogger { // Use the exported type
    const loggerOptions: pino.LoggerOptions = {
        level: config.logLevel || 'info',
        formatters: {
            level: (label) => {
                return { level: label }; // Standardize level key
            },
            // Potentially add a bindings formatter to include app name, version, etc.
            // bindings: (bindings) => {
            //   return { pid: bindings.pid, hostname: bindings.hostname, app: 'mev-bot-v10' };
            // },
        },
        // Redact sensitive paths in logs if necessary
        // redact: ['req.headers.authorization', 'data.sensitiveField'],
    };

    if (config.nodeEnv === 'development') {
        loggerOptions.transport = {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard', // More readable time format
                ignore: 'pid,hostname', // Less noise in dev
                // customPrettifiers: { time: timestamp => `🕰 ${timestamp}` } // Example
            },
        };
    } else {
        // Production logging: JSON format to stdout (default behavior of Pino)
        // Ensure your cloud logging solution can parse these JSON logs.
        // No specific transport needed for standard JSON output.
    }

    loggerInstance = pino(loggerOptions);
    loggerInstance.info(`Logger initialized. Level: ${config.logLevel}, Environment: ${config.nodeEnv}`);
    return loggerInstance;
}

/**
 * Returns the global logger instance.
 * Ensure initializeLogger has been called once at application startup.
 */
export function getLogger(): PinoLogger { // Use the exported type
    if (!loggerInstance) {
        // Fallback to a default logger if not initialized, but warn.
        // This is not ideal; initialization should be guaranteed.
        console.warn("Logger accessed before initialization. Using default Pino instance with 'info' level.");
        loggerInstance = pino({ level: 'info' }); // This will be pino.Logger, assignable to PinoLogger
    }
    return loggerInstance;
}

// Example of direct export if initialization is handled elsewhere or simpler config is used:
// import globalConfig from './configService'; // if configService exports a default instance
//
// const dev = globalConfig.get('nodeEnv') === 'development';
// const logger = pino({
//   level: globalConfig.get('logLevel') || 'info',
//   transport: dev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
// });
// export default logger;
```

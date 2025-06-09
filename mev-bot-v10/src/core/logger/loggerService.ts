import pino from 'pino';
import { AppConfig } from '@core/config/configService';

export type PinoLogger = pino.Logger;

let loggerInstance: PinoLogger;

export function initializeLogger(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>): PinoLogger {
    const loggerOptions: pino.LoggerOptions = {
        level: config.logLevel || 'info',
        formatters: {
            level: (label) => {
                return { level: label };
            },
        },
    };

    if (config.nodeEnv === 'development') {
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
    loggerInstance.info(`Logger initialized. Level: ${config.logLevel}, Environment: ${config.nodeEnv}`);
    return loggerInstance;
}

export function getLogger(name?: string): PinoLogger {
    if (!loggerInstance) {
        console.warn("Logger accessed before initialization. Using default Pino instance with 'info' level.");
        loggerInstance = pino({ level: 'info', name });
    }
    return name ? loggerInstance.child({ name }) : loggerInstance;
}
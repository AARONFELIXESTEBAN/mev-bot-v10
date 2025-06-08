import { MevBotV10Orchestrator } from './core/MevBotV10Orchestrator';
import { getLogger, initializeLogger } from './core/logger/loggerService'; // Assuming logger can be initialized early
import { ConfigService } from './core/config/configService'; // To get initial config for logger

// Early initialization of ConfigService to get log level
// This is a bit of a chicken-and-egg, but logger needs some config.
// Alternatively, logger could have a static default config until ConfigService is fully ready.
let tempConfigServiceForLogger = new ConfigService();
const logger = initializeLogger({
    logLevel: tempConfigServiceForLogger.get('logLevel') || 'info',
    nodeEnv: tempConfigServiceForLogger.get('nodeEnv') || 'development'
});

async function bootstrap() {
    logger.info("============================================================");
    logger.info("== Starting MEV Bot V10 Orchestrator Service ==");
    logger.info("============================================================");

    let orchestrator: MevBotV10Orchestrator | null = null;

    try {
        orchestrator = new MevBotV10Orchestrator();
        await orchestrator.start();
        logger.info("MEV Bot V10 Orchestrator started successfully and is running.");
    } catch (error) {
        logger.fatal({ err: error }, "Failed to bootstrap MEV Bot V10 Orchestrator.");
        process.exit(1); // Exit if critical setup fails
    }

    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    signals.forEach(signal => {
        process.on(signal, async () => {
            logger.warn(`Received ${signal}, initiating graceful shutdown...`);
            if (orchestrator) {
                try {
                    await orchestrator.stop();
                    logger.info("Orchestrator stopped gracefully.");
                    process.exit(0);
                } catch (error) {
                    logger.error({ err: error }, "Error during graceful shutdown.");
                    process.exit(1);
                }
            } else {
                process.exit(0);
            }
        });
    });

    // Handle unhandled promise rejections and uncaught exceptions
    process.on('unhandledRejection', (reason, promise) => {
        logger.fatal({ err: reason, promise }, 'Unhandled Rejection at Promise. Forcing shutdown.');
        // Perform a quick shutdown, then exit.
        // This is critical because the application is in an undefined state.
        if (orchestrator) {
            orchestrator.stop().finally(() => process.exit(1));
        } else {
            process.exit(1);
        }
    });

    process.on('uncaughtException', (error) => {
        logger.fatal({ err: error }, 'Uncaught Exception. Forcing shutdown.');
        // Perform a quick shutdown, then exit.
        if (orchestrator) {
            orchestrator.stop().finally(() => process.exit(1));
        } else {
            process.exit(1);
        }
    });

}

bootstrap();

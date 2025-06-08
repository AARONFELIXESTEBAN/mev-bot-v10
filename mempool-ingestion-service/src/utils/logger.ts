import pino from 'pino';
import config from './config'; // Adjust path if necessary, assuming it's in the same directory

const loggerOptions: pino.LoggerOptions = {
  level: config.logLevel,
};

// Use pino-pretty only in development for better readability
if (config.nodeEnv === 'development') {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname', // Ignore these fields for brevity in dev
    },
  };
} else {
  // In production, use structured JSON logging (default for Pino)
  // You might want to add serializers here for error objects, etc.
  loggerOptions.formatters = {
    level: (label) => {
      return { level: label }; // Standardize level key
    },
  };
  // Add any production-specific settings, e.g., redaction paths
}

const logger = pino(loggerOptions);

export default logger;

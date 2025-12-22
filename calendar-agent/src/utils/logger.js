/**
 * Logger Utility
 * Provides structured logging with timestamps and log levels.
 * 
 * TODO: Replace with Winston or Pino for production
 * TODO: Add log rotation and file output
 * TODO: Add structured logging (JSON format) for log aggregation
 * TODO: Add correlation IDs for request tracing
 */

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

// TODO: Make this configurable via environment
const currentLevel = process.env.LOG_LEVEL
    ? LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()]
    : LOG_LEVELS.DEBUG;

/**
 * Format timestamp for log output
 * @returns {string} ISO timestamp
 */
function getTimestamp() {
    return new Date().toISOString();
}

/**
 * Format log message with timestamp and level
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} [meta] - Additional metadata
 * @returns {string} Formatted log string
 */
function formatMessage(level, message, meta = null) {
    const timestamp = getTimestamp();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [CALENDAR-AGENT] [${level}] ${message}${metaStr}`;
}

const logger = {
    debug: (message, meta) => {
        if (currentLevel <= LOG_LEVELS.DEBUG) {
            console.log(formatMessage('DEBUG', message, meta));
        }
    },

    info: (message, meta) => {
        if (currentLevel <= LOG_LEVELS.INFO) {
            console.log(formatMessage('INFO', message, meta));
        }
    },

    warn: (message, meta) => {
        if (currentLevel <= LOG_LEVELS.WARN) {
            console.warn(formatMessage('WARN', message, meta));
        }
    },

    error: (message, meta) => {
        if (currentLevel <= LOG_LEVELS.ERROR) {
            console.error(formatMessage('ERROR', message, meta));
        }
    },

    // Log error with stack trace
    logError: (message, error) => {
        console.error(formatMessage('ERROR', message, {
            name: error.name,
            message: error.message,
            stack: error.stack
        }));
    }
};

module.exports = logger;

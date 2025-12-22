/**
 * Error Handler Middleware
 * Provides consistent error responses and logging.
 * 
 * TODO: Add error categorization (client vs server errors)
 * TODO: Add error reporting to external service (Sentry, etc.)
 * TODO: Add request ID for error correlation
 * TODO: Implement different error formats for different content types
 */

const logger = require('../utils/logger');

/**
 * Custom application error class
 * Use this for operational errors that should be exposed to clients
 */
class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.timestamp = new Date().toISOString();

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Express error handling middleware
 * Must be registered after all routes
 */
function errorHandler(err, req, res, next) {
    // Default to 500 if status code not set
    const statusCode = err.statusCode || 500;
    const isOperational = err.isOperational || false;

    // Log the error
    logger.logError(`Request failed: ${req.method} ${req.originalUrl}`, err);

    // TODO: In production, don't expose stack traces for non-operational errors
    const errorResponse = {
        success: false,
        error: {
            message: isOperational ? err.message : 'Internal server error',
            // TODO: Remove stack trace in production
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            timestamp: new Date().toISOString()
        }
    };

    // TODO: Add request ID to response for debugging
    // errorResponse.error.requestId = req.id;

    res.status(statusCode).json(errorResponse);
}

/**
 * Handle 404 - Not Found
 */
function notFoundHandler(req, res, next) {
    const error = new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404);
    next(error);
}

/**
 * Wrap async route handlers to catch errors
 * TODO: Consider using express-async-errors package instead
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    AppError,
    errorHandler,
    notFoundHandler,
    asyncHandler
};

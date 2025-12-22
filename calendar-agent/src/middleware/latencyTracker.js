/**
 * Latency Tracker Middleware
 * Logs request processing time for performance monitoring.
 * 
 * TODO: Add percentile tracking (p50, p95, p99)
 * TODO: Export metrics to monitoring service (Prometheus, etc.)
 * TODO: Add slow request alerting
 */

const logger = require('../utils/logger');

/**
 * Express middleware to track request latency
 * Logs timing information on response completion
 */
function latencyTracker(req, res, next) {
    const startTime = Date.now();
    const startHrTime = process.hrtime();

    // Store start time on request for use in handlers
    req.startTime = startTime;

    // Track response completion
    res.on('finish', () => {
        const [seconds, nanoseconds] = process.hrtime(startHrTime);
        const durationMs = Math.round((seconds * 1000) + (nanoseconds / 1000000));

        logger.info(`${req.method} ${req.originalUrl}`, {
            status: res.statusCode,
            durationMs,
            contentLength: res.get('Content-Length') || 0
        });
    });

    next();
}

module.exports = latencyTracker;

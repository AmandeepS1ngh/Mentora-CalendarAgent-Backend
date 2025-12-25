/**
 * Calendar Agent - Express Application Entry Point
 * Calendar and Task Management Agent (Agent 3.1) for Mentora
 * 
 * Features:
 * - Google OAuth 2.0 integration
 * - Study task management with timezone support
 * - Google Calendar and Tasks sync
 * - AI-powered daily/weekly summaries via Groq
 * 
 * Architecture:
 * - Routes: HTTP handling only
 * - Services: Business logic
 * - DB Helpers: Database operations
 * - Middleware: Cross-cutting concerns
 * 
 * TODO: Add graceful shutdown handling
 * TODO: Add health check with dependency validation
 * TODO: Implement request ID middleware for tracing
 * TODO: Add API rate limiting
 * TODO: Add request body size limits
 * TODO: Implement async job queue for sync operations
 * TODO: Add webhook endpoints for Google Calendar push notifications
 */

const express = require('express');
const cors = require('cors');

const config = require('./config');
const logger = require('./utils/logger');
const latencyTracker = require('./middleware/latencyTracker');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Import routes
const calendarRouter = require('./routes/calendar');
const studyPlanRouter = require('./routes/studyPlan');

// Initialize Express app
const app = express();

// =============================================================================
// Middleware Stack
// =============================================================================

// Enable CORS - More flexible configuration
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : [
        'https://mentora-agentic-ai-frontend.vercel.app',
        'http://localhost:3000',
        'http://localhost:3001'
    ];

/**
 * Check if an origin is allowed for CORS
 * @param {string} origin - The origin to check
 * @returns {boolean} - Whether the origin is allowed
 */
const isOriginAllowed = (origin) => {
    // No origin means same-origin or non-browser request
    if (!origin) return true;

    // Check explicit allowed origins
    if (allowedOrigins.includes(origin)) return true;
    if (allowedOrigins.includes('*')) return true;

    // Allow ALL Vercel deployments (production, preview, and branch deploys)
    // This covers patterns like:
    // - mentora-agentic-ai-frontend.vercel.app (production)
    // - mentora-agentic-ai-frontend-*.vercel.app (preview)
    // - mentora-agentic-ai-frontend-git-*.vercel.app (branch)
    if (origin.endsWith('.vercel.app')) {
        // Extract subdomain and check if it starts with our project name
        try {
            const url = new URL(origin);
            const subdomain = url.hostname.replace('.vercel.app', '');
            if (subdomain.startsWith('mentora-agentic-ai-frontend') ||
                subdomain.includes('mentora')) {
                logger.info(`CORS: Allowed Vercel deployment origin: ${origin}`);
                return true;
            }
        } catch (e) {
            // Invalid URL, continue to check other patterns
        }
    }

    // Allow localhost with any port for development
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return true;
    }

    return false;
};

// CORS configuration with robust origin handling
const corsOptions = {
    origin: function (origin, callback) {
        try {
            if (isOriginAllowed(origin)) {
                callback(null, true);
            } else {
                logger.warn(`CORS: Blocked origin`, {
                    origin,
                    allowedOrigins,
                    nodeEnv: config.nodeEnv
                });
                // Return false instead of an error to avoid crashing preflight requests
                // This allows the browser to receive proper CORS headers but denies access
                callback(null, false);
            }
        } catch (error) {
            logger.error(`CORS: Error checking origin`, { origin, error: error.message });
            // On error, deny access but don't crash
            callback(null, false);
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'X-User-Id',
        'Origin',
        'Cache-Control'
    ],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    credentials: true,
    maxAge: 86400, // Cache preflight response for 24 hours
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests explicitly for all routes
app.options('*', cors(corsOptions));

// Parse JSON bodies
// TODO: Add request body size limit for production
app.use(express.json({
    limit: '1mb'
}));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Latency tracking for all requests
app.use(latencyTracker);

// =============================================================================
// Routes
// =============================================================================

// Root endpoint - API information
app.get('/', (req, res) => {
    res.json({
        name: 'Mentora Calendar Agent API',
        version: '1.0.0',
        description: 'Calendar and Task Management Agent (Agent 3.1)',
        endpoints: {
            oauth: {
                connect: 'POST /calendar/connect-google',
                callback: 'POST /calendar/oauth/callback'
            },
            tasks: {
                create: 'POST /calendar/tasks',
                today: 'GET /calendar/tasks/today',
                week: 'GET /calendar/tasks/week',
                updateStatus: 'PATCH /calendar/tasks/:taskId/status'
            },
            sync: {
                syncAll: 'POST /calendar/sync'
            },
            summaries: {
                daily: 'POST /calendar/summary/daily',
                weekly: 'POST /calendar/summary/weekly'
            },
            studyPlans: {
                generate: 'POST /study-plan/generate',
                apply: 'POST /study-plan/apply',
                getById: 'GET /study-plan/:id',
                getUserPlans: 'GET /study-plan/user/plans'
            }
        },
        authentication: {
            header: 'X-User-Id',
            format: 'UUID',
            description: 'User ID passed in header for all authenticated endpoints'
        },
        status: 'running'
    });
});

// Health check endpoint with dependency validation
app.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        service: 'calendar-agent',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.nodeEnv,
        dependencies: {
            supabase: !!config.supabase.url,
            groq: !!config.groq.apiKey,
            google: !!config.google.clientId && !!config.google.clientSecret
        }
    };

    // Check if any critical dependency is missing
    const allDepsOk = Object.values(health.dependencies).every(v => v);
    if (!allDepsOk) {
        health.status = 'degraded';
    }

    res.status(allDepsOk ? 200 : 503).json(health);
});

// Mount Calendar routes
app.use('/calendar', calendarRouter);

// Mount Study Plan routes
app.use('/study-plan', studyPlanRouter);

// =============================================================================
// Error Handling
// =============================================================================

// 404 handler - must be after all routes
app.use(notFoundHandler);

// Global error handler - must be last
app.use(errorHandler);

// =============================================================================
// Server Startup
// =============================================================================

const PORT = config.port;

// Store server reference for graceful shutdown
let server;

server = app.listen(PORT, () => {
    logger.info(`🚀 Calendar Agent server started`, {
        port: PORT,
        environment: config.nodeEnv,
        timestamp: new Date().toISOString()
    });

    logger.info('Available endpoints:', {
        root: `http://localhost:${PORT}/`,
        health: `http://localhost:${PORT}/health`,
        calendar: `http://localhost:${PORT}/calendar`
    });

    // Log configuration status (without sensitive info)
    logger.info('Configuration loaded:', {
        hasSupabaseUrl: !!config.supabase.url,
        hasGroqApiKey: !!config.groq.apiKey,
        hasGoogleClientId: !!config.google.clientId,
        hasGoogleClientSecret: !!config.google.clientSecret,
        defaultTimezone: config.timezone.default,
        corsOrigins: Array.isArray(allowedOrigins) ? allowedOrigins.join(', ') : allowedOrigins
    });
});

// =============================================================================
// Graceful Shutdown
// =============================================================================

const gracefulShutdown = (signal) => {
    logger.info(`${signal} received, shutting down gracefully...`);

    server.close((err) => {
        if (err) {
            logger.error('Error during shutdown', { error: err.message });
            process.exit(1);
        }

        logger.info('Server closed successfully');
        process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
        logger.warn('Forced shutdown due to timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Export app for testing
module.exports = app;

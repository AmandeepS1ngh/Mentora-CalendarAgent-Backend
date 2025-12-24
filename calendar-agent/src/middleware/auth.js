/**
 * Authentication Middleware
 * Validates user identity for protected routes using Supabase Auth.
 * 
 * Supports:
 * - Bearer token authentication (production) via Supabase Auth
 * - X-User-Id header (development fallback only)
 */

const { createClient } = require('@supabase/supabase-js');
const { AppError } = require('./errorHandler');
const logger = require('../utils/logger');

// Initialize Supabase client for auth verification
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

/**
 * Middleware to extract and validate user identity via JWT
 * 
 * Expected header format:
 * Authorization: Bearer <token> - Supabase JWT (primary)
 * X-User-Id: <user_id> - Development fallback only
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        const legacyUserId = req.headers['x-user-id'];

        // Debug logging
        logger.info('Auth middleware called', {
            hasAuthHeader: !!authHeader,
            authHeaderPrefix: authHeader ? authHeader.substring(0, 15) : 'none',
            hasLegacyUserId: !!legacyUserId,
            nodeEnv: process.env.NODE_ENV,
            supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
        });

        // Primary: JWT Authentication via Bearer token
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            logger.debug('Attempting JWT verification', { tokenLength: token.length });

            // Verify token with Supabase
            const { data: { user }, error } = await supabase.auth.getUser(token);

            if (error || !user) {
                logger.warn('Invalid or expired JWT token', {
                    error: error?.message,
                    errorCode: error?.code,
                    hasUser: !!user
                });
                throw new AppError('Invalid or expired authentication token', 401);
            }

            req.userId = user.id;
            req.user = user;
            logger.info('User authenticated via JWT', { userId: user.id, email: user.email });
            return next();
        }

        // Fallback: X-User-Id header (development mode only)
        if (process.env.NODE_ENV !== 'production' && legacyUserId) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(legacyUserId)) {
                throw new AppError('Invalid user ID format', 400);
            }

            req.userId = legacyUserId;
            logger.debug('User authenticated via X-User-Id header (dev mode)', { userId: legacyUserId });
            return next();
        }

        // No valid authentication found
        logger.warn('No valid authentication found', {
            hasAuthHeader: !!authHeader,
            hasLegacyUserId: !!legacyUserId,
            nodeEnv: process.env.NODE_ENV
        });
        throw new AppError('Authentication required. Please sign in.', 401);

    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        logger.error('Authentication error', { error: error.message, stack: error.stack });
        throw new AppError('Authentication failed', 401);
    }
}

/**
 * Optional authentication - sets userId if provided but doesn't require it
 * Useful for endpoints that work for both authenticated and anonymous users
 */
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        const legacyUserId = req.headers['x-user-id'];

        // Try JWT first
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const { data: { user } } = await supabase.auth.getUser(token);

            if (user) {
                req.userId = user.id;
                req.user = user;
            }
        }
        // Development fallback
        else if (process.env.NODE_ENV !== 'production' && legacyUserId) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(legacyUserId)) {
                req.userId = legacyUserId;
            }
        }

        next();
    } catch (error) {
        // Don't throw for optional auth, just continue without user
        logger.debug('Optional auth failed, continuing as anonymous', { error: error.message });
        next();
    }
}

/**
 * Middleware to check if user has connected Google
 * Use after authenticate middleware
 */
async function requireGoogleIntegration(req, res, next) {
    const { hasValidGoogleIntegration } = require('../db/helpers/userIntegrations');

    if (!req.userId) {
        throw new AppError('Authentication required', 401);
    }

    const hasIntegration = await hasValidGoogleIntegration(req.userId);

    if (!hasIntegration) {
        throw new AppError(
            'Google account not connected. Please connect your Google account first.',
            403
        );
    }

    next();
}

module.exports = {
    authenticate,
    optionalAuth,
    requireGoogleIntegration
};

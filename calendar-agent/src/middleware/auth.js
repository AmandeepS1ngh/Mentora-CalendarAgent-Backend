/**
 * Authentication Middleware
 * Validates user identity for protected routes.
 * 
 * IMPORTANT: This is a simplified implementation.
 * In production, integrate with your auth provider (Supabase Auth, etc.)
 * 
 * TODO: Integrate with Supabase Auth for JWT validation
 * TODO: Add role-based access control (RBAC)
 * TODO: Add API key authentication for service-to-service calls
 * TODO: Add rate limiting per user
 */

const { AppError } = require('./errorHandler');
const logger = require('../utils/logger');

/**
 * Middleware to extract and validate user identity
 * 
 * Expected header format:
 * Authorization: Bearer <token> - for JWT auth (production)
 * X-User-Id: <user_id> - for development/simplified auth
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function authenticate(req, res, next) {
    // Check for user ID in header (simplified auth for development)
    // TODO: Replace with proper JWT validation in production
    const userId = req.headers['x-user-id'];
    const authHeader = req.headers['authorization'];

    // Development mode: accept X-User-Id header
    if (userId) {
        // Basic UUID validation
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(userId)) {
            throw new AppError('Invalid user ID format', 400);
        }

        req.userId = userId;
        logger.debug('User authenticated via X-User-Id header', { userId });
        return next();
    }

    // JWT authentication (production)
    // TODO: Implement proper JWT validation with Supabase Auth
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);

        // TODO: Validate JWT token
        // For now, reject if X-User-Id is not provided
        logger.warn('JWT authentication not yet implemented');
    }

    // No valid authentication found
    throw new AppError('Authentication required. Provide X-User-Id header.', 401);
}

/**
 * Optional authentication - sets userId if provided but doesn't require it
 * Useful for endpoints that work for both authenticated and anonymous users
 */
function optionalAuth(req, res, next) {
    const userId = req.headers['x-user-id'];

    if (userId) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(userId)) {
            req.userId = userId;
        }
    }

    next();
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

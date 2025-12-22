/**
 * User Integrations Database Helper
 * Handles CRUD operations for OAuth tokens and user integrations.
 * 
 * SECURITY NOTE: Access tokens are stored encrypted in production.
 * Refresh tokens should be stored with additional encryption at rest.
 * 
 * TODO: Add token encryption at application level
 * TODO: Implement token rotation on refresh
 * TODO: Add integration health checks
 * TODO: Add audit logging for token access
 */

const supabase = require('../supabase');
const logger = require('../../utils/logger');

const TABLE_NAME = 'user_integrations';

/**
 * Store or update Google OAuth tokens for a user
 * Uses upsert to handle both new connections and token refreshes
 * 
 * @param {string} userId - User's unique identifier
 * @param {Object} tokens - OAuth tokens from Google
 * @param {string} tokens.access_token - Access token
 * @param {string} tokens.refresh_token - Refresh token (may be null on refresh)
 * @param {number} tokens.expiry_date - Token expiry timestamp in milliseconds
 * @param {string[]} tokens.scope - Granted scopes
 * @returns {Promise<Object>} Stored integration record
 */
async function storeGoogleTokens(userId, tokens) {
    const startTime = Date.now();

    logger.debug('Storing Google tokens for user', { userId });

    // Calculate token expiry as ISO timestamp
    const tokenExpiry = tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null;

    // Parse scopes from space-separated string or array
    const scopes = Array.isArray(tokens.scope)
        ? tokens.scope
        : (tokens.scope ? tokens.scope.split(' ') : []);

    // Prepare the record - note: refresh_token may be null on token refresh
    const record = {
        user_id: userId,
        provider: 'google',
        access_token: tokens.access_token,
        token_expiry: tokenExpiry,
        scopes: scopes,
        updated_at: new Date().toISOString()
    };

    // Only update refresh token if a new one is provided
    // Google doesn't always return refresh_token on subsequent authorizations
    if (tokens.refresh_token) {
        record.refresh_token = tokens.refresh_token;
    }

    // Upsert: insert if not exists, update if exists
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .upsert(record, {
            onConflict: 'user_id,provider',
            ignoreDuplicates: false
        })
        .select()
        .single();

    if (error) {
        logger.error('Failed to store Google tokens', {
            error: error.message,
            userId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info(`Stored Google tokens in ${Date.now() - startTime}ms`, {
        userId,
        hasRefreshToken: !!tokens.refresh_token,
        scopeCount: scopes.length
    });

    return data;
}

/**
 * Retrieve Google OAuth tokens for a user
 * @param {string} userId - User's unique identifier
 * @returns {Promise<Object|null>} Integration record or null if not found
 */
async function getGoogleTokens(userId) {
    logger.debug('Fetching Google tokens for user', { userId });

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('user_id', userId)
        .eq('provider', 'google')
        .single();

    if (error) {
        // Not found is not an error - user just hasn't connected Google yet
        if (error.code === 'PGRST116') {
            logger.debug('No Google integration found for user', { userId });
            return null;
        }
        logger.error('Failed to fetch Google tokens', {
            error: error.message,
            userId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    return data;
}

/**
 * Check if user has a valid (non-expired) Google integration
 * @param {string} userId - User's unique identifier
 * @returns {Promise<boolean>} Whether user has valid integration
 */
async function hasValidGoogleIntegration(userId) {
    const integration = await getGoogleTokens(userId);

    if (!integration) {
        return false;
    }

    // Check if token is expired
    if (integration.token_expiry) {
        const expiry = new Date(integration.token_expiry);
        const now = new Date();

        // If we have a refresh token, we can refresh even if access token is expired
        if (expiry < now && !integration.refresh_token) {
            logger.warn('Google token expired and no refresh token available', { userId });
            return false;
        }
    }

    return true;
}

/**
 * Update access token after refresh
 * @param {string} userId - User's unique identifier
 * @param {string} accessToken - New access token
 * @param {number} expiryDate - Token expiry timestamp in milliseconds
 * @returns {Promise<Object>} Updated integration record
 */
async function updateAccessToken(userId, accessToken, expiryDate) {
    logger.debug('Updating access token for user', { userId });

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .update({
            access_token: accessToken,
            token_expiry: new Date(expiryDate).toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('provider', 'google')
        .select()
        .single();

    if (error) {
        logger.error('Failed to update access token', {
            error: error.message,
            userId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info('Access token updated successfully', { userId });
    return data;
}

/**
 * Delete Google integration for a user (disconnect)
 * @param {string} userId - User's unique identifier
 * @returns {Promise<boolean>} Whether deletion was successful
 */
async function deleteGoogleIntegration(userId) {
    logger.debug('Deleting Google integration for user', { userId });

    const { error } = await supabase
        .from(TABLE_NAME)
        .delete()
        .eq('user_id', userId)
        .eq('provider', 'google');

    if (error) {
        logger.error('Failed to delete Google integration', {
            error: error.message,
            userId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info('Google integration deleted', { userId });
    return true;
}

module.exports = {
    storeGoogleTokens,
    getGoogleTokens,
    hasValidGoogleIntegration,
    updateAccessToken,
    deleteGoogleIntegration
};

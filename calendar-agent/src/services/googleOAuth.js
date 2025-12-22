/**
 * Google OAuth Service
 * Handles Google OAuth 2.0 authentication flow.
 * 
 * Features:
 * - Generate authorization URL with required scopes
 * - Exchange authorization code for tokens
 * - Refresh expired access tokens
 * - Token management and validation
 * 
 * TODO: Add token encryption for storage
 * TODO: Implement automatic background token refresh
 * TODO: Add OAuth state validation for CSRF protection
 * TODO: Add support for incremental authorization
 */

const { google } = require('googleapis');
const config = require('../config');
const logger = require('../utils/logger');
const userIntegrations = require('../db/helpers/userIntegrations');
const agentLogs = require('../db/helpers/agentLogs');

/**
 * Create a new OAuth2 client
 * @returns {OAuth2Client} Configured OAuth2 client
 */
function createOAuth2Client() {
    return new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
        config.google.redirectUri
    );
}

/**
 * Generate the Google OAuth authorization URL
 * User should be redirected to this URL to authorize the application
 * 
 * @param {string} userId - User ID to include in state (for callback)
 * @returns {Object} Authorization URL and state
 */
function generateAuthUrl(userId) {
    const oauth2Client = createOAuth2Client();

    // Generate a secure state parameter
    // TODO: Store state in session/cache for CSRF validation
    const state = Buffer.from(JSON.stringify({
        userId,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(7)
    })).toString('base64');

    const url = oauth2Client.generateAuthUrl({
        // 'offline' gets a refresh token
        access_type: 'offline',
        // Force consent screen to always get refresh token
        prompt: 'consent',
        scope: config.google.scopes,
        state: state
    });

    logger.info('Generated Google OAuth URL', { userId });

    return { url, state };
}

/**
 * Exchange authorization code for tokens
 * Called after user completes OAuth flow
 * 
 * @param {string} code - Authorization code from Google callback
 * @param {string} state - State parameter for validation
 * @returns {Promise<Object>} OAuth2 client with tokens set
 */
async function exchangeCodeForTokens(code, state) {
    const oauth2Client = createOAuth2Client();

    // Decode and validate state
    // TODO: Add proper CSRF validation with session storage
    let stateData;
    try {
        stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (error) {
        logger.error('Failed to decode OAuth state', { error: error.message });
        throw new Error('Invalid state parameter');
    }

    const userId = stateData.userId;

    try {
        // Exchange code for tokens
        const { tokens } = await oauth2Client.getToken(code);

        logger.info('Successfully exchanged code for tokens', {
            userId,
            hasAccessToken: !!tokens.access_token,
            hasRefreshToken: !!tokens.refresh_token,
            expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
        });

        // Store tokens in database
        await userIntegrations.storeGoogleTokens(userId, tokens);

        // Log successful OAuth completion
        await agentLogs.logSuccess(userId, agentLogs.ActionTypes.OAUTH_COMPLETED, {
            scopes: tokens.scope?.split(' ') || config.google.scopes
        });

        // Set tokens on client and return
        oauth2Client.setCredentials(tokens);

        return {
            oauth2Client,
            userId,
            tokens
        };
    } catch (error) {
        // Log OAuth failure
        await agentLogs.logFailure(userId, agentLogs.ActionTypes.OAUTH_FAILED, error.message);

        logger.error('Failed to exchange code for tokens', {
            error: error.message,
            userId
        });
        throw error;
    }
}

/**
 * Get an authenticated OAuth2 client for a user
 * Automatically refreshes tokens if expired
 * 
 * @param {string} userId - User's unique identifier
 * @returns {Promise<OAuth2Client>} Authenticated OAuth2 client
 */
async function getAuthenticatedClient(userId) {
    const oauth2Client = createOAuth2Client();

    // Get stored tokens
    const integration = await userIntegrations.getGoogleTokens(userId);

    if (!integration) {
        throw new Error('Google account not connected. Please connect first.');
    }

    // Set credentials
    oauth2Client.setCredentials({
        access_token: integration.access_token,
        refresh_token: integration.refresh_token,
        expiry_date: integration.token_expiry ? new Date(integration.token_expiry).getTime() : null
    });

    // Check if token needs refresh
    const tokenExpiry = integration.token_expiry ? new Date(integration.token_expiry).getTime() : null;
    const isExpired = tokenExpiry && tokenExpiry < Date.now();

    if (isExpired && integration.refresh_token) {
        logger.info('Access token expired, refreshing...', { userId });

        try {
            const { credentials } = await oauth2Client.refreshAccessToken();

            // Update stored tokens
            await userIntegrations.updateAccessToken(
                userId,
                credentials.access_token,
                credentials.expiry_date
            );

            // Log token refresh
            await agentLogs.logSuccess(userId, agentLogs.ActionTypes.OAUTH_REFRESH);

            logger.info('Access token refreshed successfully', { userId });
        } catch (error) {
            await agentLogs.logFailure(userId, agentLogs.ActionTypes.OAUTH_REFRESH, error.message);

            logger.error('Failed to refresh access token', {
                error: error.message,
                userId
            });
            throw new Error('Failed to refresh Google access token. Please reconnect.');
        }
    }

    return oauth2Client;
}

/**
 * Revoke Google access and delete integration
 * @param {string} userId - User's unique identifier
 * @returns {Promise<boolean>} Whether revocation was successful
 */
async function revokeAccess(userId) {
    try {
        const oauth2Client = await getAuthenticatedClient(userId);

        // Revoke the refresh token (this also invalidates access token)
        await oauth2Client.revokeCredentials();

        // Delete integration from database
        await userIntegrations.deleteGoogleIntegration(userId);

        logger.info('Google access revoked', { userId });
        return true;
    } catch (error) {
        logger.error('Failed to revoke Google access', {
            error: error.message,
            userId
        });

        // Still delete from database even if revocation fails
        await userIntegrations.deleteGoogleIntegration(userId);
        return false;
    }
}

module.exports = {
    createOAuth2Client,
    generateAuthUrl,
    exchangeCodeForTokens,
    getAuthenticatedClient,
    revokeAccess
};

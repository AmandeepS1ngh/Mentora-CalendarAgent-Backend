/**
 * Agent Logs Database Helper
 * Handles logging of agent actions and errors for observability.
 * 
 * This provides an audit trail of all agent operations including:
 * - OAuth connections
 * - Task operations
 * - Sync operations
 * - Summary generations
 * - Errors and failures
 * 
 * TODO: Add log retention policy (auto-cleanup old logs)
 * TODO: Add log aggregation queries for analytics
 * TODO: Implement structured error categorization
 * TODO: Add performance metrics logging
 */

const supabase = require('../supabase');
const logger = require('../../utils/logger');

const TABLE_NAME = 'agent_logs';

/**
 * Log status enum
 */
const LogStatus = {
    SUCCESS: 'success',
    FAILURE: 'failure',
    PARTIAL: 'partial',  // For batch operations with mixed results
    PENDING: 'pending'   // For async operations
};

/**
 * Common action types for consistency
 */
const ActionTypes = {
    // OAuth actions
    OAUTH_INITIATED: 'oauth.initiated',
    OAUTH_COMPLETED: 'oauth.completed',
    OAUTH_FAILED: 'oauth.failed',
    OAUTH_REFRESH: 'oauth.refresh',

    // Task actions
    TASK_CREATED: 'task.created',
    TASK_UPDATED: 'task.updated',
    TASK_DELETED: 'task.deleted',
    TASK_STATUS_CHANGED: 'task.status_changed',

    // Sync actions
    SYNC_STARTED: 'sync.started',
    SYNC_COMPLETED: 'sync.completed',
    SYNC_FAILED: 'sync.failed',
    SYNC_PARTIAL: 'sync.partial',

    // Google Calendar actions
    GCAL_EVENT_CREATED: 'gcal.event_created',
    GCAL_EVENT_UPDATED: 'gcal.event_updated',
    GCAL_EVENT_DELETED: 'gcal.event_deleted',
    GCAL_API_ERROR: 'gcal.api_error',

    // Google Tasks actions
    GTASK_CREATED: 'gtask.created',
    GTASK_UPDATED: 'gtask.updated',
    GTASK_API_ERROR: 'gtask.api_error',

    // Summary actions
    SUMMARY_DAILY_GENERATED: 'summary.daily_generated',
    SUMMARY_WEEKLY_GENERATED: 'summary.weekly_generated',
    SUMMARY_FAILED: 'summary.failed',

    // Study Plan actions
    STUDY_PLAN_GENERATED: 'study_plan.generated',
    STUDY_PLAN_APPLIED: 'study_plan.applied',
    STUDY_PLAN_FAILED: 'study_plan.failed'
};

/**
 * Create a log entry
 * @param {Object} logData - Log data
 * @param {string} logData.userId - User's unique identifier (nullable for system logs)
 * @param {string} logData.action - Action type (use ActionTypes constants)
 * @param {string} logData.status - Status (use LogStatus constants)
 * @param {Object} logData.details - Additional details (JSON)
 * @param {string} logData.errorMessage - Error message if status is failure
 * @returns {Promise<Object>} Created log entry
 */
async function createLog(logData) {
    const record = {
        user_id: logData.userId || null,
        action: logData.action,
        status: logData.status || LogStatus.SUCCESS,
        details: logData.details || {},
        error_message: logData.errorMessage || null,
        created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .insert(record)
        .select()
        .single();

    if (error) {
        // Log to console but don't throw - logging failures shouldn't break the flow
        logger.error('Failed to create agent log', {
            error: error.message,
            action: logData.action
        });
        return null;
    }

    return data;
}

/**
 * Log a successful action
 * @param {string} userId - User's unique identifier
 * @param {string} action - Action type
 * @param {Object} details - Additional details
 * @returns {Promise<Object>} Created log entry
 */
async function logSuccess(userId, action, details = {}) {
    return createLog({
        userId,
        action,
        status: LogStatus.SUCCESS,
        details
    });
}

/**
 * Log a failed action
 * @param {string} userId - User's unique identifier
 * @param {string} action - Action type
 * @param {string} errorMessage - Error message
 * @param {Object} details - Additional details
 * @returns {Promise<Object>} Created log entry
 */
async function logFailure(userId, action, errorMessage, details = {}) {
    return createLog({
        userId,
        action,
        status: LogStatus.FAILURE,
        errorMessage,
        details
    });
}

/**
 * Get recent logs for a user
 * @param {string} userId - User's unique identifier
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of logs (default: 50)
 * @param {string[]} options.actions - Filter by action types
 * @param {string} options.status - Filter by status
 * @returns {Promise<Array>} Array of log entries
 */
async function getRecentLogs(userId, options = {}) {
    const limit = options.limit || 50;

    let query = supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (options.actions && options.actions.length > 0) {
        query = query.in('action', options.actions);
    }

    if (options.status) {
        query = query.eq('status', options.status);
    }

    const { data, error } = await query;

    if (error) {
        logger.error('Failed to fetch agent logs', {
            error: error.message,
            userId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
}

/**
 * Get error logs for debugging
 * @param {string} userId - User's unique identifier (optional, null for all users)
 * @param {number} hours - Number of hours to look back (default: 24)
 * @returns {Promise<Array>} Array of error log entries
 */
async function getErrorLogs(userId = null, hours = 24) {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    let query = supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('status', LogStatus.FAILURE)
        .gte('created_at', cutoffTime.toISOString())
        .order('created_at', { ascending: false });

    if (userId) {
        query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
        logger.error('Failed to fetch error logs', { error: error.message });
        throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
}

module.exports = {
    LogStatus,
    ActionTypes,
    createLog,
    logSuccess,
    logFailure,
    getRecentLogs,
    getErrorLogs
};

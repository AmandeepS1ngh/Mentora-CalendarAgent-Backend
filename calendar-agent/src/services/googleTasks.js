/**
 * Google Tasks Service
 * Handles interactions with the Google Tasks API.
 * 
 * NOTE: Google Tasks is an OPTIONAL sync target.
 * Some users prefer Calendar events, others prefer Tasks.
 * This service syncs tasks to the default task list.
 * 
 * IMPORTANT: Google Tasks API has limited features compared to Calendar.
 * - No time-based reminders
 * - Limited metadata support
 * - Due dates are date-only (no time component in standard API)
 * 
 * TODO: Allow users to select which task list to use
 * TODO: Add support for subtasks for complex study tasks
 * TODO: Implement task list creation for Mentora-specific lists
 * TODO: Add batch operations for multiple tasks
 */

const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./googleOAuth');
const { formatInTimezone } = require('../utils/timezone');
const logger = require('../utils/logger');
const agentLogs = require('../db/helpers/agentLogs');

/**
 * Default task list ID (@default is the user's primary list)
 */
const TASK_LIST_ID = '@default';

/**
 * Get a Tasks API client for a user
 * @param {string} userId - User's unique identifier
 * @returns {Promise<tasks_v1.Tasks>} Authenticated Tasks client
 */
async function getTasksClient(userId) {
    const auth = await getAuthenticatedClient(userId);
    return google.tasks({ version: 'v1', auth });
}

/**
 * Create a Google Task for a study task
 * 
 * @param {string} userId - User's unique identifier
 * @param {Object} task - Task data
 * @param {string} task.id - Task ID
 * @param {string} task.title - Task title
 * @param {string} task.description - Task description
 * @param {Date} task.deadline - Task deadline (UTC)
 * @param {string} task.timezone - User's timezone
 * @returns {Promise<Object>} Created Google Task data
 */
async function createTask(userId, task) {
    const startTime = Date.now();

    logger.debug('Creating Google Task', {
        userId,
        taskId: task.id
    });

    try {
        const tasksClient = await getTasksClient(userId);

        // Build task resource
        // Note: Google Tasks due date is date-only, no time component
        const googleTask = {
            title: `📚 ${task.title}`,
            notes: buildTaskNotes(task),
            // Due date in RFC 3339 format (date portion only used by API)
            due: task.deadline.toISOString(),
            status: 'needsAction'
        };

        const response = await tasksClient.tasks.insert({
            tasklist: TASK_LIST_ID,
            resource: googleTask
        });

        const createdTask = response.data;

        // Log successful creation
        await agentLogs.logSuccess(userId, agentLogs.ActionTypes.GTASK_CREATED, {
            mentoraTaskId: task.id,
            googleTaskId: createdTask.id
        });

        logger.info(`Created Google Task in ${Date.now() - startTime}ms`, {
            userId,
            taskId: task.id,
            googleTaskId: createdTask.id
        });

        return {
            googleTaskId: createdTask.id,
            status: createdTask.status,
            selfLink: createdTask.selfLink
        };

    } catch (error) {
        // Log API error
        await agentLogs.logFailure(userId, agentLogs.ActionTypes.GTASK_API_ERROR, error.message, {
            taskId: task.id,
            operation: 'create'
        });

        logger.error('Failed to create Google Task', {
            error: error.message,
            userId,
            taskId: task.id
        });

        // Fail gracefully - return null instead of throwing
        return null;
    }
}

/**
 * Update an existing Google Task
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} googleTaskId - Google Task ID
 * @param {Object} task - Updated task data
 * @returns {Promise<Object>} Updated Google Task data
 */
async function updateTask(userId, googleTaskId, task) {
    logger.debug('Updating Google Task', {
        userId,
        googleTaskId,
        taskId: task.id
    });

    try {
        const tasksClient = await getTasksClient(userId);

        const googleTask = {
            title: `📚 ${task.title}`,
            notes: buildTaskNotes(task),
            due: task.deadline.toISOString()
        };

        const response = await tasksClient.tasks.patch({
            tasklist: TASK_LIST_ID,
            task: googleTaskId,
            resource: googleTask
        });

        await agentLogs.logSuccess(userId, agentLogs.ActionTypes.GTASK_UPDATED, {
            mentoraTaskId: task.id,
            googleTaskId
        });

        logger.info('Updated Google Task', {
            userId,
            googleTaskId,
            taskId: task.id
        });

        return {
            googleTaskId: response.data.id,
            status: response.data.status
        };

    } catch (error) {
        await agentLogs.logFailure(userId, agentLogs.ActionTypes.GTASK_API_ERROR, error.message, {
            taskId: task.id,
            googleTaskId,
            operation: 'update'
        });

        logger.error('Failed to update Google Task', {
            error: error.message,
            userId,
            googleTaskId
        });

        return null;
    }
}

/**
 * Mark a Google Task as completed
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} googleTaskId - Google Task ID
 * @returns {Promise<boolean>} Whether update was successful
 */
async function completeTask(userId, googleTaskId) {
    logger.debug('Completing Google Task', { userId, googleTaskId });

    try {
        const tasksClient = await getTasksClient(userId);

        await tasksClient.tasks.patch({
            tasklist: TASK_LIST_ID,
            task: googleTaskId,
            resource: {
                status: 'completed'
            }
        });

        logger.info('Completed Google Task', { userId, googleTaskId });
        return true;

    } catch (error) {
        logger.error('Failed to complete Google Task', {
            error: error.message,
            userId,
            googleTaskId
        });

        return false;
    }
}

/**
 * Delete a Google Task
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} googleTaskId - Google Task ID
 * @returns {Promise<boolean>} Whether deletion was successful
 */
async function deleteTask(userId, googleTaskId) {
    logger.debug('Deleting Google Task', { userId, googleTaskId });

    try {
        const tasksClient = await getTasksClient(userId);

        await tasksClient.tasks.delete({
            tasklist: TASK_LIST_ID,
            task: googleTaskId
        });

        logger.info('Deleted Google Task', { userId, googleTaskId });
        return true;

    } catch (error) {
        // 404 means task doesn't exist - treat as success
        if (error.code === 404) {
            logger.warn('Google Task not found for deletion', { userId, googleTaskId });
            return true;
        }

        logger.error('Failed to delete Google Task', {
            error: error.message,
            userId,
            googleTaskId
        });

        return false;
    }
}

/**
 * List Google Tasks for a date range
 * Note: Google Tasks API doesn't support date range filtering well
 * We fetch all tasks and filter client-side
 * 
 * @param {string} userId - User's unique identifier
 * @returns {Promise<Array>} List of tasks
 * 
 * TODO: Implement proper pagination
 */
async function listTasks(userId) {
    logger.debug('Listing Google Tasks', { userId });

    try {
        const tasksClient = await getTasksClient(userId);

        const response = await tasksClient.tasks.list({
            tasklist: TASK_LIST_ID,
            showCompleted: true,
            showHidden: false,
            maxResults: 100  // TODO: Handle pagination
        });

        const tasks = response.data.items || [];

        logger.debug(`Found ${tasks.length} Google Tasks`, { userId });

        return tasks.map(task => ({
            googleTaskId: task.id,
            title: task.title,
            notes: task.notes,
            due: task.due,
            status: task.status,
            completed: task.completed
        }));

    } catch (error) {
        logger.error('Failed to list Google Tasks', {
            error: error.message,
            userId
        });

        return [];
    }
}

/**
 * Build task notes from Mentora task data
 * @param {Object} task - Task data
 * @returns {string} Formatted notes
 */
function buildTaskNotes(task) {
    const lines = [
        task.description || 'No description provided.',
        '',
        `📅 Due: ${formatInTimezone(task.deadline, task.timezone, 'yyyy-MM-dd HH:mm')}`,
        `🆔 Mentora Task ID: ${task.id}`,
        '',
        '🎓 Created by Mentora Calendar Agent'
    ];

    return lines.join('\n');
}

module.exports = {
    createTask,
    updateTask,
    completeTask,
    deleteTask,
    listTasks
};

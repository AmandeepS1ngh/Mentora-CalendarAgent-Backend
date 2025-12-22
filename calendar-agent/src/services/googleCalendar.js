/**
 * Google Calendar Service
 * Handles all interactions with the Google Calendar API.
 * 
 * Features:
 * - Create calendar events for study tasks
 * - Update existing events
 * - Delete events
 * - List events for date ranges
 * 
 * IMPORTANT: Supabase is the source of truth.
 * Google Calendar is a sync target, not a source.
 * 
 * TODO: Implement batch operations for multiple events
 * TODO: Add support for recurring events
 * TODO: Implement push notifications (webhooks) for real-time sync
 * TODO: Add calendar color coding for different task types
 * TODO: Handle rate limiting with exponential backoff
 */

const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./googleOAuth');
const { toGoogleDateTime } = require('../utils/timezone');
const logger = require('../utils/logger');
const agentLogs = require('../db/helpers/agentLogs');

/**
 * Default calendar ID (primary calendar)
 * TODO: Allow users to select a specific calendar
 */
const CALENDAR_ID = 'primary';

/**
 * Default event duration in minutes if not specified
 */
const DEFAULT_EVENT_DURATION_MINUTES = 60;

/**
 * Get a Calendar API client for a user
 * @param {string} userId - User's unique identifier
 * @returns {Promise<calendar_v3.Calendar>} Authenticated Calendar client
 */
async function getCalendarClient(userId) {
    const auth = await getAuthenticatedClient(userId);
    return google.calendar({ version: 'v3', auth });
}

/**
 * Create a calendar event for a study task
 * 
 * @param {string} userId - User's unique identifier
 * @param {Object} task - Task data
 * @param {string} task.id - Task ID
 * @param {string} task.title - Task title
 * @param {string} task.description - Task description
 * @param {Date} task.deadline - Task deadline (UTC)
 * @param {string} task.timezone - User's timezone
 * @returns {Promise<Object>} Created event data
 */
async function createEvent(userId, task) {
    const startTime = Date.now();

    logger.debug('Creating calendar event', {
        userId,
        taskId: task.id
    });

    try {
        const calendar = await getCalendarClient(userId);

        // Calculate event start time (1 hour before deadline by default)
        const deadlineTime = new Date(task.deadline).getTime();
        const startDateTime = new Date(deadlineTime - DEFAULT_EVENT_DURATION_MINUTES * 60 * 1000);

        // Build event resource
        const event = {
            summary: `📚 ${task.title}`,
            description: buildEventDescription(task),
            start: toGoogleDateTime(startDateTime, task.timezone),
            end: toGoogleDateTime(task.deadline, task.timezone),
            // Add task metadata for reference
            extendedProperties: {
                private: {
                    mentora_task_id: task.id,
                    source: 'mentora_calendar_agent'
                }
            },
            // Set reminder 30 minutes before
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 30 },
                    { method: 'popup', minutes: 10 }
                ]
            },
            // Color: Study tasks in blue (colorId 9)
            // TODO: Make configurable based on task type
            colorId: '9'
        };

        const response = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            resource: event
        });

        const createdEvent = response.data;

        // Log successful creation
        await agentLogs.logSuccess(userId, agentLogs.ActionTypes.GCAL_EVENT_CREATED, {
            taskId: task.id,
            eventId: createdEvent.id,
            eventLink: createdEvent.htmlLink
        });

        logger.info(`Created calendar event in ${Date.now() - startTime}ms`, {
            userId,
            taskId: task.id,
            eventId: createdEvent.id
        });

        return {
            eventId: createdEvent.id,
            htmlLink: createdEvent.htmlLink,
            status: createdEvent.status
        };

    } catch (error) {
        // Log API error
        await agentLogs.logFailure(userId, agentLogs.ActionTypes.GCAL_API_ERROR, error.message, {
            taskId: task.id,
            operation: 'create'
        });

        logger.error('Failed to create calendar event', {
            error: error.message,
            userId,
            taskId: task.id
        });

        // Fail gracefully - return null instead of throwing
        // The sync process can retry later
        return null;
    }
}

/**
 * Update an existing calendar event
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} eventId - Google Calendar event ID
 * @param {Object} task - Updated task data
 * @returns {Promise<Object>} Updated event data
 */
async function updateEvent(userId, eventId, task) {
    logger.debug('Updating calendar event', {
        userId,
        eventId,
        taskId: task.id
    });

    try {
        const calendar = await getCalendarClient(userId);

        // Calculate event times
        const deadlineTime = new Date(task.deadline).getTime();
        const startDateTime = new Date(deadlineTime - DEFAULT_EVENT_DURATION_MINUTES * 60 * 1000);

        const event = {
            summary: `📚 ${task.title}`,
            description: buildEventDescription(task),
            start: toGoogleDateTime(startDateTime, task.timezone),
            end: toGoogleDateTime(task.deadline, task.timezone)
        };

        const response = await calendar.events.patch({
            calendarId: CALENDAR_ID,
            eventId: eventId,
            resource: event
        });

        await agentLogs.logSuccess(userId, agentLogs.ActionTypes.GCAL_EVENT_UPDATED, {
            taskId: task.id,
            eventId: eventId
        });

        logger.info('Updated calendar event', {
            userId,
            eventId,
            taskId: task.id
        });

        return {
            eventId: response.data.id,
            htmlLink: response.data.htmlLink,
            status: response.data.status
        };

    } catch (error) {
        await agentLogs.logFailure(userId, agentLogs.ActionTypes.GCAL_API_ERROR, error.message, {
            taskId: task.id,
            eventId,
            operation: 'update'
        });

        logger.error('Failed to update calendar event', {
            error: error.message,
            userId,
            eventId
        });

        return null;
    }
}

/**
 * Delete a calendar event
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} eventId - Google Calendar event ID
 * @returns {Promise<boolean>} Whether deletion was successful
 */
async function deleteEvent(userId, eventId) {
    logger.debug('Deleting calendar event', { userId, eventId });

    try {
        const calendar = await getCalendarClient(userId);

        await calendar.events.delete({
            calendarId: CALENDAR_ID,
            eventId: eventId
        });

        await agentLogs.logSuccess(userId, agentLogs.ActionTypes.GCAL_EVENT_DELETED, {
            eventId
        });

        logger.info('Deleted calendar event', { userId, eventId });
        return true;

    } catch (error) {
        // 404 means event doesn't exist - treat as success
        if (error.code === 404) {
            logger.warn('Calendar event not found for deletion', { userId, eventId });
            return true;
        }

        await agentLogs.logFailure(userId, agentLogs.ActionTypes.GCAL_API_ERROR, error.message, {
            eventId,
            operation: 'delete'
        });

        logger.error('Failed to delete calendar event', {
            error: error.message,
            userId,
            eventId
        });

        return false;
    }
}

/**
 * List calendar events for a date range
 * 
 * @param {string} userId - User's unique identifier
 * @param {Date} startDate - Start of range (UTC)
 * @param {Date} endDate - End of range (UTC)
 * @returns {Promise<Array>} List of events
 * 
 * TODO: Add pagination for large date ranges
 */
async function listEvents(userId, startDate, endDate) {
    logger.debug('Listing calendar events', {
        userId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
    });

    try {
        const calendar = await getCalendarClient(userId);

        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250,  // TODO: Handle pagination for more events
            // Only get Mentora events
            privateExtendedProperty: 'source=mentora_calendar_agent'
        });

        const events = response.data.items || [];

        logger.debug(`Found ${events.length} calendar events`, { userId });

        return events.map(event => ({
            eventId: event.id,
            title: event.summary,
            description: event.description,
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            htmlLink: event.htmlLink,
            taskId: event.extendedProperties?.private?.mentora_task_id
        }));

    } catch (error) {
        logger.error('Failed to list calendar events', {
            error: error.message,
            userId
        });

        // Return empty array on failure - don't break the flow
        return [];
    }
}

/**
 * Build event description from task data
 * @param {Object} task - Task data
 * @returns {string} Formatted description
 */
function buildEventDescription(task) {
    const lines = [
        `📋 Study Task: ${task.title}`,
        '',
        task.description || 'No description provided.',
        '',
        '---',
        `Status: ${task.status || 'pending'}`,
        `Task ID: ${task.id}`,
        '',
        '🎓 Created by Mentora Calendar Agent'
    ];

    return lines.join('\n');
}

module.exports = {
    createEvent,
    updateEvent,
    deleteEvent,
    listEvents
};

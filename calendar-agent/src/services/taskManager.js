/**
 * Task Manager Service
 * Core business logic for task operations.
 * 
 * This service orchestrates:
 * - Task creation with timezone handling
 * - Task retrieval (today, weekly)
 * - Task synchronization to Google services
 * - Task status management
 * 
 * IMPORTANT: Supabase is ALWAYS the source of truth.
 * Google Calendar/Tasks are sync targets.
 * 
 * TODO: Add task prioritization
 * TODO: Implement task dependencies
 * TODO: Add recurring task support
 * TODO: Implement smart scheduling suggestions (NOT using AI for timing)
 * TODO: Add batch operations for performance
 */

const tasksDb = require('../db/helpers/tasks');
const agentLogs = require('../db/helpers/agentLogs');
const googleCalendar = require('./googleCalendar');
const googleTasks = require('./googleTasks');
const { isValidTimezone, parseToUTC, getStartOfTodayUTC, getEndOfTodayUTC, getStartOfWeekUTC, getEndOfWeekUTC, formatInTimezone, getRelativeTime } = require('../utils/timezone');
const logger = require('../utils/logger');

/**
 * Create a new study task
 * 
 * @param {string} userId - User's unique identifier
 * @param {Object} taskData - Task data from request
 * @param {string} taskData.title - Task title
 * @param {string} taskData.description - Task description
 * @param {string} taskData.deadline - Deadline (ISO string in user's timezone)
 * @param {string} taskData.timezone - User's timezone
 * @param {Object} options - Creation options
 * @param {boolean} options.syncToGoogle - Whether to sync to Google immediately
 * @returns {Promise<Object>} Created task
 * 
 * IMPORTANT: We do NOT let AI decide timestamps.
 * Deadline must be explicitly provided by the frontend.
 */
async function createTask(userId, taskData, options = {}) {
    const startTime = Date.now();

    logger.info('Creating new study task', {
        userId,
        title: taskData.title
    });

    // Validate required fields
    if (!taskData.title || taskData.title.trim().length === 0) {
        throw new Error('Task title is required');
    }

    if (!taskData.deadline) {
        throw new Error('Task deadline is required');
    }

    // Validate and use timezone
    const timezone = isValidTimezone(taskData.timezone)
        ? taskData.timezone
        : 'UTC';

    // Parse deadline to UTC
    // The frontend provides deadline in the user's timezone
    // We store it in UTC in the database
    const deadlineUTC = parseToUTC(taskData.deadline, timezone);

    // Create task in Supabase (source of truth)
    const task = await tasksDb.createTask({
        userId,
        title: taskData.title.trim(),
        description: taskData.description?.trim() || null,
        deadline: deadlineUTC,
        timezone
    });

    // Log task creation
    await agentLogs.logSuccess(userId, agentLogs.ActionTypes.TASK_CREATED, {
        taskId: task.id,
        title: task.title,
        deadline: task.deadline
    });

    logger.info(`Task created in ${Date.now() - startTime}ms`, {
        taskId: task.id,
        userId
    });

    // Optionally sync to Google immediately
    // By default, we don't sync immediately to avoid blocking the response
    // TODO: Move to async job queue for production
    if (options.syncToGoogle) {
        await syncTaskToGoogle(userId, task);
    }

    return formatTaskForResponse(task);
}

/**
 * Get tasks for today
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} timezone - User's timezone
 * @returns {Promise<Array>} Today's tasks
 */
async function getTodayTasks(userId, timezone = 'UTC') {
    const tz = isValidTimezone(timezone) ? timezone : 'UTC';

    const startOfDay = getStartOfTodayUTC(tz);
    const endOfDay = getEndOfTodayUTC(tz);

    logger.debug('Fetching today\'s tasks', {
        userId,
        timezone: tz,
        startOfDay: startOfDay.toISOString(),
        endOfDay: endOfDay.toISOString()
    });

    const tasks = await tasksDb.getTasksByDateRange(userId, startOfDay, endOfDay);

    // Also fetch weekly stats for the dashboard counters
    const startOfWeek = getStartOfWeekUTC(tz);
    const endOfWeek = getEndOfWeekUTC(tz);
    const stats = await tasksDb.getTaskStats(userId, startOfWeek, endOfWeek);

    return {
        tasks: tasks.map(task => formatTaskForResponse(task, tz)),
        stats
    };
}

/**
 * Get tasks for the current week
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} timezone - User's timezone
 * @returns {Promise<Object>} Weekly tasks with statistics
 */
async function getWeekTasks(userId, timezone = 'UTC') {
    const tz = isValidTimezone(timezone) ? timezone : 'UTC';

    const startOfWeek = getStartOfWeekUTC(tz);
    const endOfWeek = getEndOfWeekUTC(tz);

    logger.debug('Fetching week\'s tasks', {
        userId,
        timezone: tz,
        startOfWeek: startOfWeek.toISOString(),
        endOfWeek: endOfWeek.toISOString()
    });

    const tasks = await tasksDb.getTasksByDateRange(userId, startOfWeek, endOfWeek);
    const stats = await tasksDb.getTaskStats(userId, startOfWeek, endOfWeek);

    return {
        tasks: tasks.map(task => formatTaskForResponse(task, tz)),
        stats,
        dateRange: {
            start: startOfWeek.toISOString(),
            end: endOfWeek.toISOString()
        }
    };
}

/**
 * Sync a single task to Google Calendar and optionally Google Tasks
 * 
 * @param {string} userId - User's unique identifier
 * @param {Object} task - Task record from database
 * @param {Object} options - Sync options
 * @param {boolean} options.syncToTasks - Whether to also sync to Google Tasks
 * @returns {Promise<Object>} Sync result
 */
async function syncTaskToGoogle(userId, task, options = {}) {
    logger.info('Syncing task to Google', {
        userId,
        taskId: task.id
    });

    const result = {
        taskId: task.id,
        calendar: null,
        tasks: null,
        errors: []
    };

    // Sync to Google Calendar
    try {
        const calendarResult = await googleCalendar.createEvent(userId, {
            id: task.id,
            title: task.title,
            description: task.description,
            deadline: new Date(task.deadline),
            timezone: task.timezone,
            status: task.status
        });

        if (calendarResult) {
            result.calendar = calendarResult;

            // Update task with Google Calendar event ID
            await tasksDb.updateTaskSyncInfo(task.id, {
                googleCalendarEventId: calendarResult.eventId
            });
        } else {
            result.errors.push('Failed to sync to Google Calendar');
        }
    } catch (error) {
        logger.error('Google Calendar sync failed', {
            error: error.message,
            taskId: task.id
        });
        result.errors.push(`Calendar: ${error.message}`);
    }

    // Optionally sync to Google Tasks
    if (options.syncToTasks) {
        try {
            const tasksResult = await googleTasks.createTask(userId, {
                id: task.id,
                title: task.title,
                description: task.description,
                deadline: new Date(task.deadline),
                timezone: task.timezone
            });

            if (tasksResult) {
                result.tasks = tasksResult;

                // Update task with Google Task ID
                await tasksDb.updateTaskSyncInfo(task.id, {
                    googleTaskId: tasksResult.googleTaskId
                });
            } else {
                result.errors.push('Failed to sync to Google Tasks');
            }
        } catch (error) {
            logger.error('Google Tasks sync failed', {
                error: error.message,
                taskId: task.id
            });
            result.errors.push(`Tasks: ${error.message}`);
        }
    }

    return result;
}

/**
 * Sync all unsynced tasks to Google
 * WARNING: This is intentionally synchronous/sequential
 * 
 * @param {string} userId - User's unique identifier
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} Sync results summary
 * 
 * TODO: Implement batch operations for better performance
 * TODO: Move to async job queue for large number of tasks
 * TODO: Add rate limiting to avoid Google API quota issues
 */
async function syncAllTasks(userId, options = {}) {
    const startTime = Date.now();

    logger.info('Starting full task sync', { userId });

    // Log sync start
    await agentLogs.logSuccess(userId, agentLogs.ActionTypes.SYNC_STARTED);

    // Get all unsynced tasks
    const unsyncedTasks = await tasksDb.getUnsyncedTasks(userId);

    if (unsyncedTasks.length === 0) {
        logger.info('No tasks to sync', { userId });
        return {
            synced: 0,
            failed: 0,
            tasks: []
        };
    }

    logger.info(`Found ${unsyncedTasks.length} unsynced tasks`, { userId });

    const results = {
        synced: 0,
        failed: 0,
        tasks: []
    };

    // TODO: This is intentionally sequential - should use batching in production
    for (const task of unsyncedTasks) {
        const syncResult = await syncTaskToGoogle(userId, task, options);

        if (syncResult.errors.length === 0) {
            results.synced++;
        } else {
            results.failed++;
        }

        results.tasks.push({
            taskId: task.id,
            title: task.title,
            success: syncResult.errors.length === 0,
            errors: syncResult.errors
        });
    }

    const duration = Date.now() - startTime;

    // Log sync completion
    const logAction = results.failed > 0
        ? agentLogs.ActionTypes.SYNC_PARTIAL
        : agentLogs.ActionTypes.SYNC_COMPLETED;

    await agentLogs.logSuccess(userId, logAction, {
        synced: results.synced,
        failed: results.failed,
        durationMs: duration
    });

    logger.info(`Task sync completed in ${duration}ms`, {
        userId,
        synced: results.synced,
        failed: results.failed
    });

    return results;
}

/**
 * Update task status
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} taskId - Task ID
 * @param {string} status - New status
 * @returns {Promise<Object>} Updated task
 */
async function updateTaskStatus(userId, taskId, status) {
    logger.info('Updating task status', { userId, taskId, status });

    const task = await tasksDb.updateTaskStatus(taskId, userId, status);

    // Log status change
    await agentLogs.logSuccess(userId, agentLogs.ActionTypes.TASK_STATUS_CHANGED, {
        taskId,
        newStatus: status
    });

    // If task is completed and synced to Google Tasks, mark as complete there too
    if (status === tasksDb.TaskStatus.COMPLETED && task.google_task_id) {
        try {
            await googleTasks.completeTask(userId, task.google_task_id);
        } catch (error) {
            logger.warn('Failed to complete Google Task', {
                error: error.message,
                taskId
            });
            // Don't fail the operation - Google sync is secondary
        }
    }

    return formatTaskForResponse(task);
}

/**
 * Format a task for API response
 * Adds computed fields and formats dates for the user's timezone
 * 
 * @param {Object} task - Task record from database
 * @param {string} timezone - Timezone for formatting (optional)
 * @returns {Object} Formatted task
 */
function formatTaskForResponse(task, timezone = null) {
    const tz = timezone || task.timezone || 'UTC';
    const deadline = new Date(task.deadline);

    return {
        id: task.id,
        title: task.title,
        description: task.description,
        deadline: deadline.toISOString(),
        deadlineFormatted: formatInTimezone(deadline, tz, 'yyyy-MM-dd HH:mm'),
        deadlineRelative: getRelativeTime(deadline, tz),
        timezone: task.timezone,
        status: task.status,
        googleCalendarEventId: task.google_calendar_event_id || null,
        googleTaskId: task.google_task_id || null,
        isSynced: !!(task.google_calendar_event_id || task.google_task_id),
        syncedAt: task.synced_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at
    };
}

/**
 * Apply study plan to calendar (Calendar Agent responsibility)
 * Converts a study plan into dated, scheduled tasks
 * 
 * ARCHITECTURE NOTE:
 * This is where the Calendar Agent takes over from the Study Plan Agent.
 * Study Plan Agent decides WHAT to learn, Calendar Agent decides WHEN.
 * 
 * @param {string} userId - User UUID
 * @param {string} planId - Study plan UUID
 * @param {string} timezone - User timezone
 * @param {Object} options - Application options
 * @param {Date} options.startDate - When to start the plan (default: tomorrow)
 * @param {string} options.preferredTime - Preferred daily time (HH:mm format, default: "09:00")
 * @returns {Promise<Object>} Application result with created tasks
 * 
 * TODO: Add conflict detection with existing tasks
 * TODO: Implement  smart time slot finding based on calendar availability
 * TODO: Add rescheduling logic for missed sessions
 * TODO: Support for multi-session days with time spacing
 */
async function applyStudyPlan(userId, planId, timezone, options = {}) {
    const startTime = Date.now();
    const studyPlansDb = require('../db/helpers/studyPlans');
    const { DateTime } = require('luxon');

    logger.info('Applying study plan to calendar', {
        userId,
        planId,
        timezone
    });

    // Fetch the study plan
    const planRecord = await studyPlansDb.getStudyPlan(planId);

    if (!planRecord) {
        throw new Error('Study plan not found');
    }

    if (planRecord.user_id !== userId) {
        throw new Error('Unauthorized: This plan belongs to another user');
    }

    if (planRecord.status === 'applied') {
        throw new Error('This plan has already been applied to your calendar');
    }

    const plan = planRecord.plan_json;

    // Determine start date (defaults to tomorrow)
    const startDate = options.startDate
        ? DateTime.fromJSDate(new Date(options.startDate)).setZone(timezone)
        : DateTime.now().setZone(timezone).plus({ days: 1 }).startOf('day');

    // Default study time (can be customized)
    const preferredTime = options.preferredTime || '09:00';
    const [preferredHour, preferredMinute] = preferredTime.split(':').map(Number);

    logger.debug('Plan application settings', {
        startDate: startDate.toISO(),
        preferredTime,
        totalDays: plan.total_days,
        sessionsPerDay: plan.schedule[0]?.sessions || 1
    });

    const createdTasks = [];
    const errors = [];

    // Convert each day in the plan to tasks
    for (const dayPlan of plan.schedule) {
        try {
            // Calculate the actual date for this day
            const taskDate = startDate.plus({ days: dayPlan.day - 1 });

            // Create tasks for each session in the day
            for (let sessionNum = 1; sessionNum <= dayPlan.sessions; sessionNum++) {
                // Space out sessions if multiple per day
                // Session 1 at preferredTime, Session 2 a few hours later, etc.
                const sessionOffset = (sessionNum - 1) * 3; // 3 hours between sessions
                const sessionTime = taskDate.set({
                    hour: preferredHour + sessionOffset,
                    minute: preferredMinute,
                    second: 0,
                    millisecond: 0
                });

                // Create task title
                const taskTitle = dayPlan.sessions > 1
                    ? `${dayPlan.topic} (Session ${sessionNum}/${dayPlan.sessions})`
                    : dayPlan.topic;

                // Build description
                const description = [
                    `📚 Study Plan: ${plan.goal}`,
                    `📅 Day ${dayPlan.day} of ${plan.total_days}`,
                    dayPlan.notes ? `💡 ${dayPlan.notes}` : null,
                    `⏱️ Duration: ${dayPlan.session_duration_minutes} minutes`
                ].filter(Boolean).join('\n');

                // Create the task
                const task = await createTask(userId, {
                    title: taskTitle,
                    description,
                    deadline: sessionTime.toISO(),
                    timezone
                }, { syncToGoogle: false }); // We'll sync in batch later

                createdTasks.push(task);

                logger.debug('Created study session task', {
                    day: dayPlan.day,
                    session: sessionNum,
                    date: sessionTime.toISO(),
                    title: taskTitle
                });
            }
        } catch (error) {
            logger.error('Failed to create task for study plan day', {
                error: error.message,
                day: dayPlan.day,
                topic: dayPlan.topic
            });
            errors.push({
                day: dayPlan.day,
                error: error.message
            });
        }
    }

    // Update plan status to 'applied'
    await studyPlansDb.updatePlanStatus(planId, 'applied');

    // Log application
    await agentLogs.logSuccess(userId, agentLogs.ActionTypes.STUDY_PLAN_APPLIED, {
        planId,
        tasksCreated: createdTasks.length,
        errors: errors.length,
        durationMs: Date.now() - startTime
    });

    logger.info(`Study plan applied: ${createdTasks.length} tasks created`, {
        userId,
        planId,
        errors: errors.length,
        duration: Date.now() - startTime
    });

    return {
        tasksCreated: createdTasks.length,
        tasks: createdTasks,
        errors,
        startDate: startDate.toISODate(),
        endDate: startDate.plus({ days: plan.total_days - 1 }).toISODate(),
        plan: {
            id: planId,
            goal: plan.goal,
            totalDays: plan.total_days
        }
    };
}

module.exports = {
    createTask,
    getTodayTasks,
    getWeekTasks,
    syncTaskToGoogle,
    syncAllTasks,
    updateTaskStatus,
    applyStudyPlan
};

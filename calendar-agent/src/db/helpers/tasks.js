/**
 * Tasks Database Helper
 * Handles CRUD operations for study tasks.
 * 
 * IMPORTANT: Supabase is the system of record for all tasks.
 * Google Calendar/Tasks are secondary sync targets.
 * 
 * TODO: Add batch operations for bulk task updates
 * TODO: Add soft delete support
 * TODO: Add task history/audit trail
 * TODO: Implement task search with full-text search
 */

const supabase = require('../supabase');
const logger = require('../../utils/logger');

const TABLE_NAME = 'tasks';

/**
 * Task status enum
 */
const TaskStatus = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
};

/**
 * Create a new task
 * @param {Object} taskData - Task data
 * @param {string} taskData.userId - User's unique identifier
 * @param {string} taskData.title - Task title
 * @param {string} taskData.description - Task description
 * @param {Date} taskData.deadline - Task deadline (UTC)
 * @param {string} taskData.timezone - User's timezone for display
 * @returns {Promise<Object>} Created task record
 */
async function createTask(taskData) {
    const startTime = Date.now();

    logger.debug('Creating new task', {
        userId: taskData.userId,
        title: taskData.title
    });

    const record = {
        user_id: taskData.userId,
        title: taskData.title,
        description: taskData.description || null,
        deadline: taskData.deadline.toISOString(),
        timezone: taskData.timezone || 'UTC',
        status: TaskStatus.PENDING,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .insert(record)
        .select()
        .single();

    if (error) {
        logger.error('Failed to create task', {
            error: error.message,
            userId: taskData.userId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info(`Created task in ${Date.now() - startTime}ms`, {
        taskId: data.id,
        userId: taskData.userId
    });

    return data;
}

/**
 * Get a task by ID
 * @param {string} taskId - Task unique identifier
 * @param {string} userId - User unique identifier (for authorization)
 * @returns {Promise<Object|null>} Task record or null
 */
async function getTaskById(taskId, userId) {
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('id', taskId)
        .eq('user_id', userId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            return null;
        }
        logger.error('Failed to fetch task', {
            error: error.message,
            taskId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    return data;
}

/**
 * Get tasks for a specific date range
 * @param {string} userId - User's unique identifier
 * @param {Date} startDate - Start of range (UTC)
 * @param {Date} endDate - End of range (UTC)
 * @param {Object} options - Query options
 * @param {string[]} options.statuses - Filter by status(es)
 * @param {number} options.limit - Maximum number of tasks
 * @param {string} options.orderBy - Column to order by
 * @returns {Promise<Array>} Array of task records
 */
async function getTasksByDateRange(userId, startDate, endDate, options = {}) {
    const startTime = Date.now();

    logger.debug('Fetching tasks by date range', {
        userId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
    });

    let query = supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('user_id', userId)
        .gte('deadline', startDate.toISOString())
        .lte('deadline', endDate.toISOString());

    // Filter by status if provided
    if (options.statuses && options.statuses.length > 0) {
        query = query.in('status', options.statuses);
    }

    // Apply ordering (default: deadline ascending)
    const orderColumn = options.orderBy || 'deadline';
    query = query.order(orderColumn, { ascending: true });

    // Apply limit if provided
    if (options.limit) {
        query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
        logger.error('Failed to fetch tasks by date range', {
            error: error.message,
            userId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.debug(`Fetched ${data.length} tasks in ${Date.now() - startTime}ms`, {
        userId
    });

    return data || [];
}

/**
 * Get all pending tasks that need to be synced to Google
 * @param {string} userId - User's unique identifier
 * @returns {Promise<Array>} Unsynced tasks
 */
async function getUnsyncedTasks(userId) {
    logger.debug('Fetching unsynced tasks', { userId });

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('*')
        .eq('user_id', userId)
        .is('google_calendar_event_id', null)
        .neq('status', TaskStatus.CANCELLED)
        .order('deadline', { ascending: true });

    if (error) {
        logger.error('Failed to fetch unsynced tasks', {
            error: error.message,
            userId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
}

/**
 * Update task with Google sync information
 * @param {string} taskId - Task unique identifier
 * @param {Object} syncData - Sync information
 * @param {string} syncData.googleCalendarEventId - Google Calendar event ID
 * @param {string} syncData.googleTaskId - Google Task ID (optional)
 * @returns {Promise<Object>} Updated task record
 */
async function updateTaskSyncInfo(taskId, syncData) {
    logger.debug('Updating task sync info', { taskId });

    const updateData = {
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    if (syncData.googleCalendarEventId) {
        updateData.google_calendar_event_id = syncData.googleCalendarEventId;
    }

    if (syncData.googleTaskId) {
        updateData.google_task_id = syncData.googleTaskId;
    }

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .update(updateData)
        .eq('id', taskId)
        .select()
        .single();

    if (error) {
        logger.error('Failed to update task sync info', {
            error: error.message,
            taskId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info('Task sync info updated', { taskId });
    return data;
}

/**
 * Update task status
 * @param {string} taskId - Task unique identifier
 * @param {string} userId - User unique identifier (for authorization)
 * @param {string} status - New status
 * @returns {Promise<Object>} Updated task record
 */
async function updateTaskStatus(taskId, userId, status) {
    logger.debug('Updating task status', { taskId, status });

    // Validate status
    if (!Object.values(TaskStatus).includes(status)) {
        throw new Error(`Invalid status: ${status}`);
    }

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .update({
            status,
            updated_at: new Date().toISOString()
        })
        .eq('id', taskId)
        .eq('user_id', userId)
        .select()
        .single();

    if (error) {
        logger.error('Failed to update task status', {
            error: error.message,
            taskId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info('Task status updated', { taskId, status });
    return data;
}

/**
 * Get task statistics for a user
 * @param {string} userId - User's unique identifier
 * @param {Date} startDate - Start of range (UTC)
 * @param {Date} endDate - End of range (UTC)
 * @returns {Promise<Object>} Statistics object
 */
async function getTaskStats(userId, startDate, endDate) {
    logger.debug('Fetching task statistics', { userId });

    // TODO: This should be a single aggregation query for performance
    // Current implementation is simple but not efficient at scale
    const tasks = await getTasksByDateRange(userId, startDate, endDate);

    const stats = {
        total: tasks.length,
        pending: tasks.filter(t => t.status === TaskStatus.PENDING).length,
        inProgress: tasks.filter(t => t.status === TaskStatus.IN_PROGRESS).length,
        completed: tasks.filter(t => t.status === TaskStatus.COMPLETED).length,
        cancelled: tasks.filter(t => t.status === TaskStatus.CANCELLED).length,
        hours: 0
    };

    // Calculate total hours for interesting tasks (mainly completed ones)
    // We parse "Duration: X minutes" from description
    const completedTasks = tasks.filter(t => t.status === TaskStatus.COMPLETED);
    let totalMinutes = 0;

    for (const task of completedTasks) {
        if (task.description) {
            const match = task.description.match(/Duration: (\d+) minutes/i);
            if (match && match[1]) {
                totalMinutes += parseInt(match[1], 10);
            } else {
                // Default fallback: 30 minutes if no duration specified but completed
                // This makes the chart feel more alive
                totalMinutes += 30;
            }
        } else {
            // Default fallback for tasks without description
            totalMinutes += 30;
        }
    }

    stats.hours = Math.round((totalMinutes / 60) * 10) / 10; // Round to 1 decimal place

    return stats;
}

/**
 * Delete a task
 * @param {string} taskId - Task unique identifier
 * @param {string} userId - User unique identifier (for authorization)
 * @returns {Promise<boolean>} Whether deletion was successful
 * 
 * TODO: Implement soft delete instead of hard delete
 */
async function deleteTask(taskId, userId) {
    logger.debug('Deleting task', { taskId });

    const { error } = await supabase
        .from(TABLE_NAME)
        .delete()
        .eq('id', taskId)
        .eq('user_id', userId);

    if (error) {
        logger.error('Failed to delete task', {
            error: error.message,
            taskId
        });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info('Task deleted', { taskId });
    return true;
}

module.exports = {
    TaskStatus,
    createTask,
    getTaskById,
    getTasksByDateRange,
    getUnsyncedTasks,
    updateTaskSyncInfo,
    updateTaskStatus,
    getTaskStats,
    deleteTask
};

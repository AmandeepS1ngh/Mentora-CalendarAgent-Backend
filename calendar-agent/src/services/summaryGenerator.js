/**
 * Summary Generator Service
 * Uses Groq LLM to generate daily and weekly study summaries.
 * 
 * IMPORTANT: Groq is ONLY used for generating summaries and feedback.
 * It is NOT used for task scheduling, timing decisions, or any other logic.
 * 
 * Features:
 * - Daily task summaries with productivity insights
 * - Weekly progress summaries with trends
 * - Personalized study recommendations
 * 
 * TODO: Add caching for identical summary requests
 * TODO: Implement streaming responses for real-time output
 * TODO: Add prompt templates and versioning
 * TODO: Support different summary styles (brief, detailed)
 * TODO: Add multi-language support
 */

const Groq = require('groq-sdk');
const config = require('../config');
const logger = require('../utils/logger');
const agentLogs = require('../db/helpers/agentLogs');
const tasksDb = require('../db/helpers/tasks');
const { formatInTimezone, getStartOfTodayUTC, getEndOfTodayUTC, getStartOfWeekUTC, getEndOfWeekUTC, isValidTimezone } = require('../utils/timezone');

// Initialize Groq client
const groq = new Groq({
    apiKey: config.groq.apiKey
});

/**
 * System prompt for daily summaries
 */
const DAILY_SUMMARY_SYSTEM_PROMPT = `You are a friendly and encouraging study assistant for Mentora, an educational platform. 
Your role is to provide helpful, motivating daily summaries of a student's tasks and productivity.

Guidelines:
1. Be encouraging and positive, but also honest about areas for improvement
2. Highlight accomplishments and progress
3. Provide actionable suggestions for tomorrow
4. Keep the tone friendly and supportive
5. Use emojis sparingly to add warmth
6. Keep summaries concise (under 300 words)

Focus on the student's study tasks and help them stay motivated in their learning journey.`;

/**
 * System prompt for weekly summaries
 */
const WEEKLY_SUMMARY_SYSTEM_PROMPT = `You are a friendly and encouraging study assistant for Mentora, an educational platform.
Your role is to provide insightful weekly summaries that help students understand their progress and patterns.

Guidelines:
1. Analyze patterns in task completion and productivity
2. Celebrate achievements and milestones
3. Identify areas where the student struggled
4. Provide specific, actionable recommendations for next week
5. Keep the tone supportive and growth-focused
6. Use data to back up observations
7. Keep summaries focused (under 500 words)

Help students see their weekly progress and feel motivated for the week ahead.`;

/**
 * Generate a daily summary for a user
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} timezone - User's timezone
 * @returns {Promise<Object>} Generated summary
 */
async function generateDailySummary(userId, timezone = 'UTC') {
    const startTime = Date.now();
    const tz = isValidTimezone(timezone) ? timezone : 'UTC';

    logger.info('Generating daily summary', { userId, timezone: tz });

    try {
        // Get today's tasks
        const startOfDay = getStartOfTodayUTC(tz);
        const endOfDay = getEndOfTodayUTC(tz);

        const tasks = await tasksDb.getTasksByDateRange(userId, startOfDay, endOfDay);
        const stats = await tasksDb.getTaskStats(userId, startOfDay, endOfDay);

        if (tasks.length === 0) {
            return {
                summary: "📅 You don't have any tasks scheduled for today! Take this opportunity to plan ahead or enjoy a well-deserved break. 🌟",
                tasks: [],
                stats,
                generatedAt: new Date().toISOString()
            };
        }

        // Format tasks for the prompt
        const taskList = formatTasksForPrompt(tasks, tz);

        // Build the user prompt
        const userPrompt = `Please provide a daily summary for today's study tasks.

TODAY'S DATE: ${formatInTimezone(new Date(), tz, 'EEEE, MMMM d, yyyy')}

TASKS FOR TODAY:
${taskList}

STATISTICS:
- Total tasks: ${stats.total}
- Completed: ${stats.completed}
- In Progress: ${stats.inProgress}
- Pending: ${stats.pending}
- Completion Rate: ${stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%

Please provide:
1. A brief overview of today's workload
2. Recognition of completed tasks (if any)
3. Priorities for remaining tasks
4. A motivational closing message`;

        // Call Groq API
        const response = await groq.chat.completions.create({
            model: config.groq.model,
            messages: [
                { role: 'system', content: DAILY_SUMMARY_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 1024
        });

        const summary = response.choices[0].message.content;

        // Log successful generation
        await agentLogs.logSuccess(userId, agentLogs.ActionTypes.SUMMARY_DAILY_GENERATED, {
            taskCount: tasks.length,
            completionRate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
            tokenUsage: response.usage
        });

        logger.info(`Generated daily summary in ${Date.now() - startTime}ms`, {
            userId,
            taskCount: tasks.length
        });

        return {
            summary,
            tasks: tasks.map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                deadline: formatInTimezone(new Date(t.deadline), tz, 'HH:mm')
            })),
            stats,
            generatedAt: new Date().toISOString()
        };

    } catch (error) {
        await agentLogs.logFailure(userId, agentLogs.ActionTypes.SUMMARY_FAILED, error.message, {
            type: 'daily'
        });

        logger.error('Failed to generate daily summary', {
            error: error.message,
            userId
        });

        // Return a fallback summary instead of failing
        return {
            summary: "📊 I couldn't generate your personalized summary right now. Here's what I know: Check your task list for today's priorities and keep up the great work! 💪",
            error: 'Summary generation temporarily unavailable',
            generatedAt: new Date().toISOString()
        };
    }
}

/**
 * Generate a weekly summary for a user
 * 
 * @param {string} userId - User's unique identifier
 * @param {string} timezone - User's timezone
 * @returns {Promise<Object>} Generated summary
 */
async function generateWeeklySummary(userId, timezone = 'UTC') {
    const startTime = Date.now();
    const tz = isValidTimezone(timezone) ? timezone : 'UTC';

    logger.info('Generating weekly summary', { userId, timezone: tz });

    try {
        // Get this week's tasks
        const startOfWeek = getStartOfWeekUTC(tz);
        const endOfWeek = getEndOfWeekUTC(tz);

        const tasks = await tasksDb.getTasksByDateRange(userId, startOfWeek, endOfWeek);
        const stats = await tasksDb.getTaskStats(userId, startOfWeek, endOfWeek);

        if (tasks.length === 0) {
            return {
                summary: "📅 You don't have any tasks scheduled for this week! Use this time to set goals and plan your upcoming study sessions. 🎯",
                tasks: [],
                stats,
                dateRange: {
                    start: formatInTimezone(startOfWeek, tz, 'yyyy-MM-dd'),
                    end: formatInTimezone(endOfWeek, tz, 'yyyy-MM-dd')
                },
                generatedAt: new Date().toISOString()
            };
        }

        // Group tasks by day for pattern analysis
        const tasksByDay = groupTasksByDay(tasks, tz);

        // Format tasks for the prompt
        const taskList = formatTasksForPrompt(tasks, tz);

        // Build the user prompt
        const userPrompt = `Please provide a weekly summary and analysis of this student's study tasks.

WEEK: ${formatInTimezone(startOfWeek, tz, 'MMMM d')} - ${formatInTimezone(endOfWeek, tz, 'MMMM d, yyyy')}

ALL TASKS THIS WEEK:
${taskList}

DAILY BREAKDOWN:
${formatDailyBreakdown(tasksByDay)}

STATISTICS:
- Total tasks: ${stats.total}
- Completed: ${stats.completed}
- In Progress: ${stats.inProgress}
- Pending: ${stats.pending}
- Cancelled: ${stats.cancelled}
- Completion Rate: ${stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%

Please provide:
1. An overview of the week's productivity
2. Pattern analysis (busiest days, task distribution)
3. Achievements and areas of excellence
4. Areas that need improvement
5. Specific recommendations for next week
6. An encouraging closing message`;

        // Call Groq API
        const response = await groq.chat.completions.create({
            model: config.groq.model,
            messages: [
                { role: 'system', content: WEEKLY_SUMMARY_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 1500
        });

        const summary = response.choices[0].message.content;

        // Log successful generation
        await agentLogs.logSuccess(userId, agentLogs.ActionTypes.SUMMARY_WEEKLY_GENERATED, {
            taskCount: tasks.length,
            completionRate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
            tokenUsage: response.usage
        });

        logger.info(`Generated weekly summary in ${Date.now() - startTime}ms`, {
            userId,
            taskCount: tasks.length
        });

        return {
            summary,
            tasks: tasks.map(t => ({
                id: t.id,
                title: t.title,
                status: t.status,
                deadline: formatInTimezone(new Date(t.deadline), tz, 'EEEE, HH:mm')
            })),
            stats,
            dateRange: {
                start: formatInTimezone(startOfWeek, tz, 'yyyy-MM-dd'),
                end: formatInTimezone(endOfWeek, tz, 'yyyy-MM-dd')
            },
            generatedAt: new Date().toISOString()
        };

    } catch (error) {
        await agentLogs.logFailure(userId, agentLogs.ActionTypes.SUMMARY_FAILED, error.message, {
            type: 'weekly'
        });

        logger.error('Failed to generate weekly summary', {
            error: error.message,
            userId
        });

        // Return a fallback summary instead of failing
        return {
            summary: "📊 I couldn't generate your weekly summary right now. Review your task list to see your progress this week, and remember - every step forward counts! 🌟",
            error: 'Summary generation temporarily unavailable',
            generatedAt: new Date().toISOString()
        };
    }
}

/**
 * Format tasks for LLM prompt
 * @param {Array} tasks - Array of task records
 * @param {string} timezone - User's timezone
 * @returns {string} Formatted task list
 */
function formatTasksForPrompt(tasks, timezone) {
    return tasks.map((task, index) => {
        const deadline = new Date(task.deadline);
        const formattedDeadline = formatInTimezone(deadline, timezone, 'EEEE, MMM d \'at\' HH:mm');
        const statusEmoji = getStatusEmoji(task.status);

        return `${index + 1}. ${statusEmoji} "${task.title}" - Due: ${formattedDeadline} (${task.status})`;
    }).join('\n');
}

/**
 * Group tasks by day of the week
 * @param {Array} tasks - Array of task records
 * @param {string} timezone - User's timezone
 * @returns {Object} Tasks grouped by day
 */
function groupTasksByDay(tasks, timezone) {
    const grouped = {};

    for (const task of tasks) {
        const deadline = new Date(task.deadline);
        const dayKey = formatInTimezone(deadline, timezone, 'EEEE');

        if (!grouped[dayKey]) {
            grouped[dayKey] = [];
        }
        grouped[dayKey].push(task);
    }

    return grouped;
}

/**
 * Format daily breakdown for prompt
 * @param {Object} tasksByDay - Tasks grouped by day
 * @returns {string} Formatted breakdown
 */
function formatDailyBreakdown(tasksByDay) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    return days
        .filter(day => tasksByDay[day])
        .map(day => {
            const dayTasks = tasksByDay[day];
            const completed = dayTasks.filter(t => t.status === 'completed').length;
            return `- ${day}: ${dayTasks.length} tasks (${completed} completed)`;
        })
        .join('\n');
}

/**
 * Get emoji for task status
 * @param {string} status - Task status
 * @returns {string} Status emoji
 */
function getStatusEmoji(status) {
    const emojiMap = {
        'pending': '⏳',
        'in_progress': '🔄',
        'completed': '✅',
        'cancelled': '❌'
    };
    return emojiMap[status] || '📋';
}

module.exports = {
    generateDailySummary,
    generateWeeklySummary
};

/**
 * Calendar Routes
 * HTTP route handlers for the Calendar and Task Management Agent.
 * 
 * Endpoints:
 * POST   /calendar/connect-google     - Initiate Google OAuth flow
 * POST   /calendar/oauth/callback     - Handle OAuth callback
 * POST   /calendar/tasks              - Create a new study task
 * GET    /calendar/tasks/today        - Get today's tasks
 * GET    /calendar/tasks/week         - Get this week's tasks
 * POST   /calendar/sync               - Sync tasks to Google Calendar/Tasks
 * POST   /calendar/summary/daily      - Generate daily summary
 * POST   /calendar/summary/weekly     - Generate weekly summary
 * 
 * ARCHITECTURE NOTE:
 * Routes handle HTTP only (validation, response formatting).
 * Business logic is delegated to services.
 * 
 * TODO: Add request validation middleware (Joi/Zod)
 * TODO: Add rate limiting per endpoint
 * TODO: Add OpenAPI/Swagger documentation
 * TODO: Add response compression for summaries
 */

const express = require('express');
const router = express.Router();

const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate, requireGoogleIntegration } = require('../middleware/auth');

// Services
const googleOAuth = require('../services/googleOAuth');
const taskManager = require('../services/taskManager');
const summaryGenerator = require('../services/summaryGenerator');
const chatService = require('../services/chatService');
const agentLogs = require('../db/helpers/agentLogs');
const { getCurrentDateInTimezone } = require('../utils/timezone');

const logger = require('../utils/logger');

// =============================================================================
// Google OAuth Endpoints
// =============================================================================

/**
 * POST /calendar/connect-google
 * Initiate Google OAuth 2.0 flow
 * 
 * Headers:
 *   X-User-Id: user's UUID
 * 
 * Response:
 *   { authUrl: string, state: string }
 */
router.post('/connect-google', authenticate, asyncHandler(async (req, res) => {
    const { userId } = req;

    logger.info('Initiating Google OAuth flow', { userId });

    // Generate OAuth URL
    const { url, state } = googleOAuth.generateAuthUrl(userId);

    // Log OAuth initiation
    await agentLogs.logSuccess(userId, agentLogs.ActionTypes.OAUTH_INITIATED);

    res.json({
        success: true,
        data: {
            authUrl: url,
            state,
            message: 'Redirect user to authUrl to connect their Google account'
        }
    });
}));

/**
 * POST /calendar/oauth/callback
 * Handle OAuth callback after user authorization
 * 
 * Body:
 *   { code: string, state: string }
 * 
 * NOTE: In a real implementation, this would typically be a GET endpoint
 * that Google redirects to. For API-only use, we use POST with the code.
 */
router.post('/oauth/callback', asyncHandler(async (req, res) => {
    const { code, state } = req.body;

    if (!code) {
        throw new AppError('Authorization code is required', 400);
    }

    if (!state) {
        throw new AppError('State parameter is required', 400);
    }

    logger.info('Processing OAuth callback (POST)');

    // Exchange code for tokens
    const { userId } = await googleOAuth.exchangeCodeForTokens(code, state);

    res.json({
        success: true,
        data: {
            message: 'Google account connected successfully',
            userId
        }
    });
}));

/**
 * GET /calendar/oauth/callback
 * Handle OAuth callback redirect from Google
 * 
 * Query params:
 *   code: string - Authorization code from Google
 *   state: string - State parameter for validation
 *   scope: string - Granted scopes
 * 
 * This endpoint handles the actual browser redirect from Google.
 * It exchanges the code for tokens and displays a success page.
 */
router.get('/oauth/callback', asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;

    // Handle OAuth errors (user denied access, etc.)
    if (error) {
        logger.warn('OAuth error received', { error });
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Connection Failed - Mentora</title>
                <style>
                    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .container { text-align: center; padding: 40px; }
                    h1 { color: #ef4444; margin-bottom: 16px; }
                    p { color: #a1a1aa; margin-bottom: 24px; }
                    .btn { background: #18181b; color: #fafafa; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block; }
                    .btn:hover { background: #27272a; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Connection Failed</h1>
                    <p>Error: ${error}</p>
                    <a href="javascript:window.close()" class="btn">Close Window</a>
                </div>
            </body>
            </html>
        `);
    }

    if (!code) {
        throw new AppError('Authorization code is required', 400);
    }

    if (!state) {
        throw new AppError('State parameter is required', 400);
    }

    logger.info('Processing OAuth callback (GET redirect)');

    try {
        // Exchange code for tokens
        const { userId } = await googleOAuth.exchangeCodeForTokens(code, state);

        logger.info('OAuth completed successfully', { userId });

        // Send success HTML page
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Connected! - Mentora</title>
                <style>
                    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .container { text-align: center; padding: 40px; }
                    h1 { color: #22c55e; margin-bottom: 16px; }
                    p { color: #a1a1aa; margin-bottom: 24px; }
                    .btn { background: #18181b; color: #fafafa; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block; }
                    .btn:hover { background: #27272a; }
                    .icon { font-size: 48px; margin-bottom: 16px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="icon">✅</div>
                    <h1>Google Account Connected!</h1>
                    <p>Your Google Calendar and Tasks are now linked to Mentora.</p>
                    <p>You can close this window and return to the app.</p>
                    <a href="javascript:window.close()" class="btn">Close Window</a>
                </div>
                <script>
                    // Auto-close after 3 seconds
                    setTimeout(() => { window.close(); }, 3000);
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        logger.error('OAuth callback failed', { error: err.message });

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Connection Failed - Mentora</title>
                <style>
                    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .container { text-align: center; padding: 40px; }
                    h1 { color: #ef4444; margin-bottom: 16px; }
                    p { color: #a1a1aa; margin-bottom: 24px; }
                    .btn { background: #18181b; color: #fafafa; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block; }
                    .btn:hover { background: #27272a; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Connection Failed</h1>
                    <p>${err.message || 'An error occurred while connecting your Google account.'}</p>
                    <a href="javascript:window.close()" class="btn">Close Window</a>
                </div>
            </body>
            </html>
        `);
    }
}))

// =============================================================================
// Task Management Endpoints
// =============================================================================

/**
 * POST /calendar/tasks
 * Create a new study task
 * 
 * Headers:
 *   X-User-Id: user's UUID
 * 
 * Body:
 *   {
 *     title: string (required),
 *     description: string (optional),
 *     deadline: string (required, ISO datetime),
 *     timezone: string (required, IANA timezone)
 *   }
 * 
 * Query:
 *   syncToGoogle: boolean (optional, default: false)
 */
router.post('/tasks', authenticate, asyncHandler(async (req, res) => {
    const { userId } = req;
    const { title, description, deadline, timezone } = req.body;
    const syncToGoogle = req.query.syncToGoogle === 'true';

    // Validation
    // TODO: Replace with proper validation middleware
    if (!title || title.trim().length === 0) {
        throw new AppError('Task title is required', 400);
    }

    if (!deadline) {
        throw new AppError('Task deadline is required', 400);
    }

    if (!timezone) {
        throw new AppError('Timezone is required', 400);
    }

    logger.info('Creating new task', { userId, title, syncToGoogle });

    // Create task
    const task = await taskManager.createTask(userId, {
        title,
        description,
        deadline,
        timezone
    }, { syncToGoogle });

    res.status(201).json({
        success: true,
        data: task
    });
}));

/**
 * GET /calendar/tasks/today
 * Get today's tasks for the authenticated user
 * 
 * Headers:
 *   X-User-Id: user's UUID
 * 
 * Query:
 *   timezone: string (required, IANA timezone)
 */
router.get('/tasks/today', authenticate, asyncHandler(async (req, res) => {
    const { userId } = req;
    const { timezone } = req.query;

    if (!timezone) {
        throw new AppError('Timezone query parameter is required', 400);
    }

    logger.debug('Fetching today\'s tasks', { userId, timezone });

    const result = await taskManager.getTodayTasks(userId, timezone);

    res.json({
        success: true,
        data: {
            tasks: result.tasks,
            stats: result.stats,
            count: result.tasks.length,
            timezone
        }
    });
}));

/**
 * GET /calendar/tasks/week
 * Get this week's tasks for the authenticated user
 * 
 * Headers:
 *   X-User-Id: user's UUID
 * 
 * Query:
 *   timezone: string (required, IANA timezone)
 */
router.get('/tasks/week', authenticate, asyncHandler(async (req, res) => {
    const { userId } = req;
    const { timezone } = req.query;

    if (!timezone) {
        throw new AppError('Timezone query parameter is required', 400);
    }

    logger.debug('Fetching week\'s tasks', { userId, timezone });

    const result = await taskManager.getWeekTasks(userId, timezone);

    res.json({
        success: true,
        data: {
            tasks: result.tasks,
            stats: result.stats,
            dateRange: result.dateRange,
            count: result.tasks.length,
            timezone
        }
    });
}));

// =============================================================================
// Sync Endpoint
// =============================================================================

/**
 * POST /calendar/sync
 * Sync all unsynced tasks to Google Calendar and optionally Google Tasks
 * 
 * Headers:
 *   X-User-Id: user's UUID
 * 
 * Body:
 *   {
 *     syncToTasks: boolean (optional, default: false)
 *   }
 * 
 * NOTE: User must have connected their Google account first.
 * 
 * TODO: Move to async job for production (return job ID for polling)
 */
router.post('/sync',
    authenticate,
    asyncHandler(requireGoogleIntegration),
    asyncHandler(async (req, res) => {
        const { userId } = req;
        const { syncToTasks = false } = req.body;

        logger.info('Starting task sync', { userId, syncToTasks });

        // Perform sync
        // WARNING: This is synchronous - should be async job in production
        const result = await taskManager.syncAllTasks(userId, { syncToTasks });

        res.json({
            success: true,
            data: {
                synced: result.synced,
                failed: result.failed,
                tasks: result.tasks,
                message: result.failed > 0
                    ? `Synced ${result.synced} tasks, ${result.failed} failed`
                    : `Successfully synced ${result.synced} tasks`
            }
        });
    })
);

// =============================================================================
// Summary Endpoints
// =============================================================================

/**
 * POST /calendar/summary/daily
 * Generate a daily summary using Groq LLM
 * 
 * Headers:
 *   X-User-Id: user's UUID
 * 
 * Body:
 *   {
 *     timezone: string (required, IANA timezone)
 *   }
 */
router.post('/summary/daily', authenticate, asyncHandler(async (req, res) => {
    const { userId } = req;
    const { timezone } = req.body;

    if (!timezone) {
        throw new AppError('Timezone is required in request body', 400);
    }

    logger.info('Generating daily summary', { userId, timezone });

    const summary = await summaryGenerator.generateDailySummary(userId, timezone);

    res.json({
        success: true,
        data: summary
    });
}));

/**
 * POST /calendar/summary/weekly
 * Generate a weekly summary using Groq LLM
 * 
 * Headers:
 *   X-User-Id: user's UUID
 * 
 * Body:
 *   {
 *     timezone: string (required, IANA timezone)
 *   }
 */
router.post('/summary/weekly', authenticate, asyncHandler(async (req, res) => {
    const { userId } = req;
    const { timezone } = req.body;

    if (!timezone) {
        throw new AppError('Timezone is required in request body', 400);
    }

    logger.info('Generating weekly summary', { userId, timezone });

    const summary = await summaryGenerator.generateWeeklySummary(userId, timezone);

    res.json({
        success: true,
        data: summary
    });
}));

// =============================================================================
// Status Endpoints
// =============================================================================

/**
 * PATCH /calendar/tasks/:taskId/status
 * Update a task's status
 * 
 * Headers:
 *   X-User-Id: user's UUID
 * 
 * Body:
 *   {
 *     status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
 *   }
 */
router.patch('/tasks/:taskId/status', authenticate, asyncHandler(async (req, res) => {
    const { userId } = req;
    const { taskId } = req.params;
    const { status } = req.body;

    if (!status) {
        throw new AppError('Status is required', 400);
    }

    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
        throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    logger.info('Updating task status', { userId, taskId, status });

    const task = await taskManager.updateTaskStatus(userId, taskId, status);

    res.json({
        success: true,
        data: task
    });
}));

// =============================================================================
// Chat Endpoint (Natural Language Task Creation)
// =============================================================================

/**
 * POST /calendar/chat
 * Process natural language message and create task if intent is detected
 * 
 * Headers:
 *   X-User-Id: user's UUID
 * 
 * Body:
 *   {
 *     message: string (required) - User's natural language message
 *     timezone: string (required) - User's timezone
 *   }
 * 
 * Response:
 *   {
 *     type: 'task_created' | 'clarification' | 'general'
 *     message: string - AI response
 *     task?: object - Created task if type is 'task_created'
 *   }
 */
router.post('/chat', authenticate, asyncHandler(async (req, res) => {
    const { userId } = req;
    const { message, timezone, history = [] } = req.body;

    // Validation
    if (!message || message.trim().length === 0) {
        throw new AppError('Message is required', 400);
    }

    if (!timezone) {
        throw new AppError('Timezone is required', 400);
    }

    logger.info('Processing chat message', {
        userId,
        messageLength: message.length,
        timezone,
        historyLength: history.length
    });

    // Get current date in user's timezone
    const currentDate = getCurrentDateInTimezone(timezone);

    // Process message with LLM (passing history for context)
    const response = await chatService.processMessage(message, timezone, currentDate, history);

    // Handle task creation intent
    if (response.type === 'task_intent') {
        // Validate extracted task data
        const validation = chatService.validateTaskData(response.task);

        if (!validation.valid) {
            logger.warn('Invalid task data extracted', {
                errors: validation.errors,
                task: response.task
            });

            return res.json({
                success: true,
                data: {
                    type: 'clarification',
                    message: `I found some issues with the task information:\n${validation.errors.join('\n')}\n\nPlease provide the missing details.`
                }
            });
        }

        // Create the task
        try {
            const createdTask = await taskManager.createTask(userId, {
                title: response.task.title,
                description: response.task.description,
                deadline: `${response.task.date}T${response.task.time}:00`,
                timezone
            }, { syncToGoogle: false });

            // Log successful chat-based task creation
            await agentLogs.logSuccess(userId, agentLogs.ActionTypes.TASK_CREATED, {
                taskId: createdTask.id,
                title: createdTask.title,
                createdVia: 'chat',
                originalMessage: message
            });

            logger.info('Task created via chat', {
                userId,
                taskId: createdTask.id,
                title: createdTask.title
            });

            // Return success with task details
            return res.json({
                success: true,
                data: {
                    type: 'task_created',
                    message: `✅ **Task added to your calendar!**\n\n📚 **${createdTask.title}**\n📅 ${createdTask.deadlineFormatted}\n⏰ ${createdTask.deadlineRelative}${response.task.duration_minutes ? `\n⏱️ Duration: ${response.task.duration_minutes} minutes` : ''}\n\nYou can sync it to Google Calendar using the Sync button.`,
                    task: createdTask
                }
            });

        } catch (error) {
            logger.error('Failed to create task from chat', {
                error: error.message,
                userId,
                task: response.task
            });

            await agentLogs.logFailure(userId, agentLogs.ActionTypes.TASK_CREATED, error.message, {
                originalMessage: message
            });

            throw new AppError(`Failed to create task: ${error.message}`, 500);
        }
    }

    // Plain text response (clarification, general chat, etc.)
    res.json({
        success: true,
        data: {
            type: 'general',
            message: response.message
        }
    });
}));

module.exports = router;

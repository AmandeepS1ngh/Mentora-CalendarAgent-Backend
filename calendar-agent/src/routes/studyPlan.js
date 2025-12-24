/**
 * Study Plan Routes
 * API endpoints for AI-powered study plan generation and application
 * 
 * ARCHITECTURE:
 * - POST /generate: Study Plan Agent generates curriculum
 * - POST /apply: Calendar Agent schedules tasks
 * - GET  /:id: Retrieve plan details
 * 
 * FLOW:
 * 1. User chats → /generate → Plan created (draft)
 * 2. Frontend shows plan preview
 * 3. User approves  → /apply → Tasks created by Calendar Agent
 */

const express = require('express');
const router = express.Router();
const studyPlanService = require('../services/studyPlanService');
const taskManager = require('../services/taskManager');
const studyPlansDb = require('../db/helpers/studyPlans');
const agentLogs = require('../db/helpers/agentLogs');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * POST /study-plan/generate
 * Generate a new study plan from user input
 * 
 * Body:
 * {
 *   "message": "I want to learn React in 3 weeks, 2 hours daily",
 *   "timezone": "Asia/Kolkata"
 * }
 * 
 * Response (plan generated):
 * {
 *   "success": true,
 *   "data": {
 *     "type": "plan_generated",
 *     "plan_id": "uuid",
 *     "plan": { ... },
 *     "message": "Study plan created successfully..."
 *   }
 * }
 * 
 * Response (clarification needed):
 * {
 *   "success": true,
 *   "data": {
 *     "type": "clarification",
 *     "message": "How many weeks do you have to learn?"
 *   }
 * }
 */
router.post('/generate', authenticate, asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { message, timezone } = req.body;

    logger.info('Study plan generation request', {
        userId,
        messageLength: message?.length,
        timezone
    });

    if (!message || message.trim().length === 0) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_INPUT',
                message: 'Message is required'
            }
        });
    }

    if (!message || message.trim().length === 0) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_INPUT',
                message: 'Message is required'
            }
        });
    }

    if (!timezone) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_INPUT',
                message: 'Timezone is required'
            }
        });
    }

    try {
        // Call Study Plan Agent to generate plan
        const result = await studyPlanService.generatePlan(message, userId, timezone);

        // Log generation
        if (result.type === 'plan_generated') {
            await agentLogs.logSuccess(userId, agentLogs.ActionTypes.STUDY_PLAN_GENERATED, {
                planId: result.planId,
                goal: result.plan.goal,
                totalDays: result.plan.total_days
            });
        }

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        logger.error('Study plan generation failed', {
            error: error.message,
            userId
        });

        await agentLogs.logFailure(
            userId,
            agentLogs.ActionTypes.STUDY_PLAN_FAILED,
            error.message
        );

        res.status(500).json({
            success: false,
            error: {
                code: 'GENERATION_FAILED',
                message: error.message
            }
        });
    }
}));

/**
 * POST /study-plan/apply
 * Apply a study plan to calendar (creates dated tasks)
 * 
 * ARCHITECTURE NOTE:
 * This hands off to the Calendar Agent (taskManager.applyStudyPlan)
 * which converts the plan into scheduled tasks.
 * 
 * Body:
 * {
 *   "plan_id": "uuid",
 *   "timezone": "Asia/Kolkata",
 *   "options": {  // Optional
 *     "start_date": "2025-12-20",
 *     "preferred_time": "09:00"
 *   }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "tasks_created": 28,
 *     "start_date": "2025-12-20",
 *     "end_date": "2026-01-17",
 *     "plan": { ... }
 *   }
 * }
 */
router.post('/apply', authenticate, asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { plan_id, timezone, options = {} } = req.body;

    logger.info('Study plan application request', {
        userId,
        planId: plan_id,
        timezone
    });

    if (!plan_id) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_INPUT',
                message: 'Plan ID is required'
            }
        });
    }

    if (!plan_id) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_INPUT',
                message: 'Plan ID is required'
            }
        });
    }

    if (!timezone) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'INVALID_INPUT',
                message: 'Timezone is required'
            }
        });
    }

    try {
        // Delegate to Calendar Agent
        const result = await taskManager.applyStudyPlan(userId, plan_id, timezone, {
            startDate: options.start_date,
            preferredTime: options.preferred_time
        });

        res.json({
            success: true,
            data: {
                tasks_created: result.tasksCreated,
                start_date: result.startDate,
                end_date: result.endDate,
                plan: result.plan,
                errors: result.errors
            }
        });

    } catch (error) {
        logger.error('Study plan application failed', {
            error: error.message,
            userId,
            planId: plan_id
        });

        // Determine appropriate status code
        let statusCode = 500;
        if (error.message.includes('not found')) {
            statusCode = 404;
        } else if (error.message.includes('Unauthorized')) {
            statusCode = 403;
        } else if (error.message.includes('already been applied')) {
            statusCode = 409; // Conflict
        }

        res.status(statusCode).json({
            success: false,
            error: {
                code: 'APPLICATION_FAILED',
                message: error.message
            }
        });
    }
}));

/**
 * GET /study-plan/:id
 * Get study plan details by ID
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "uuid",
 *     "goal": "Master React",
 *     "plan": { ... },
 *     "status": "draft",
 *     "created_at": "...",
 *     "applied_at": null
 *   }
 * }
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;

    logger.debug('Study plan fetch request', {
        userId,
        planId: id
    });

    const plan = await studyPlansDb.getStudyPlan(id);

    if (!plan) {
        return res.status(404).json({
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: 'Study plan not found'
            }
        });
    }

    // Check ownership
    if (plan.user_id !== userId) {
        return res.status(403).json({
            success: false,
            error: {
                code: 'FORBIDDEN',
                message: 'You do not have access to this study plan'
            }
        });
    }

    res.json({
        success: true,
        data: {
            id: plan.id,
            goal: plan.goal,
            plan: plan.plan_json,
            status: plan.status,
            created_at: plan.created_at,
            applied_at: plan.applied_at
        }
    });
}));

/**
 * GET /study-plan/user/plans
 * Get all study plans for the authenticated user
 * 
 * Query params:
 * - status: Filter by status (draft | applied | cancelled)
 * - limit: Max results (default: 50)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "plans": [ ... ],
 *     "count": 10
 *   }
 * }
 */
router.get('/user/plans', authenticate, asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { status, limit } = req.query;

    logger.debug('User plans fetch request', {
        userId,
        status,
        limit
    });

    const plans = await studyPlansDb.getUserPlans(userId, {
        status,
        limit: limit ? parseInt(limit) : 50
    });

    res.json({
        success: true,
        data: {
            plans: plans.map(plan => ({
                id: plan.id,
                goal: plan.goal,
                status: plan.status,
                total_days: plan.plan_json.total_days,
                daily_time_minutes: plan.plan_json.daily_time_minutes,
                created_at: plan.created_at,
                applied_at: plan.applied_at
            })),
            count: plans.length
        }
    });
}));

module.exports = router;

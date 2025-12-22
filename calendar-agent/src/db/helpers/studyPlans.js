/**
 * Study Plans Database Helpers
 * Supabase interaction layer for study_plans table
 * 
 * IMPORTANT: This helper handles DB operations only.
 * Business logic lives in studyPlanService.js
 */

const supabase = require('../supabase');
const logger = require('../../utils/logger');

/**
 * Create a new study plan (draft state)
 * 
 * @param {Object} planData - Study plan data
 * @param {string} planData.userId - User ID
 * @param {string} planData.goal - Learning goal description
 * @param {Object} planData.planJson - Structured plan from LLM
 * @returns {Promise<Object>} Created plan with ID
 */
async function createStudyPlan(planData) {
    const { userId, goal, planJson } = planData;

    logger.info('Creating study plan', { userId, goal });

    const { data, error } = await supabase
        .from('study_plans')
        .insert([
            {
                user_id: userId,
                goal,
                plan_json: planJson,
                status: 'draft'
            }
        ])
        .select()
        .single();

    if (error) {
        logger.error('Failed to create study plan', { error: error.message, userId });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info('Study plan created successfully', { planId: data.id, userId });
    return data;
}

/**
 * Get study plan by ID
 * 
 * @param {string} planId - Plan UUID
 * @returns {Promise<Object|null>} Plan object or null if not found
 */
async function getStudyPlan(planId) {
    logger.debug('Fetching study plan', { planId });

    const { data, error } = await supabase
        .from('study_plans')
        .select('*')
        .eq('id', planId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            // Not found
            logger.warn('Study plan not found', { planId });
            return null;
        }
        logger.error('Failed to fetch study plan', { error: error.message, planId });
        throw new Error(`Database error: ${error.message}`);
    }

    return data;
}

/**
 * Get all study plans for a user
 * 
 * @param {string} userId - User UUID
 * @param {Object} options - Query options
 * @param {string} options.status - Filter by status (optional)
 * @param {number} options.limit - Max results (default: 50)
 * @returns {Promise<Array>} Array of study plans
 */
async function getUserPlans(userId, options = {}) {
    const { status, limit = 50 } = options;

    logger.debug('Fetching user study plans', { userId, status, limit });

    let query = supabase
        .from('study_plans')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (status) {
        query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
        logger.error('Failed to fetch user plans', { error: error.message, userId });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.debug('Fetched user plans', { userId, count: data.length });
    return data;
}

/**
 * Update study plan status
 * 
 * @param {string} planId - Plan UUID
 * @param {string} status - New status ('draft' | 'applied' | 'cancelled')
 * @returns {Promise<Object>} Updated plan
 */
async function updatePlanStatus(planId, status) {
    logger.info('Updating plan status', { planId, status });

    const updateData = {
        status,
        ...(status === 'applied' && { applied_at: new Date().toISOString() })
    };

    const { data, error } = await supabase
        .from('study_plans')
        .update(updateData)
        .eq('id', planId)
        .select()
        .single();

    if (error) {
        logger.error('Failed to update plan status', { error: error.message, planId });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info('Plan status updated', { planId, status });
    return data;
}

/**
 * Delete a study plan
 * 
 * @param {string} planId - Plan UUID
 * @param {string} userId - User ID (for security)
 * @returns {Promise<boolean>} Success status
 */
async function deleteStudyPlan(planId, userId) {
    logger.info('Deleting study plan', { planId, userId });

    const { error } = await supabase
        .from('study_plans')
        .delete()
        .eq('id', planId)
        .eq('user_id', userId);

    if (error) {
        logger.error('Failed to delete study plan', { error: error.message, planId });
        throw new Error(`Database error: ${error.message}`);
    }

    logger.info('Study plan deleted', { planId });
    return true;
}

module.exports = {
    createStudyPlan,
    getStudyPlan,
    getUserPlans,
    updatePlanStatus,
    deleteStudyPlan
};

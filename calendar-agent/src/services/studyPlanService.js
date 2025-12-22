/**
 * Study Plan Service
 * Handles AI-powered study plan generation using Groq LLM
 * 
 * ARCHITECTURE NOTE:
 * This service generates study plans but DOES NOT create tasks.
 * Task creation is delegated to the Calendar Agent (taskManager.js).
 * 
 * FLOW:
 * 1. User provides learning goal via chat
 * 2. LLM generates structured study plan (JSON)
 * 3. Plan stored in DB with status='draft'
 * 4. User reviews plan in frontend
 * 5. User approves → Calendar Agent creates tasks
 * 
 * TODO: Add plan templates for common goals
 * TODO: Add progress tracking integration
 * TODO: Add adaptive difficulty based on user performance
 */

const Groq = require('groq-sdk');
const config = require('../config');
const logger = require('../utils/logger');
const studyPlansDb = require('../db/helpers/studyPlans');

// Initialize Groq client
const groq = new Groq({
    apiKey: config.groq.apiKey
});

/**
 * System prompt for study plan generation
 * Defines the schema and rules for the LLM
 */
const STUDY_PLAN_SYSTEM_PROMPT = `You are a personalized study planning assistant for Mentora, an AI-powered learning platform.

Your job is to create structured, effective study plans based on user learning goals.

CRITICAL RULES:
1. If the user wants a study plan, return ONLY valid JSON (no markdown, no explanation, no code blocks).
2. Do NOT create calendar tasks - you only design the learning curriculum.
3. Do NOT guess daily availability - ALWAYS ask if not explicitly specified.
4. Do NOT include specific dates or times - only day numbers and session durations.
5. If ANY of these are missing, ask a clarification question in plain text:
   - Exact timeline (days/weeks/months)
   - Daily time commitment (in hours or minutes)
   - Current skill level or prerequisites
6. NEVER infer or assume missing information - always ask first.
7. Be friendly, encouraging, and educational in your responses.

WHEN TO ASK FOR CLARIFICATION:
- User says "I want to learn X" without timeline → ASK for duration
- User says "in 2 weeks" without daily time → ASK for daily hours
- User says "2 hours daily" without timeline → ASK for total duration
- User gives vague timeline like "soon" or "quickly" → ASK for specific weeks/days

STUDY PLAN JSON SCHEMA (use this EXACT structure):
{
  "intent": "generate_study_plan",
  "plan": {
    "goal": "string - clear description of learning objective",
    "total_days": number,
    "daily_time_minutes": number,
    "learning_strategy": ["spaced_repetition", "pomodoro", "active_recall", "feynman_technique"],
    "schedule": [
      {
        "day": number (1 to total_days),
        "topic": "string - what to study this day",
        "sessions": number (how many study sessions),
        "session_duration_minutes": number,
        "notes": "string or null - study tips, focus areas"
      }
    ]
  }
}

LEARNING STRATEGIES EXPLAINED:
- "spaced_repetition": Review topics at increasing intervals
- "pomodoro": 25-minute focused sessions with 5-minute breaks
- "active_recall": Practice retrieving information from memory
- "feynman_technique": Explain concepts in simple terms

EXAMPLE INPUTS & OUTPUTS:

Example 1 - COMPLETE INFO (Generate Plan):
Input: "I want to prepare for DSA interviews in 4 weeks, I can study 2 hours daily"

Output:
{
  "intent": "generate_study_plan",
  "plan": {
    "goal": "Master Data Structures and Algorithms for technical interviews",
    "total_days": 28,
    "daily_time_minutes": 120,
    "learning_strategy": ["spaced_repetition", "active_recall"],
    "schedule": [
      {
        "day": 1,
        "topic": "Arrays and Strings - Two Pointer Technique",
        "sessions": 2,
        "session_duration_minutes": 60,
        "notes": "Practice 5 easy problems, focus on pattern recognition"
      },
      {
        "day": 2,
        "topic": "Arrays - Sliding Window Problems",
        "sessions": 2,
        "session_duration_minutes": 60,
        "notes": "Build on yesterday's concepts, 3 medium problems"
      },
      {
        "day": 3,
        "topic": "Linked Lists - Basics and Reversal",
        "sessions": 2,
        "session_duration_minutes": 60,
        "notes": "Understand node manipulation, practice pointer operations"
      }
    ]
  }
}

Example 2 - MISSING TIMELINE (Ask Question):
Input: "I want to learn React"

Output (plain text):
"Great! I'd love to help you learn React. To create the best study plan for you, I need a few more details:

1. How many weeks or days do you have to learn React?
2. How much time can you dedicate daily (e.g., 1 hour, 2 hours)?
3. Do you have JavaScript experience, or should we start from basics?

Let me know these details and I'll create a personalized plan!"

Example 3 - MISSING DAILY TIME (Ask Question):
Input: "I have to learn trees in DSA"

Output (plain text):
"I can help you master Trees in DSA! To create an effective study plan, I need to know:

1. How many days or weeks do you have for this topic?
2. How much time can you study daily (in hours)?

For example, you could say: 'I have 2 weeks and can study 1.5 hours daily'

Once I know your timeline and daily commitment, I'll create a complete day-by-day plan!"

Example 4 - MISSING DAILY TIME (Ask Question):
Input: "Learn machine learning in 2 months"

Output (plain text):
"Excellent goal! To create an effective ML study plan, please tell me:

1. How much time can you study daily (in hours)?
2. What's your Python and math background?
3. Any specific ML topics you're most interested in (e.g., deep learning, NLP, computer vision)?

This will help me tailor the plan to your level and interests!"

Example 5 - VAGUE TIMELINE (Ask Question):
Input: "I want to master System Design quickly"

Output (plain text):
"I'd love to help you master System Design! However, 'quickly' means different things to different people. Could you please specify:

1. Exactly how many weeks or months do you have?
2. How many hours per day can you dedicate to studying?

For example: '6 weeks with 2 hours daily' or '3 months with 1 hour daily'

This will help me create a realistic and effective plan!"

IMPORTANT GUIDELINES:
- Break complex topics into digestible daily chunks
- Include revision days for spaced repetition
- Balance theory and practice (roughly 40% theory, 60% hands-on)
- Start easy, gradually increase difficulty
- Include "milestone" days to consolidate knowledge
- If timeline is aggressive (e.g., 30 days for complex topic), warn the user but still create the plan
- For multi-month plans, include weekly review sessions

TOPIC PROGRESSION BEST PRACTICES:
- Build on previous concepts (dependencies matter)
- Introduce one major concept per day
- Revisit difficult topics multiple times
- Include project/application days to solidify learning

Always be realistic but encouraging in your plans.`;

/**
 * Generate a study plan from user input
 * 
 * @param {string} message - User's request (e.g., "I want to learn React in 3 weeks")
 * @param {string} userId - User UUID
 * @param {string} timezone - User timezone (for context, not dates)
 * @returns {Promise<Object>} Response with plan or clarification question
 */
async function generatePlan(message, userId, timezone) {
    const startTime = Date.now();

    logger.info('Generating study plan', {
        userId,
        messageLength: message.length,
        timezone
    });

    try {
        // Call Groq LLM with study plan prompt
        const response = await groq.chat.completions.create({
            model: config.groq.model,
            messages: [
                {
                    role: 'system',
                    content: STUDY_PLAN_SYSTEM_PROMPT
                },
                {
                    role: 'user',
                    content: `User timezone: ${timezone}\n\nUser request: ${message}`
                }
            ],
            temperature: 0.2, // Lower temperature for more deterministic behavior
            max_tokens: 2048
        });

        const aiResponse = response.choices[0].message.content.trim();

        logger.debug('LLM response received', {
            responseLength: aiResponse.length,
            latencyMs: Date.now() - startTime
        });

        // Try to parse as JSON (plan generation)
        let parsedResponse;
        let isValidJSON = false;

        try {
            // Robust JSON extraction - find actual JSON bounds
            let jsonString = aiResponse.trim();

            // Remove markdown code blocks
            jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '');

            // Find the first { and last }
            const firstBrace = jsonString.indexOf('{');
            const lastBrace = jsonString.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                // Extract only the JSON portion
                jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                parsedResponse = JSON.parse(jsonString);
                isValidJSON = true;

                logger.debug('JSON parsed successfully', {
                    intent: parsedResponse.intent,
                    hasPlan: !!parsedResponse.plan
                });
            }
        } catch (parseError) {
            // JSON parsing failed - it's plain text
            logger.debug('JSON parsing failed - treating as clarification', { error: parseError.message });
            isValidJSON = false;
        }

        // If we successfully parsed JSON and it's a study plan
        if (isValidJSON && parsedResponse.intent === 'generate_study_plan' && parsedResponse.plan) {
            logger.info('Valid study plan JSON detected');

            // Validate the plan structure
            const validation = validatePlan(parsedResponse.plan);
            if (!validation.valid) {
                logger.warn('Plan validation failed', { errors: validation.errors });
                return {
                    type: 'clarification',
                    message: `I generated a plan but found some issues:\n${validation.errors.join('\n')}\n\nCould you provide more specific details?`
                };
            }

            logger.info('Validation passed, storing in database...');

            // Store plan in database (draft state)
            const storedPlan = await studyPlansDb.createStudyPlan({
                userId,
                goal: parsedResponse.plan.goal,
                planJson: parsedResponse.plan
            });

            logger.info('Stored in database', { planId: storedPlan.id });

            // Return plan with ID for frontend
            const result = {
                type: 'plan_generated',
                planId: storedPlan.id,
                plan: parsedResponse.plan,
                message: formatPlanSummary(parsedResponse.plan)
            };

            logger.info('Returning plan_generated response', { planId: result.planId });
            return result;
        }

        // If we got here, it's a clarification (plain text or invalid JSON)
        logger.debug('Returning clarification response');
        return {
            type: 'clarification',
            message: aiResponse
        };

    } catch (error) {
        logger.error('Study plan generation failed', {
            error: error.message,
            userId,
            message: message.substring(0, 100)
        });
        throw new Error(`Failed to generate plan: ${error.message}`);
    }
}

/**
 * Validate study plan structure
 * 
 * @param {Object} plan - Plan object to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function validatePlan(plan) {
    const errors = [];

    // Required fields
    if (!plan.goal || plan.goal.trim().length === 0) {
        errors.push('Goal is required');
    }

    if (!plan.total_days || typeof plan.total_days !== 'number' || plan.total_days <= 0) {
        errors.push('Total days must be a positive number');
    }

    if (!plan.daily_time_minutes || typeof plan.daily_time_minutes !== 'number' || plan.daily_time_minutes <= 0) {
        errors.push('Daily time must be a positive number');
    }

    if (!Array.isArray(plan.learning_strategy) || plan.learning_strategy.length === 0) {
        errors.push('At least one learning strategy is required');
    }

    if (!Array.isArray(plan.schedule) || plan.schedule.length === 0) {
        errors.push('Schedule must contain at least one day');
    }

    // Validate schedule entries
    if (plan.schedule) {
        plan.schedule.forEach((day, index) => {
            if (!day.day || typeof day.day !== 'number') {
                errors.push(`Day ${index + 1}: day number is required`);
            }
            if (!day.topic || day.topic.trim().length === 0) {
                errors.push(`Day ${index + 1}: topic is required`);
            }
            if (!day.sessions || typeof day.sessions !== 'number' || day.sessions <= 0) {
                errors.push(`Day ${index + 1}: sessions must be a positive number`);
            }
            if (!day.session_duration_minutes || typeof day.session_duration_minutes !== 'number') {
                errors.push(`Day ${index + 1}: session duration is required`);
            }
        });
    }

    // Check schedule length matches total_days
    if (plan.schedule && plan.total_days && plan.schedule.length !== plan.total_days) {
        errors.push(`Schedule has ${plan.schedule.length} days but total_days is ${plan.total_days}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Format plan summary for chat display
 * 
 * @param {Object} plan - Study plan object
 * @returns {string} Formatted summary message
 */
function formatPlanSummary(plan) {
    const strategies = plan.learning_strategy.join(', ');

    return `📚 **Study Plan Created!**

**Goal:** ${plan.goal}
⏱️ **Duration:** ${plan.total_days} days
🕐 **Daily Time:** ${plan.daily_time_minutes} minutes (${Math.floor(plan.daily_time_minutes / 60)}h ${plan.daily_time_minutes % 60}m)
🎯 **Strategies:** ${strategies}

**Plan Highlights:**
• Day 1: ${plan.schedule[0].topic}
• Day ${Math.floor(plan.total_days / 2)}: ${plan.schedule[Math.floor(plan.total_days / 2) - 1]?.topic || plan.schedule[Math.floor(plan.total_days / 2)]?.topic}
• Day ${plan.total_days}: ${plan.schedule[plan.total_days - 1].topic}

This plan has been saved. Review it and click "Add to Calendar" when you're ready to start!`;
}

module.exports = {
    generatePlan,
    validatePlan
};

/**
 * Chat Service
 * Handles natural language task creation using Groq LLM.
 * 
 * User can say things like:
 * - "Tomorrow at 7pm, I need to study React hooks for 2 hours"
 * - "Add a task to review Node.js concepts next Monday at 3pm"
 * 
 * The LLM extracts structured task information and validates it.
 * 
 * IMPORTANT: We do NOT let the LLM decide dates/times silently.
 * If information is missing, we ask for clarification.
 * 
 * TODO: Add conversation history support
 * TODO: Add support for task queries ("What tasks do I have tomorrow?")
 * TODO: Add support for task updates via chat
 */

const Groq = require('groq-sdk');
const config = require('../config');
const logger = require('../utils/logger');
const { parseRelativeDate } = require('../utils/timezone');

// Initialize Groq client
const groq = new Groq({
    apiKey: config.groq.apiKey
});

/**
 * System prompt for the chat agent
 * This defines how the LLM should behave and extract task information
 */
const CHAT_SYSTEM_PROMPT = `You are a calendar and task management agent for Mentora, a study platform.

Your job is to extract structured task information from user messages.

IMPORTANT: You will receive the CURRENT DATE AND TIME context with each message. Use this to correctly interpret relative dates like "tomorrow", "today", "next Monday", etc.

RULES:
1. If the user wants to create a task, return ONLY valid JSON (no markdown, no explanation).
2. Do NOT add tasks yourself or guess missing information.
3. For relative dates like "tomorrow", use the EXACT date provided in the context (e.g., if tomorrow is 2025-12-23, use "2025-12-23").
4. If date or time is missing, ask for clarification.
5. If the user is just chatting or asking questions, respond normally in plain text.
6. Be friendly, encouraging, and helpful.

TASK CREATION SCHEMA:
When extracting a task, return this exact JSON structure:
{
  "intent": "create_task",
  "task": {
    "title": "string (required)",
    "description": "string or null",
    "date": "YYYY-MM-DD (required) - use the actual date, not keywords",
    "time": "HH:MM in 24-hour format (required)",
    "duration_minutes": number or null
  }
}

EXAMPLES:

If today is December 22, 2025 and user says: "Tomorrow at 7pm, I need to study React hooks for 2 hours"
Response:
{
  "intent": "create_task",
  "task": {
    "title": "Study React hooks",
    "description": "Practice React hooks concepts",
    "date": "2025-12-23",
    "time": "19:00",
    "duration_minutes": 120
  }
}

User: "Add a task to review DSA"
Response: "I'd be happy to help! When would you like to schedule this task? Please provide a date and time."

If today is December 22, 2025 (Sunday) and user says: "Next Monday at 3pm, complete the PBL project"
Response:
{
  "intent": "create_task",
  "task": {
    "title": "Complete PBL project",
    "description": null,
    "date": "2025-12-29",
    "time": "15:00",
    "duration_minutes": null
  }
}

IMPORTANT NOTES:
- ALWAYS use the actual YYYY-MM-DD date format in your response, not keywords like "TOMORROW".
- Calculate the correct date based on the context provided (today's date, tomorrow's date, etc.).
- Always use 24-hour time format (e.g., "19:00" not "7pm").
- Extract the task title concisely but preserve key information.
- If duration is mentioned, extract it in minutes.
- If user says "2pm to 4pm", that means 2 hours duration (120 minutes) starting at 14:00.`;

/**
 * Process a chat message and extract task intent
 * 
 * @param {string} message - User's chat message
 * @param {string} timezone - User's timezone (IANA format)
 * @param {string} currentDate - Current date in user's timezone (YYYY-MM-DD)
 * @param {Array} history - Previous conversation messages (optional, max 20)
 * @returns {Promise<Object>} Parsed response with intent and task data or plain text
 */
async function processMessage(message, timezone, currentDate, history = []) {
    const startTime = Date.now();

    // Get current time in user's timezone
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    const currentDayOfWeek = now.toLocaleDateString('en-US', {
        timeZone: timezone,
        weekday: 'long'
    });
    const currentDateFormatted = now.toLocaleDateString('en-US', {
        timeZone: timezone,
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });

    // Calculate tomorrow's date
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];
    const tomorrowFormatted = tomorrow.toLocaleDateString('en-US', {
        timeZone: timezone,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });

    logger.info('Processing chat message', {
        messageLength: message.length,
        timezone,
        currentDate,
        currentTime,
        historyLength: history.length
    });

    // Build context-aware user message with date/time info
    const contextMessage = `CURRENT DATE & TIME CONTEXT:
- Today is: ${currentDayOfWeek}, ${currentDateFormatted}
- Current date (YYYY-MM-DD): ${currentDate}
- Current time: ${currentTime}
- User timezone: ${timezone}
- Tomorrow is: ${tomorrowFormatted}
- Tomorrow's date (YYYY-MM-DD): ${tomorrowDate}

USER MESSAGE: ${message}`;

    // Build messages array with history
    const messagesArray = [
        {
            role: 'system',
            content: CHAT_SYSTEM_PROMPT
        },
        // Include conversation history for context (limited to last 20 messages)
        ...history.slice(-20).map(h => ({
            role: h.role,
            content: h.content
        })),
        {
            role: 'user',
            content: contextMessage
        }
    ];

    try {
        // Call Groq LLM with the system prompt and history
        const response = await groq.chat.completions.create({
            model: config.groq.model,
            messages: messagesArray,
            temperature: 0.3, // Lower temperature for more consistent parsing
            max_tokens: 1024
        });

        const aiResponse = response.choices[0].message.content.trim();

        logger.debug('LLM response received', {
            responseLength: aiResponse.length,
            latencyMs: Date.now() - startTime
        });

        // Try to parse as JSON (task creation intent)
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(aiResponse);

            // Validate it's a task creation intent
            if (parsedResponse.intent === 'create_task' && parsedResponse.task) {
                logger.info('Task creation intent detected', {
                    title: parsedResponse.task.title,
                    date: parsedResponse.task.date
                });

                // Resolve relative dates to actual dates
                const resolvedTask = await resolveTaskDates(
                    parsedResponse.task,
                    timezone,
                    currentDate
                );

                return {
                    type: 'task_intent',
                    task: resolvedTask,
                    originalResponse: aiResponse
                };
            }
        } catch (parseError) {
            // Not JSON - it's a plain text response (asking for clarification, etc.)
            logger.debug('Response is plain text (not task creation)');
        }

        // Plain text response (clarification question, casual chat, etc.)
        return {
            type: 'text',
            message: aiResponse
        };

    } catch (error) {
        logger.error('Chat processing failed', {
            error: error.message,
            message: message.substring(0, 100)
        });
        throw new Error(`Failed to process message: ${error.message}`);
    }
}

/**
 * Resolve relative dates (TOMORROW, NEXT_MONDAY, etc.) to actual dates
 * 
 * @param {Object} task - Task object with potentially relative dates
 * @param {string} timezone - User's timezone
 * @param {string} currentDate - Current date (YYYY-MM-DD)
 * @returns {Object} Task with resolved dates
 */
async function resolveTaskDates(task, timezone, currentDate) {
    let resolvedDate = task.date;

    // Check if date is a relative keyword
    if (task.date && typeof task.date === 'string') {
        const upperDate = task.date.toUpperCase();

        // Handle relative date keywords
        if (upperDate === 'TODAY') {
            resolvedDate = currentDate;
        } else if (upperDate === 'TOMORROW' || upperDate.includes('TOMORROW')) {
            resolvedDate = parseRelativeDate('tomorrow', timezone, currentDate);
        } else if (upperDate.includes('NEXT_MONDAY')) {
            resolvedDate = parseRelativeDate('next monday', timezone, currentDate);
        } else if (upperDate.includes('NEXT_TUESDAY')) {
            resolvedDate = parseRelativeDate('next tuesday', timezone, currentDate);
        } else if (upperDate.includes('NEXT_WEDNESDAY')) {
            resolvedDate = parseRelativeDate('next wednesday', timezone, currentDate);
        } else if (upperDate.includes('NEXT_THURSDAY')) {
            resolvedDate = parseRelativeDate('next thursday', timezone, currentDate);
        } else if (upperDate.includes('NEXT_FRIDAY')) {
            resolvedDate = parseRelativeDate('next friday', timezone, currentDate);
        } else if (upperDate.includes('NEXT_SATURDAY')) {
            resolvedDate = parseRelativeDate('next saturday', timezone, currentDate);
        } else if (upperDate.includes('NEXT_SUNDAY')) {
            resolvedDate = parseRelativeDate('next sunday', timezone, currentDate);
        } else if (upperDate.includes('NEXT_WEEK')) {
            resolvedDate = parseRelativeDate('next week', timezone, currentDate);
        }

        logger.debug('Resolved relative date', {
            original: task.date,
            resolved: resolvedDate,
            timezone
        });
    }

    return {
        ...task,
        date: resolvedDate
    };
}

/**
 * Validate extracted task data
 * 
 * @param {Object} task - Task object to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function validateTaskData(task) {
    const errors = [];

    // Required fields
    if (!task.title || task.title.trim().length === 0) {
        errors.push('Task title is required');
    }

    if (!task.date || !/^\d{4}-\d{2}-\d{2}$/.test(task.date)) {
        errors.push('Valid date is required (YYYY-MM-DD)');
    }

    if (!task.time || !/^\d{2}:\d{2}$/.test(task.time)) {
        errors.push('Valid time is required (HH:MM)');
    }

    // Optional fields validation
    if (task.duration_minutes !== null && task.duration_minutes !== undefined) {
        if (typeof task.duration_minutes !== 'number' || task.duration_minutes <= 0) {
            errors.push('Duration must be a positive number');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    processMessage,
    validateTaskData
};

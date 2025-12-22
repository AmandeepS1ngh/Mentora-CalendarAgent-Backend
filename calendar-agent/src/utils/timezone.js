/**
 * Timezone Utility
 * Handles timezone operations using Luxon for reliable timezone handling.
 * 
 * IMPORTANT: All timestamps should be stored in UTC in the database.
 * Timezone conversion happens at the API boundary (input/output).
 * 
 * TODO: Add timezone validation
 * TODO: Add caching for frequently used timezones
 * TODO: Add support for recurring events with DST handling
 */

const { DateTime } = require('luxon');
const config = require('../config');
const logger = require('./logger');

/**
 * Validate if a timezone string is valid
 * @param {string} timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns {boolean} Whether the timezone is valid
 */
function isValidTimezone(timezone) {
    try {
        const dt = DateTime.now().setZone(timezone);
        return dt.isValid;
    } catch (error) {
        return false;
    }
}

/**
 * Get the start of today in a specific timezone, returned as UTC
 * @param {string} timezone - User's timezone
 * @returns {Date} Start of today in UTC
 */
function getStartOfTodayUTC(timezone = config.timezone.default) {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;
    const startOfDay = DateTime.now()
        .setZone(tz)
        .startOf('day')
        .toUTC();

    return startOfDay.toJSDate();
}

/**
 * Get the end of today in a specific timezone, returned as UTC
 * @param {string} timezone - User's timezone
 * @returns {Date} End of today in UTC
 */
function getEndOfTodayUTC(timezone = config.timezone.default) {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;
    const endOfDay = DateTime.now()
        .setZone(tz)
        .endOf('day')
        .toUTC();

    return endOfDay.toJSDate();
}

/**
 * Get the start of the current week in a specific timezone, returned as UTC
 * Week starts on Monday (ISO week)
 * @param {string} timezone - User's timezone
 * @returns {Date} Start of week in UTC
 */
function getStartOfWeekUTC(timezone = config.timezone.default) {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;
    const startOfWeek = DateTime.now()
        .setZone(tz)
        .startOf('week')  // Monday in Luxon
        .toUTC();

    return startOfWeek.toJSDate();
}

/**
 * Get the end of the current week in a specific timezone, returned as UTC
 * Week ends on Sunday (ISO week)
 * @param {string} timezone - User's timezone
 * @returns {Date} End of week in UTC
 */
function getEndOfWeekUTC(timezone = config.timezone.default) {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;
    const endOfWeek = DateTime.now()
        .setZone(tz)
        .endOf('week')  // Sunday in Luxon
        .toUTC();

    return endOfWeek.toJSDate();
}

/**
 * Parse a datetime string with timezone context
 * The input datetime is interpreted in the given timezone and converted to UTC
 * 
 * @param {string} dateTimeStr - ISO datetime string or relative date
 * @param {string} timezone - User's timezone
 * @returns {Date} UTC Date object
 * 
 * IMPORTANT: We do NOT let AI decide timestamps. 
 * The frontend must provide explicit datetime strings.
 */
function parseToUTC(dateTimeStr, timezone = config.timezone.default) {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;

    // Parse the datetime string in the user's timezone
    const dt = DateTime.fromISO(dateTimeStr, { zone: tz });

    if (!dt.isValid) {
        logger.warn('Invalid datetime string provided', { dateTimeStr, timezone });
        throw new Error(`Invalid datetime format: ${dateTimeStr}`);
    }

    // Convert to UTC and return as JavaScript Date
    return dt.toUTC().toJSDate();
}

/**
 * Format a UTC date for display in a specific timezone
 * @param {Date} utcDate - UTC Date object
 * @param {string} timezone - Target timezone for display
 * @param {string} format - Luxon format string
 * @returns {string} Formatted date string
 */
function formatInTimezone(utcDate, timezone = config.timezone.default, format = 'yyyy-MM-dd HH:mm:ss') {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;

    const dt = DateTime.fromJSDate(utcDate, { zone: 'UTC' })
        .setZone(tz);

    return dt.toFormat(format);
}

/**
 * Get ISO string representation of a deadline for Google Calendar
 * @param {Date} utcDate - UTC Date object
 * @param {string} timezone - User's timezone
 * @returns {Object} Object with dateTime and timeZone for Google Calendar API
 */
function toGoogleDateTime(utcDate, timezone = config.timezone.default) {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;

    const dt = DateTime.fromJSDate(utcDate, { zone: 'UTC' })
        .setZone(tz);

    return {
        dateTime: dt.toISO(),
        timeZone: tz
    };
}

/**
 * Get human-readable relative time (e.g., "in 2 hours", "tomorrow")
 * @param {Date} utcDate - UTC Date object
 * @param {string} timezone - User's timezone
 * @returns {string} Relative time string
 */
function getRelativeTime(utcDate, timezone = config.timezone.default) {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;

    const dt = DateTime.fromJSDate(utcDate, { zone: 'UTC' })
        .setZone(tz);

    return dt.toRelative();
}

/**
 * Parse relative date strings to actual dates
 * Used by chat service to resolve "tomorrow", "next monday", etc.
 * 
 * @param {string} relativeDate - Relative date string (e.g., "tomorrow", "next monday")
 * @param {string} timezone - User's timezone
 * @param {string} currentDate - Current date in YYYY-MM-DD format
 * @returns {string} Resolved date in YYYY-MM-DD format
 */
function parseRelativeDate(relativeDate, timezone = config.timezone.default, currentDate = null) {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;

    // Start from current date in user's timezone
    let baseDate;
    if (currentDate) {
        baseDate = DateTime.fromISO(currentDate, { zone: tz });
    } else {
        baseDate = DateTime.now().setZone(tz);
    }

    const lowerDate = relativeDate.toLowerCase().trim();

    // Handle "today"
    if (lowerDate === 'today') {
        return baseDate.toFormat('yyyy-MM-dd');
    }

    // Handle "tomorrow"
    if (lowerDate === 'tomorrow') {
        return baseDate.plus({ days: 1 }).toFormat('yyyy-MM-dd');
    }

    // Handle "next week"
    if (lowerDate === 'next week') {
        return baseDate.plus({ weeks: 1 }).startOf('week').toFormat('yyyy-MM-dd');
    }

    // Handle "next [day of week]"
    const dayOfWeekMatch = lowerDate.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (dayOfWeekMatch) {
        const targetDay = dayOfWeekMatch[1];
        const dayMap = {
            'monday': 1,
            'tuesday': 2,
            'wednesday': 3,
            'thursday': 4,
            'friday': 5,
            'saturday': 6,
            'sunday': 7
        };

        const targetDayNumber = dayMap[targetDay];
        const currentDayNumber = baseDate.weekday;

        let daysToAdd;
        if (targetDayNumber > currentDayNumber) {
            // Same week
            daysToAdd = targetDayNumber - currentDayNumber;
        } else {
            // Next week
            daysToAdd = 7 - currentDayNumber + targetDayNumber;
        }

        return baseDate.plus({ days: daysToAdd }).toFormat('yyyy-MM-dd');
    }

    // If we can't parse it, return as-is (might already be YYYY-MM-DD)
    return relativeDate;
}

/**
 * Get current date in user's timezone
 * @param {string} timezone - User's timezone
 * @returns {string} Current date in YYYY-MM-DD format
 */
function getCurrentDateInTimezone(timezone = config.timezone.default) {
    const tz = isValidTimezone(timezone) ? timezone : config.timezone.default;
    return DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
}

module.exports = {
    isValidTimezone,
    getStartOfTodayUTC,
    getEndOfTodayUTC,
    getStartOfWeekUTC,
    getEndOfWeekUTC,
    parseToUTC,
    formatInTimezone,
    toGoogleDateTime,
    getRelativeTime,
    parseRelativeDate,
    getCurrentDateInTimezone
};

/**
 * Supabase Database Client
 * Initializes the Supabase client for database operations.
 * 
 * TODO: Add connection pooling for high-traffic scenarios
 * TODO: Add retry logic for transient failures
 * TODO: Add database health check endpoint
 * TODO: Consider using service role key for server-side operations
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('../utils/logger');

// Initialize Supabase client
// TODO: Consider using service role key for server-side operations with RLS bypass
const supabase = createClient(
    config.supabase.url,
    config.supabase.anonKey
);

logger.info('Supabase client initialized', {
    url: config.supabase.url?.substring(0, 30) + '...'
});

module.exports = supabase;

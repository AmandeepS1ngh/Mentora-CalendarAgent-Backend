/**
 * Configuration Module
 * Loads and validates environment variables for the Calendar Agent.
 * 
 * TODO: Add schema validation using Joi or Zod for production
 * TODO: Add support for different environments (dev, staging, prod)
 * TODO: Add secrets management integration (AWS Secrets Manager, etc.)
 */

require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Required environment variables
const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'GROQ_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please check your .env file or environment configuration');

    // In production, exit immediately if required vars are missing
    if (isProduction) {
        console.error('FATAL: Cannot start in production mode with missing environment variables');
        process.exit(1);
    } else {
        console.warn('⚠️ Running in development mode - some features may not work');
    }
}

const config = {
    // Server settings
    port: parseInt(process.env.PORT, 10) || 3001,
    nodeEnv: process.env.NODE_ENV || 'development',

    // Supabase settings
    supabase: {
        url: process.env.SUPABASE_URL,
        anonKey: process.env.SUPABASE_ANON_KEY
    },

    // Groq API settings (for summaries only)
    groq: {
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant'
    },

    // Google OAuth 2.0 settings
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
        // Scopes required for Calendar and Tasks API access
        scopes: [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/tasks'
        ]
    },

    // Timezone settings
    timezone: {
        default: process.env.DEFAULT_TIMEZONE || 'UTC'
    }
};

module.exports = config;

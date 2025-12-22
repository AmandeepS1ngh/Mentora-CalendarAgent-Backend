# Calendar and Task Management Agent (Agent 3.1)

## Overview

The Calendar and Task Management Agent is a production-style backend service for the Mentora platform. It enables users to:

- Connect their Google account via OAuth 2.0
- Create and manage study tasks with timezone-aware scheduling
- Sync tasks to Google Calendar (events) and optionally Google Tasks
- Generate AI-powered daily and weekly summaries using Groq

## Architecture

```
calendar-agent/
├── src/
│   ├── app.js                     # Express server entry point
│   ├── config/                    # Configuration management
│   ├── db/                        # Supabase database helpers
│   │   └── helpers/               # Per-table database operations
│   ├── middleware/                # Express middleware
│   ├── routes/                    # HTTP route handlers
│   ├── services/                  # Business logic layer
│   └── utils/                     # Utility functions
├── package.json
└── .env.example
```

## Principles

1. **Supabase is the System of Record** - Tasks are always stored in Supabase first, then synced to Google
2. **Fail Gracefully** - External API failures (Google, Groq) are logged but don't crash the system
3. **Synchronous by Design** - Intentionally sequential for simplicity; marked with TODOs for async optimization
4. **AI for Summaries Only** - Groq is used exclusively for generating summaries and feedback, not for task scheduling

## Database Schema

This agent assumes the following tables exist in Supabase:

### `user_integrations`
```sql
CREATE TABLE user_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'google',
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expiry TIMESTAMPTZ,
    scopes TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider)
);
```

### `tasks`
```sql
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    deadline TIMESTAMPTZ NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    status VARCHAR(20) DEFAULT 'pending',
    google_calendar_event_id VARCHAR(255),
    google_task_id VARCHAR(255),
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_user_deadline ON tasks(user_id, deadline);
CREATE INDEX idx_tasks_status ON tasks(status);
```

### `agent_logs`
```sql
CREATE TABLE agent_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'success',
    details JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_logs_user ON agent_logs(user_id, created_at);
CREATE INDEX idx_agent_logs_action ON agent_logs(action);
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/calendar/connect-google` | Initiate Google OAuth flow |
| POST | `/calendar/oauth/callback` | Handle OAuth callback |
| POST | `/calendar/tasks` | Create a new study task |
| GET | `/calendar/tasks/today` | Get today's tasks |
| GET | `/calendar/tasks/week` | Get this week's tasks |
| POST | `/calendar/sync` | Sync tasks to Google Calendar/Tasks |
| POST | `/calendar/summary/daily` | Generate daily summary |
| POST | `/calendar/summary/weekly` | Generate weekly summary |

## Setup

1. Copy environment template:
   ```bash
   cp .env.example .env
   ```

2. Configure environment variables (see `.env.example`)

3. Install dependencies:
   ```bash
   npm install
   ```

4. Create database tables in Supabase (see Database Schema above)

5. Set up Google OAuth:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create OAuth 2.0 credentials
   - Enable Calendar API and Tasks API
   - Add authorized redirect URI

6. Start the server:
   ```bash
   npm run dev
   ```

## TODO / Scalability Notes

- **Async Jobs**: Replace sequential sync with background job queue (Bull/Agenda)
- **Batching**: Implement batch operations for Google API calls
- **Notifications**: Add push notifications for upcoming deadlines
- **Caching**: Add Redis caching for frequently accessed data
- **Rate Limiting**: Implement per-user rate limiting for Google API quota management
- **Webhooks**: Implement Google Calendar push notifications for real-time sync

## License

MIT

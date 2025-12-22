-- ============================================
-- Calendar Agent Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- User Integrations Table
-- Stores Google OAuth tokens for each user
-- ============================================
CREATE TABLE IF NOT EXISTS user_integrations (
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

-- Index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_user_integrations_user_provider 
ON user_integrations(user_id, provider);

-- ============================================
-- Tasks Table
-- Stores study tasks (source of truth)
-- ============================================
CREATE TABLE IF NOT EXISTS tasks (
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_user_deadline 
ON tasks(user_id, deadline);

CREATE INDEX IF NOT EXISTS idx_tasks_status 
ON tasks(status);

CREATE INDEX IF NOT EXISTS idx_tasks_user_status 
ON tasks(user_id, status);

-- ============================================
-- Agent Logs Table
-- Tracks all agent actions for observability
-- ============================================
CREATE TABLE IF NOT EXISTS agent_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'success',
    details JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for log queries
CREATE INDEX IF NOT EXISTS idx_agent_logs_user 
ON agent_logs(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_logs_action 
ON agent_logs(action);

CREATE INDEX IF NOT EXISTS idx_agent_logs_status 
ON agent_logs(status);

-- ============================================
-- Row Level Security (RLS) Policies
-- Uncomment these when using Supabase Auth
-- ============================================

-- Enable RLS on tables
-- ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;

-- Policies for user_integrations
-- CREATE POLICY "Users can view their own integrations"
--     ON user_integrations FOR SELECT
--     USING (auth.uid() = user_id);

-- CREATE POLICY "Users can insert their own integrations"
--     ON user_integrations FOR INSERT
--     WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update their own integrations"
--     ON user_integrations FOR UPDATE
--     USING (auth.uid() = user_id);

-- Policies for tasks
-- CREATE POLICY "Users can view their own tasks"
--     ON tasks FOR SELECT
--     USING (auth.uid() = user_id);

-- CREATE POLICY "Users can insert their own tasks"
--     ON tasks FOR INSERT
--     WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update their own tasks"
--     ON tasks FOR UPDATE
--     USING (auth.uid() = user_id);

-- CREATE POLICY "Users can delete their own tasks"
--     ON tasks FOR DELETE
--     USING (auth.uid() = user_id);

-- ============================================
-- Study Plans Table
-- Stores AI-generated study plans
-- ============================================
CREATE TABLE IF NOT EXISTS study_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    goal TEXT NOT NULL,
    plan_json JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    applied_at TIMESTAMPTZ,
    
    CONSTRAINT fk_study_plan_user FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Indexes for study plans
CREATE INDEX IF NOT EXISTS idx_study_plans_user 
ON study_plans(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_study_plans_status 
ON study_plans(status);

CREATE INDEX IF NOT EXISTS idx_study_plans_user_status 
ON study_plans(user_id, status);

-- RLS Policy for study_plans (commented for now)
-- ALTER TABLE study_plans ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view their own study plans"
--     ON study_plans FOR SELECT
--     USING (auth.uid() = user_id);

-- CREATE POLICY "Users can insert their own study plans"
--     ON study_plans FOR INSERT
--     WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update their own study plans"
--     ON study_plans FOR UPDATE
--     USING (auth.uid() = user_id);

-- ============================================
-- Success message
-- ============================================
SELECT 'Calendar Agent schema created successfully!' AS message;

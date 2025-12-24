-- ============================================
-- Calendar Agent RLS Policies
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable RLS on tables
ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plans ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Policies for user_integrations
-- ============================================
CREATE POLICY "user_integrations_select" ON user_integrations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_integrations_insert" ON user_integrations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_integrations_update" ON user_integrations
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "user_integrations_delete" ON user_integrations
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- Policies for tasks
-- ============================================
CREATE POLICY "tasks_select" ON tasks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "tasks_insert" ON tasks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tasks_update" ON tasks
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "tasks_delete" ON tasks
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- Policies for study_plans
-- ============================================
CREATE POLICY "study_plans_select" ON study_plans
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "study_plans_insert" ON study_plans
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "study_plans_update" ON study_plans
    FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
SELECT 'Calendar Agent RLS policies created!' AS message;

-- Remove the strict foreign key constraint to auth.users
-- This allows the application to work with the demo USER_ID ("550e8400-e29b-41d4-a716-446655440000")
-- without needing a real user record in Supabase Auth.

ALTER TABLE study_plans DROP CONSTRAINT IF EXISTS fk_study_plan_user;

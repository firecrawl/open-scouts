-- =============================================================================
-- AUTHENTICATION MIGRATION
-- Adds user_id columns and Row Level Security (RLS) policies
-- =============================================================================

-- Add user_id column to scouts table
ALTER TABLE scouts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id column to user_preferences table
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for faster user-based queries
CREATE INDEX IF NOT EXISTS idx_scouts_user_id ON scouts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- =============================================================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE scouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_execution_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for clean re-runs)
DROP POLICY IF EXISTS "Users can view their own scouts" ON scouts;
DROP POLICY IF EXISTS "Users can create their own scouts" ON scouts;
DROP POLICY IF EXISTS "Users can update their own scouts" ON scouts;
DROP POLICY IF EXISTS "Users can delete their own scouts" ON scouts;

DROP POLICY IF EXISTS "Users can view messages for their scouts" ON scout_messages;
DROP POLICY IF EXISTS "Users can create messages for their scouts" ON scout_messages;

DROP POLICY IF EXISTS "Users can view executions for their scouts" ON scout_executions;
DROP POLICY IF EXISTS "Users can create executions for their scouts" ON scout_executions;
DROP POLICY IF EXISTS "Users can update executions for their scouts" ON scout_executions;

DROP POLICY IF EXISTS "Users can view execution steps for their scouts" ON scout_execution_steps;
DROP POLICY IF EXISTS "Users can create execution steps for their scouts" ON scout_execution_steps;
DROP POLICY IF EXISTS "Users can update execution steps for their scouts" ON scout_execution_steps;

DROP POLICY IF EXISTS "Users can view their own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can create their own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can update their own preferences" ON user_preferences;

-- =============================================================================
-- SCOUTS TABLE POLICIES
-- =============================================================================
CREATE POLICY "Users can view their own scouts"
  ON scouts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own scouts"
  ON scouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scouts"
  ON scouts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scouts"
  ON scouts FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================================================
-- SCOUT MESSAGES TABLE POLICIES
-- =============================================================================
CREATE POLICY "Users can view messages for their scouts"
  ON scout_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM scouts
      WHERE scouts.id = scout_messages.scout_id
      AND scouts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create messages for their scouts"
  ON scout_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM scouts
      WHERE scouts.id = scout_messages.scout_id
      AND scouts.user_id = auth.uid()
    )
  );

-- =============================================================================
-- SCOUT EXECUTIONS TABLE POLICIES
-- =============================================================================
CREATE POLICY "Users can view executions for their scouts"
  ON scout_executions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM scouts
      WHERE scouts.id = scout_executions.scout_id
      AND scouts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create executions for their scouts"
  ON scout_executions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM scouts
      WHERE scouts.id = scout_executions.scout_id
      AND scouts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update executions for their scouts"
  ON scout_executions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM scouts
      WHERE scouts.id = scout_executions.scout_id
      AND scouts.user_id = auth.uid()
    )
  );

-- =============================================================================
-- SCOUT EXECUTION STEPS TABLE POLICIES
-- =============================================================================
CREATE POLICY "Users can view execution steps for their scouts"
  ON scout_execution_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM scout_executions
      JOIN scouts ON scouts.id = scout_executions.scout_id
      WHERE scout_executions.id = scout_execution_steps.execution_id
      AND scouts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create execution steps for their scouts"
  ON scout_execution_steps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM scout_executions
      JOIN scouts ON scouts.id = scout_executions.scout_id
      WHERE scout_executions.id = scout_execution_steps.execution_id
      AND scouts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update execution steps for their scouts"
  ON scout_execution_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM scout_executions
      JOIN scouts ON scouts.id = scout_executions.scout_id
      WHERE scout_executions.id = scout_execution_steps.execution_id
      AND scouts.user_id = auth.uid()
    )
  );

-- =============================================================================
-- USER PREFERENCES TABLE POLICIES
-- =============================================================================
CREATE POLICY "Users can view their own preferences"
  ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own preferences"
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own preferences"
  ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- =============================================================================
-- SERVICE ROLE BYPASS
-- The service role key bypasses RLS, allowing server-side operations
-- (like cron jobs and edge functions) to access all data
-- =============================================================================

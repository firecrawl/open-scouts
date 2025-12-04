-- =============================================================================
-- OPEN SCOUTS - COMPLETE DATABASE SCHEMA
-- Single consolidated migration representing the full current state
-- =============================================================================

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS vector;
-- Note: pg_cron and pg_net must be enabled via Supabase Dashboard

-- =============================================================================
-- SCOUTS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS scouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  goal TEXT,
  search_queries JSONB DEFAULT '[]'::jsonb,
  location JSONB, -- {city: string, latitude: number, longitude: number}
  frequency TEXT CHECK (frequency IN ('hourly', 'every_3_days', 'weekly')),
  is_active BOOLEAN DEFAULT false,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- SCOUT MESSAGES TABLE (conversation history)
-- =============================================================================
CREATE TABLE IF NOT EXISTS scout_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scout_id UUID REFERENCES scouts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- SCOUT EXECUTIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS scout_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scout_id UUID REFERENCES scouts(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  results_summary JSONB,
  summary_text TEXT, -- One-sentence AI-generated summary
  summary_embedding vector(1536), -- OpenAI text-embedding-3-small
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- SCOUT EXECUTION STEPS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS scout_execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES scout_executions(id) ON DELETE CASCADE NOT NULL,
  step_number INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('search', 'scrape', 'analyze', 'summarize', 'tool_call')),
  description TEXT NOT NULL,
  input_data JSONB,
  output_data JSONB,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- USER PREFERENCES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  -- User location (for scouts)
  location JSONB, -- {country, countryCode, state, stateCode, city, latitude, longitude}
  -- Firecrawl integration
  firecrawl_api_key TEXT,
  firecrawl_key_status TEXT DEFAULT 'pending'
    CHECK (firecrawl_key_status IN ('pending', 'active', 'fallback', 'failed', 'invalid')),
  firecrawl_key_created_at TIMESTAMP WITH TIME ZONE,
  firecrawl_key_error TEXT,
  -- Rate limiting
  last_test_email_at TIMESTAMP WITH TIME ZONE, -- For rate limiting test emails (2 min cooldown)
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON COLUMN user_preferences.location IS
'User''s default location for scouts. Structure:
{
  "country": "United States",
  "countryCode": "US",
  "state": "California",
  "stateCode": "CA",
  "city": "San Francisco",
  "latitude": 37.7749,
  "longitude": -122.4194
}';

COMMENT ON COLUMN user_preferences.firecrawl_key_status IS
'Status of the Firecrawl API key:
- pending: Key has not been created yet
- active: Key is valid and in use
- fallback: Using shared partner key (user key unavailable)
- failed: Key creation failed
- invalid: Key was invalidated (deleted by user or expired)';

-- =============================================================================
-- FIRECRAWL USAGE TRACKING TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS firecrawl_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  scout_id UUID REFERENCES scouts(id) ON DELETE SET NULL,
  execution_id UUID REFERENCES scout_executions(id) ON DELETE SET NULL,
  used_fallback BOOLEAN NOT NULL DEFAULT false,
  fallback_reason TEXT,
  api_calls_count INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_scouts_user_id ON scouts(user_id);
CREATE INDEX IF NOT EXISTS idx_scouts_updated_at ON scouts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scouts_is_active ON scouts(is_active);

CREATE INDEX IF NOT EXISTS idx_scout_messages_scout_id ON scout_messages(scout_id);

CREATE INDEX IF NOT EXISTS idx_scout_executions_scout_id ON scout_executions(scout_id);
CREATE INDEX IF NOT EXISTS idx_scout_executions_status ON scout_executions(status);
CREATE INDEX IF NOT EXISTS idx_scout_executions_started_at ON scout_executions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scout_executions_summary_embedding ON scout_executions
  USING hnsw (summary_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_scout_execution_steps_execution_id ON scout_execution_steps(execution_id);
CREATE INDEX IF NOT EXISTS idx_scout_execution_steps_step_number ON scout_execution_steps(step_number);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_firecrawl_status ON user_preferences(firecrawl_key_status)
  WHERE firecrawl_key_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_firecrawl_usage_user_id ON firecrawl_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_firecrawl_usage_created_at ON firecrawl_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_firecrawl_usage_fallback ON firecrawl_usage_logs(used_fallback)
  WHERE used_fallback = true;

-- =============================================================================
-- FUNCTIONS & TRIGGERS
-- =============================================================================

-- Update scouts.updated_at when a message is added
CREATE OR REPLACE FUNCTION update_scout_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE scouts SET updated_at = NOW() WHERE id = NEW.scout_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_scout_on_message ON scout_messages;
CREATE TRIGGER update_scout_on_message
  AFTER INSERT ON scout_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_scout_timestamp();

-- Update user_preferences.updated_at
CREATE OR REPLACE FUNCTION update_user_preferences_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_preferences_on_change ON user_preferences;
CREATE TRIGGER update_user_preferences_on_change
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_preferences_timestamp();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
ALTER TABLE scouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_execution_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE firecrawl_usage_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (for clean re-runs)
DROP POLICY IF EXISTS "Users can view their own scouts" ON scouts;
DROP POLICY IF EXISTS "Users can create their own scouts" ON scouts;
DROP POLICY IF EXISTS "Users can update their own scouts" ON scouts;
DROP POLICY IF EXISTS "Users can delete their own scouts" ON scouts;
DROP POLICY IF EXISTS "Users can view messages for their scouts" ON scout_messages;
DROP POLICY IF EXISTS "Users can create messages for their scouts" ON scout_messages;
DROP POLICY IF EXISTS "Users can view executions for their scouts" ON scout_executions;
DROP POLICY IF EXISTS "Users can create executions for their scouts" ON scout_executions;
DROP POLICY IF EXISTS "Users can update executions for their scouts" ON scout_executions;
DROP POLICY IF EXISTS "Users can delete executions for their scouts" ON scout_executions;
DROP POLICY IF EXISTS "Users can view execution steps for their scouts" ON scout_execution_steps;
DROP POLICY IF EXISTS "Users can create execution steps for their scouts" ON scout_execution_steps;
DROP POLICY IF EXISTS "Users can update execution steps for their scouts" ON scout_execution_steps;
DROP POLICY IF EXISTS "Users can view their own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can create their own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can update their own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users can view their own usage logs" ON firecrawl_usage_logs;

-- Scouts policies
CREATE POLICY "Users can view their own scouts"
  ON scouts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own scouts"
  ON scouts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own scouts"
  ON scouts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own scouts"
  ON scouts FOR DELETE USING (auth.uid() = user_id);

-- Scout messages policies
CREATE POLICY "Users can view messages for their scouts"
  ON scout_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM scouts WHERE scouts.id = scout_messages.scout_id AND scouts.user_id = auth.uid()
  ));
CREATE POLICY "Users can create messages for their scouts"
  ON scout_messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM scouts WHERE scouts.id = scout_messages.scout_id AND scouts.user_id = auth.uid()
  ));

-- Scout executions policies
CREATE POLICY "Users can view executions for their scouts"
  ON scout_executions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM scouts WHERE scouts.id = scout_executions.scout_id AND scouts.user_id = auth.uid()
  ));
CREATE POLICY "Users can create executions for their scouts"
  ON scout_executions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM scouts WHERE scouts.id = scout_executions.scout_id AND scouts.user_id = auth.uid()
  ));
CREATE POLICY "Users can update executions for their scouts"
  ON scout_executions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM scouts WHERE scouts.id = scout_executions.scout_id AND scouts.user_id = auth.uid()
  ));
CREATE POLICY "Users can delete executions for their scouts"
  ON scout_executions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM scouts WHERE scouts.id = scout_executions.scout_id AND scouts.user_id = auth.uid()
  ));

-- Scout execution steps policies
CREATE POLICY "Users can view execution steps for their scouts"
  ON scout_execution_steps FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM scout_executions
    JOIN scouts ON scouts.id = scout_executions.scout_id
    WHERE scout_executions.id = scout_execution_steps.execution_id AND scouts.user_id = auth.uid()
  ));
CREATE POLICY "Users can create execution steps for their scouts"
  ON scout_execution_steps FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM scout_executions
    JOIN scouts ON scouts.id = scout_executions.scout_id
    WHERE scout_executions.id = scout_execution_steps.execution_id AND scouts.user_id = auth.uid()
  ));
CREATE POLICY "Users can update execution steps for their scouts"
  ON scout_execution_steps FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM scout_executions
    JOIN scouts ON scouts.id = scout_executions.scout_id
    WHERE scout_executions.id = scout_execution_steps.execution_id AND scouts.user_id = auth.uid()
  ));

-- User preferences policies
CREATE POLICY "Users can view their own preferences"
  ON user_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own preferences"
  ON user_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own preferences"
  ON user_preferences FOR UPDATE USING (auth.uid() = user_id);

-- Firecrawl usage logs policies
CREATE POLICY "Users can view their own usage logs"
  ON firecrawl_usage_logs FOR SELECT USING (auth.uid() = user_id);

-- =============================================================================
-- SCOUT DISPATCHER FUNCTIONS (requires pg_cron and pg_net)
-- =============================================================================

-- Helper: Check if a scout should run based on frequency
CREATE OR REPLACE FUNCTION should_run_scout(
  p_frequency TEXT,
  p_last_run_at TIMESTAMP WITH TIME ZONE,
  p_is_active BOOLEAN,
  p_title TEXT,
  p_goal TEXT,
  p_description TEXT,
  p_location JSONB,
  p_search_queries JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  hours_since_last_run NUMERIC;
  is_complete BOOLEAN;
BEGIN
  is_complete := (
    p_title IS NOT NULL AND p_title != '' AND
    p_goal IS NOT NULL AND p_goal != '' AND
    p_description IS NOT NULL AND p_description != '' AND
    p_location IS NOT NULL AND
    p_search_queries IS NOT NULL AND jsonb_array_length(p_search_queries) > 0 AND
    p_frequency IS NOT NULL
  );

  IF NOT p_is_active OR NOT is_complete THEN
    RETURN FALSE;
  END IF;

  IF p_last_run_at IS NULL THEN
    RETURN TRUE;
  END IF;

  hours_since_last_run := EXTRACT(EPOCH FROM (NOW() - p_last_run_at)) / 3600;

  CASE p_frequency
    WHEN 'hourly' THEN RETURN hours_since_last_run >= 1;
    WHEN 'every_3_days' THEN RETURN hours_since_last_run >= 72;
    WHEN 'weekly' THEN RETURN hours_since_last_run >= 168;
    ELSE RETURN FALSE;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- Dispatcher: Triggers individual scout executions via HTTP
CREATE OR REPLACE FUNCTION dispatch_due_scouts()
RETURNS void AS $$
DECLARE
  scout_record RECORD;
  supabase_url TEXT;
  anon_key TEXT;
  request_id BIGINT;
  scouts_dispatched INT := 0;
  has_running_execution BOOLEAN;
BEGIN
  SELECT decrypted_secret INTO supabase_url
  FROM vault.decrypted_secrets WHERE name = 'project_url';

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF supabase_url IS NULL OR anon_key IS NULL THEN
    RAISE WARNING 'Vault secrets not configured for dispatcher';
    RETURN;
  END IF;

  FOR scout_record IN
    SELECT id, title FROM scouts
    WHERE should_run_scout(frequency, last_run_at, is_active, title, goal, description, location, search_queries)
    LIMIT 20
  LOOP
    -- Check if this scout already has a running execution
    SELECT EXISTS(
      SELECT 1 FROM scout_executions
      WHERE scout_id = scout_record.id AND status = 'running'
    ) INTO has_running_execution;

    IF has_running_execution THEN
      RAISE NOTICE 'Skipping scout % - already has running execution', scout_record.title;
      CONTINUE;
    END IF;

    SELECT net.http_post(
      url := supabase_url || '/functions/v1/scout-cron?scoutId=' || scout_record.id,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := jsonb_build_object('scoutId', scout_record.id)
    ) INTO request_id;

    scouts_dispatched := scouts_dispatched + 1;
  END LOOP;

  IF scouts_dispatched > 0 THEN
    RAISE NOTICE 'Dispatched % scouts', scouts_dispatched;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Cleanup: Handle stuck executions
CREATE OR REPLACE FUNCTION cleanup_scout_executions()
RETURNS void AS $$
DECLARE
  stuck_count INT;
BEGIN
  -- Mark executions as failed if running for more than 15 minutes
  -- (Agent can have up to 10 loops with 60s timeouts each, so 15 min is a safe upper bound)
  UPDATE scout_executions
  SET status = 'failed', completed_at = NOW(), error_message = 'Execution timed out after 15 minutes'
  WHERE status = 'running' AND started_at < NOW() - INTERVAL '15 minutes';

  GET DIAGNOSTICS stuck_count = ROW_COUNT;

  IF stuck_count > 0 THEN
    RAISE NOTICE 'Marked % stuck executions as failed', stuck_count;
  END IF;

  DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

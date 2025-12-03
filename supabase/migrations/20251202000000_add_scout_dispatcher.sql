-- =============================================================================
-- SCOUT DISPATCHER - Scalable Cron Architecture
-- Uses pg_cron + pg_net to trigger individual scout executions
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Grant usage to postgres role (required for pg_cron)
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- =============================================================================
-- HELPER FUNCTION: Check if a scout should run based on frequency
-- =============================================================================
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
  -- Check if scout configuration is complete
  is_complete := (
    p_title IS NOT NULL AND p_title != '' AND
    p_goal IS NOT NULL AND p_goal != '' AND
    p_description IS NOT NULL AND p_description != '' AND
    p_location IS NOT NULL AND
    p_search_queries IS NOT NULL AND jsonb_array_length(p_search_queries) > 0 AND
    p_frequency IS NOT NULL
  );

  -- Must be active and complete
  IF NOT p_is_active OR NOT is_complete THEN
    RETURN FALSE;
  END IF;

  -- Never run before = should run
  IF p_last_run_at IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Calculate hours since last run
  hours_since_last_run := EXTRACT(EPOCH FROM (NOW() - p_last_run_at)) / 3600;

  -- Check based on frequency
  CASE p_frequency
    WHEN 'hourly' THEN RETURN hours_since_last_run >= 1;
    WHEN 'every_3_days' THEN RETURN hours_since_last_run >= 72;
    WHEN 'weekly' THEN RETURN hours_since_last_run >= 168;
    ELSE RETURN FALSE;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- DISPATCHER FUNCTION: Triggers individual scout executions via HTTP
-- =============================================================================
CREATE OR REPLACE FUNCTION dispatch_due_scouts()
RETURNS void AS $$
DECLARE
  scout_record RECORD;
  supabase_url TEXT;
  anon_key TEXT;
  request_id BIGINT;
  scouts_dispatched INT := 0;
BEGIN
  -- Get secrets from vault
  SELECT decrypted_secret INTO supabase_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url';

  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key';

  -- Check if secrets are configured
  IF supabase_url IS NULL OR anon_key IS NULL THEN
    RAISE WARNING 'Vault secrets not configured. Run: SELECT vault.create_secret(''your-url'', ''project_url''); SELECT vault.create_secret(''your-key'', ''service_role_key'');';
    RETURN;
  END IF;

  -- Find and dispatch due scouts (limit to 20 per minute to avoid overwhelming)
  FOR scout_record IN
    SELECT id, title
    FROM scouts
    WHERE should_run_scout(
      frequency,
      last_run_at,
      is_active,
      title,
      goal,
      description,
      location,
      search_queries
    )
    LIMIT 20
  LOOP
    -- Fire async HTTP request to edge function for this scout
    SELECT net.http_post(
      url := supabase_url || '/functions/v1/scout-cron?scoutId=' || scout_record.id,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := jsonb_build_object('scoutId', scout_record.id)
    ) INTO request_id;

    scouts_dispatched := scouts_dispatched + 1;
    RAISE NOTICE 'Dispatched scout: % (id: %, request: %)', scout_record.title, scout_record.id, request_id;
  END LOOP;

  IF scouts_dispatched > 0 THEN
    RAISE NOTICE 'Total scouts dispatched: %', scouts_dispatched;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- CLEANUP FUNCTION: Handle stuck executions and inactive users
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_scout_executions()
RETURNS void AS $$
DECLARE
  stuck_count INT;
BEGIN
  -- Mark executions stuck for more than 5 minutes as failed
  UPDATE scout_executions
  SET
    status = 'failed',
    completed_at = NOW(),
    error_message = 'Execution timed out after 5 minutes'
  WHERE status = 'running'
    AND started_at < NOW() - INTERVAL '5 minutes';

  GET DIAGNOSTICS stuck_count = ROW_COUNT;

  IF stuck_count > 0 THEN
    RAISE NOTICE 'Marked % stuck executions as failed', stuck_count;
  END IF;

  -- Clean up old cron job run details (pg_cron table maintenance)
  -- Keep only last 24 hours of job history
  DELETE FROM cron.job_run_details
  WHERE end_time < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SCHEDULE CRON JOBS (using DO block for error handling)
-- =============================================================================

DO $$
BEGIN
  -- Remove old jobs if they exist (ignore errors if they don't exist)
  BEGIN
    PERFORM cron.unschedule('dispatch-scouts');
  EXCEPTION WHEN OTHERS THEN
    -- Job doesn't exist, that's fine
  END;

  BEGIN
    PERFORM cron.unschedule('cleanup-scouts');
  EXCEPTION WHEN OTHERS THEN
    -- Job doesn't exist, that's fine
  END;

  -- Schedule scout dispatcher to run every minute
  PERFORM cron.schedule(
    'dispatch-scouts',
    '* * * * *',
    'SELECT dispatch_due_scouts()'
  );

  -- Schedule cleanup to run every 5 minutes
  PERFORM cron.schedule(
    'cleanup-scouts',
    '*/5 * * * *',
    'SELECT cleanup_scout_executions()'
  );

  RAISE NOTICE 'Cron jobs scheduled successfully';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule cron jobs: %. You may need to run this in the SQL Editor.', SQLERRM;
END;
$$;

-- =============================================================================
-- SETUP INSTRUCTIONS (run manually after migration)
-- =============================================================================
-- You must configure the vault secrets for this to work:
--
-- 1. Enable the vault extension (if not already):
--    CREATE EXTENSION IF NOT EXISTS supabase_vault;
--
-- 2. Store your project URL:
--    SELECT vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
--
-- 3. Store your service role key (NOT anon key - we need service role for edge functions):
--    SELECT vault.create_secret('YOUR-SERVICE-ROLE-KEY', 'service_role_key');
--
-- To verify jobs are scheduled:
--    SELECT * FROM cron.job;
--
-- To check job run history:
--    SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- =============================================================================

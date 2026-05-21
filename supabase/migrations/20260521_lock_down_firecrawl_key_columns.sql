-- Restrict direct access to Firecrawl API key columns on user_preferences.
--
-- Background: a stolen browser session (e.g. via XSS) was previously able to
-- query user_preferences over PostgREST and read both the sponsored
-- firecrawl_api_key and the user-supplied firecrawl_custom_api_key. RLS limited
-- the row to the user's own row, but the key columns were still returned.
--
-- Postgres column-level revokes only take effect when the matching table-level
-- grant is also revoked first. We therefore drop table-level SELECT / INSERT /
-- UPDATE for the authenticated and anon roles, then re-grant access on every
-- column EXCEPT firecrawl_api_key and firecrawl_custom_api_key.
--
-- The service-role client (used by /api/firecrawl/* and /api/auth/callback)
-- has its own table-level grants and is unaffected; legitimate reads of the
-- key columns now go through those server endpoints, which return masked /
-- summary data only.

REVOKE SELECT, INSERT, UPDATE ON user_preferences FROM authenticated;
REVOKE SELECT, INSERT, UPDATE ON user_preferences FROM anon;

GRANT SELECT (
  id,
  user_id,
  location,
  firecrawl_key_status,
  firecrawl_key_created_at,
  firecrawl_key_error,
  last_test_email_at,
  created_at,
  updated_at
) ON user_preferences TO authenticated, anon;

GRANT INSERT (
  user_id,
  location,
  firecrawl_key_status,
  firecrawl_key_created_at,
  firecrawl_key_error
) ON user_preferences TO authenticated;

GRANT UPDATE (
  location,
  firecrawl_key_status,
  firecrawl_key_created_at,
  firecrawl_key_error,
  last_test_email_at,
  updated_at
) ON user_preferences TO authenticated;

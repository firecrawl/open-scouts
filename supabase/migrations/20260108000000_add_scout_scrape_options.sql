-- =============================================================================
-- ADD SCRAPE OPTIONS TO SCOUTS TABLE
-- Allows users to configure cookies, headers, and other scrape options per scout
-- =============================================================================

-- Add scrape_options column to scouts table
ALTER TABLE scouts ADD COLUMN IF NOT EXISTS scrape_options JSONB DEFAULT '{}'::jsonb;

-- Add comment explaining the structure
COMMENT ON COLUMN scouts.scrape_options IS
'Optional scrape configuration for Firecrawl API. Structure:
{
  "cookies": "session_id=abc123; auth_token=xyz789",
  "headers": {"Authorization": "Bearer token"},
  "waitFor": 2000,
  "timeout": 30000
}
- cookies: Cookie string to send with requests
- headers: Custom HTTP headers (key-value pairs)
- waitFor: Wait time in ms or CSS selector before scraping
- timeout: Request timeout in ms
';

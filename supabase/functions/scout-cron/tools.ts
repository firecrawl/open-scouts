// Firecrawl API tool implementations

import { isBlacklistedDomain } from "./constants.ts";

/**
 * Resolve the web-data API base URL (additive, optional).
 *
 * Because fastCRW is a Firecrawl-compatible web scraper (single binary;
 * self-host or cloud), the same raw fetch calls can target it by overriding the
 * base URL via CRW_API_URL (cloud default: https://fastcrw.com/api; self-host:
 * e.g. http://localhost:3000). When unset, the hard-coded Firecrawl URLs are
 * used and behavior is identical to before.
 */
function getApiBaseUrl(): string | null {
  return Deno.env.get("CRW_API_URL")?.replace(/\/+$/, "") || null;
}

/**
 * Resolve the API key to use for a request.
 *
 * The per-user key (custom > auto-generated, resolved upstream in helpers.ts and
 * passed in as `apiKey`) always takes priority. CRW_API_KEY from the environment
 * is only used as a fallback when no per-user key is provided, so existing
 * per-user key-priority logic is fully preserved.
 */
function resolveApiKey(apiKey: string): string {
  return apiKey || Deno.env.get("CRW_API_KEY") || "";
}

/**
 * Build the search endpoint URL. When CRW_API_URL is set, fastCRW exposes a
 * Firecrawl-compatible /v1/search; otherwise fall back to the hard-coded
 * Firecrawl v2 endpoint.
 */
function getSearchEndpoint(): string {
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}/v1/search` : "https://api.firecrawl.dev/v2/search";
}

/**
 * Build the scrape endpoint URL. When CRW_API_URL is set, fastCRW exposes a
 * Firecrawl-compatible /v1/scrape; otherwise fall back to the hard-coded
 * Firecrawl v2 endpoint.
 */
function getScrapeEndpoint(): string {
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}/v1/scrape` : "https://api.firecrawl.dev/v2/scrape";
}

// Execute web search using Firecrawl
export async function executeSearchTool(args: any, apiKey: string, location?: string, maxAge?: number) {
  try {
    const searchPayload: any = {
      query: args.query,
      limit: args.limit || 5,
      ignoreInvalidURLs: true, // Filter out URLs that can't be scraped (social media, etc.)
      scrapeOptions: {
        maxAge: maxAge || 3600000, // Default to 1 hour if not provided
      },
    };

    // Only add tbs if provided
    if (args.tbs) {
      searchPayload.tbs = args.tbs;
    }

    // Add location and country parameters for geo-targeting
    // According to Firecrawl API, for best results both should be set
    if (location) {
      // Format: "City,State,Country" (e.g., "San Francisco,California,United States")
      // For now, if we only have a city, append United States
      // NOTE: This assumes US-based searches. Future improvement: add country/state to database schema
      searchPayload.location = location.includes(',') ? location : `${location},United States`;
      searchPayload.country = "US"; // ISO country code
      console.log(`[Search] Using location: ${searchPayload.location}, country: ${searchPayload.country}`);
    }

    console.log(`[Search] Query: "${args.query}", Location: ${location || 'none'}, TBS: ${args.tbs || 'none'}`);

    // Add 60-second timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(getSearchEndpoint(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resolveApiKey(apiKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(searchPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firecrawl search failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    // V2 without scrapeOptions: response structure is { success: true, data: { web: [...], images: [...], news: [...] } }
    const webResults = data.data?.web || [];

    // Map results and filter out blacklisted domains
    const allResults = webResults.map((item: any) => ({
      title: item.title || item.url,
      url: item.url,
      description: item.description || "",
      markdown: item.description || "",
      publishedTime: item.publishedTime,
      favicon: item.favicon || null,
    }));

    // Filter out blacklisted domains (social media, etc.)
    const results = allResults.filter((item: any) => !isBlacklistedDomain(item.url));
    const filteredCount = allResults.length - results.length;

    if (filteredCount > 0) {
      console.log(`[Search] Filtered out ${filteredCount} blacklisted URLs from search results`);
    }

    return {
      query: args.query,
      count: results.length,
      results,
      searchResults: results, // For visual display component
      filteredCount, // Track how many were filtered for debugging
      maxAge: searchPayload.scrapeOptions.maxAge, // Show what maxAge was used
      location: searchPayload.location || null, // Show what location was used
      country: searchPayload.country || null, // Show what country was used
      tbs: searchPayload.tbs || null, // Show what time filter was used
    };
  } catch (error: any) {
    const errorMessage = error.name === 'AbortError'
      ? 'Search request timed out after 60 seconds'
      : error.message;
    return { error: errorMessage, query: args.query, results: [] };
  }
}

// Execute website scraping using Firecrawl
export async function executeScrapeTool(args: any, apiKey: string, maxAge?: number) {
  try {
    const scrapePayload: any = {
      url: args.url,
      formats: [
        "markdown",
        {
          type: "screenshot",
          fullPage: false
        }
      ],
      maxAge: maxAge || 3600000, // Default to 1 hour if not provided
    };

    // Add 60-second timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(getScrapeEndpoint(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resolveApiKey(apiKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(scrapePayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firecrawl scrape failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    // V2 response structure: data.data contains the scraped content
    const scrapedData = data.data || {};

    // Limit content to first 2000 characters to minimize data
    const content = (scrapedData.markdown || "").slice(0, 2000);

    return {
      url: args.url,
      title: scrapedData.metadata?.title || args.url,
      content,
      favicon: scrapedData.metadata?.ogImage || scrapedData.metadata?.favicon || null,
      screenshot: scrapedData.screenshot || null,
      maxAge: scrapePayload.maxAge, // Show what maxAge was used
    };
  } catch (error: any) {
    const errorMessage = error.name === 'AbortError'
      ? 'Scrape request timed out after 60 seconds'
      : error.message;
    return { error: errorMessage, url: args.url };
  }
}

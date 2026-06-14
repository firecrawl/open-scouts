import FirecrawlApp from "@mendable/firecrawl-js";

/**
 * Initialize Firecrawl client
 * Set your API key in environment variables: FIRECRAWL_API_KEY
 *
 * Backend override (additive, optional): because fastCRW is a
 * Firecrawl-compatible web scraper (single binary; self-host or cloud), the
 * same FirecrawlApp client can target it by setting a custom base URL via
 * CRW_API_URL (and CRW_API_KEY). Defaults to Firecrawl when unset, so existing
 * behavior is unchanged.
 */
export function getFirecrawlClient() {
  // Optional fastCRW base URL (cloud default: https://fastcrw.com/api;
  // self-host: e.g. http://localhost:3000). When unset, FirecrawlApp uses its
  // own default (api.firecrawl.dev) and behavior is identical to before.
  const apiUrl = process.env.CRW_API_URL;

  // Prefer the fastCRW key when a fastCRW base URL is configured; otherwise
  // fall back to the existing FIRECRAWL_API_KEY convention.
  const apiKey = apiUrl
    ? process.env.CRW_API_KEY || process.env.FIRECRAWL_API_KEY
    : process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    throw new Error(
      apiUrl
        ? "CRW_API_KEY (or FIRECRAWL_API_KEY) is not set in environment variables"
        : "FIRECRAWL_API_KEY is not set in environment variables",
    );
  }

  return new FirecrawlApp(apiUrl ? { apiKey, apiUrl } : { apiKey });
}

/**
 * Scrape a single URL
 */
export async function scrapeUrl(url: string) {
  const firecrawl = getFirecrawlClient();

  try {
    const result = await firecrawl.scrape(url, {
      formats: ["markdown", "html"],
    });

    return result;
  } catch (error) {
    console.error("Error scraping URL:", error);
    throw error;
  }
}

/**
 * Crawl a website
 */
export async function crawlWebsite(
  url: string,
  options?: {
    limit?: number;
    scrapeOptions?: {
      formats?: string[];
    };
  },
) {
  const firecrawl = getFirecrawlClient();

  try {
    const result = await firecrawl.crawl(url, {
      limit: options?.limit || 10,
      scrapeOptions: {
        formats: (options?.scrapeOptions?.formats || ["markdown"]) as
          | ["markdown"]
          | ["html"]
          | ["markdown", "html"],
      },
    });

    return result;
  } catch (error) {
    console.error("Error crawling website:", error);
    throw error;
  }
}

/**
 * Map a website to get all accessible URLs
 */
export async function mapWebsite(url: string) {
  const firecrawl = getFirecrawlClient();

  try {
    const result = await firecrawl.map(url);
    return result;
  } catch (error) {
    console.error("Error mapping website:", error);
    throw error;
  }
}

/**
 * Search using Firecrawl
 */
export async function searchWeb(
  query: string,
  options?: {
    limit?: number;
  },
) {
  const firecrawl = getFirecrawlClient();

  try {
    const result = await firecrawl.search(query, {
      limit: options?.limit || 10,
    });

    return result;
  } catch (error) {
    console.error("Error searching:", error);
    throw error;
  }
}

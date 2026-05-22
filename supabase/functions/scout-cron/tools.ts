// Firecrawl API tool implementations

import { isBlacklistedDomain } from "./constants.ts";

// Options for Firecrawl requests
export interface FirecrawlOptions {
  headers?: Record<string, string>;  // Custom headers including cookies
  cookies?: string;                   // Cookie string (convenience option)
  waitFor?: number | string;          // Wait for selector or time (ms)
  timeout?: number;                   // Request timeout in ms
}

// Execute web search using Firecrawl
export async function executeSearchTool(
  args: any,
  apiKey: string,
  location?: string,
  maxAge?: number,
  options?: FirecrawlOptions
) {
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

    // Add custom headers/cookies if provided
    if (options?.headers || options?.cookies) {
      searchPayload.scrapeOptions.headers = {
        ...options.headers,
        ...(options.cookies && { "Cookie": options.cookies }),
      };
    }

    // Add wait options if provided
    if (options?.waitFor) {
      searchPayload.scrapeOptions.waitFor = options.waitFor;
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

    const response = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
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
export async function executeScrapeTool(
  args: any,
  apiKey: string,
  maxAge?: number,
  options?: FirecrawlOptions
) {
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

    // Add custom headers/cookies if provided
    if (options?.headers || options?.cookies) {
      scrapePayload.headers = {
        ...options.headers,
        ...(options.cookies && { "Cookie": options.cookies }),
      };
    }

    // Add wait options if provided (wait for selector or time in ms)
    if (options?.waitFor) {
      scrapePayload.waitFor = options.waitFor;
    }

    // Add custom timeout if provided
    if (options?.timeout) {
      scrapePayload.timeout = options.timeout;
    }

    // Add 60-second timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
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

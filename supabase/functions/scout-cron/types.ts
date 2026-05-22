// Type definitions for Scout agent

export interface ScrapeOptions {
  cookies?: string;                   // Cookie string to send with requests
  headers?: Record<string, string>;   // Custom HTTP headers
  waitFor?: number | string;          // Wait time in ms or CSS selector
  timeout?: number;                   // Request timeout in ms
}

export interface Scout {
  id: string;
  user_id: string;
  title: string;
  description: string;
  goal: string;
  search_queries: string[];
  location: {
    city: string;
    latitude: number;
    longitude: number;
  } | null;
  frequency: "daily" | "every_3_days" | "weekly" | null;
  is_active: boolean;
  last_run_at: string | null;
  consecutive_failures: number;
  scrape_options?: ScrapeOptions;     // Optional scrape configuration
}

export type FirecrawlKeyStatus = "pending" | "active" | "fallback" | "failed" | "invalid";

export interface FirecrawlKeyResult {
  apiKey: string | null;
  usedFallback: boolean;
  fallbackReason?: string;
}

export interface ScoutResponse {
  taskCompleted: boolean;
  taskStatus: "completed" | "partial" | "not_found" | "insufficient_data";
  response: string;
}

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { tavily, type TavilyClient } from "@tavily/core";
import * as cheerio from "cheerio";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_CHARS = 15000;
const FETCH_TIMEOUT_MS = 12000;
const MAX_RETRIES = 2;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─────────────────────────────────────────────
// Tavily client — instantiated once at module level
// ─────────────────────────────────────────────

if (!process.env.TAVILY_API_KEY) {
  throw new Error("Missing required environment variable: TAVILY_API_KEY");
}

const tavilyClient: TavilyClient = tavily({
  apiKey: process.env.TAVILY_API_KEY,
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Strips HTML to clean readable text using cheerio.
 * Removes boilerplate (nav, footer, scripts, ads, etc.)
 */
function extractReadableText(html: string): string {
  const $ = cheerio.load(html);

  $(
    "script, style, noscript, iframe, nav, footer, header, " +
      "aside, form, button, [aria-hidden='true'], " +
      ".ad, .ads, .advertisement, .cookie-banner, .popup",
  ).remove();

  return $("body")
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Retries an async function up to `retries` times on transient failures.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
  delayMs: number = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((res) => setTimeout(res, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────
// Tool 1: Web Search
// ─────────────────────────────────────────────

export const webSearchTool = tool(
  async ({
    query,
    maxResults = DEFAULT_MAX_RESULTS,
    topic = "general",
    includeRawContent = false,
    searchDepth = "basic",
  }: {
    query: string;
    maxResults?: number;
    topic?: "general" | "news" | "finance";
    includeRawContent?: false | "markdown" | "text";
    searchDepth?: "basic" | "advanced";
  }) => {
    try {
      const response = await withRetry(() =>
        tavilyClient.search(query, {
          maxResults,
          topic,
          includeRawContent,
          searchDepth,
        }),
      );

      if (!response.results || response.results.length === 0) {
        return "No results found for this query. Try rephrasing or broadening it.";
      }

      // Return a clean, structured summary the agent can easily parse
      const formatted = response.results.map((r, i) => {
        const lines = [
          `[${i + 1}] ${r.title}`,
          `URL: ${r.url}`,
          `Score: ${r.score?.toFixed(2) ?? "N/A"}`,
          `Summary: ${r.content}`,
        ];
        if (includeRawContent && r.rawContent) {
          lines.push(`Raw: ${r.rawContent.slice(0, 500)}...`);
        }
        return lines.join("\n");
      });

      return formatted.join("\n\n---\n\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[webSearchTool] Error:", message);
      return `Search failed: ${message}. Try a different query or verify your TAVILY_API_KEY.`;
    }
  },
  {
    name: "internet_search",
    description:
      "Searches the internet for current or external information. Returns a ranked list of URLs, " +
      "titles, and content snippets. " +
      "Use this FIRST to discover relevant sources, then use web_fetch to read any page in full. " +
      "Best for: news, recent events, prices, laws, product specs, API docs, niche facts, " +
      "and anything requiring source links. " +
      "Use focused and specific queries. Set topic to 'news' for current events, " +
      "'finance' for market/financial data. Use searchDepth 'advanced' for complex research queries.",
    schema: z.object({
      query: z
        .string()
        .min(1)
        .describe("A focused and specific search query (1–10 words is ideal)."),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(DEFAULT_MAX_RESULTS)
        .describe("Number of results to return (1–10). Default is 5."),
      topic: z
        .enum(["general", "news", "finance"])
        .optional()
        .default("general")
        .describe(
          "Search category. 'news' for current events, 'finance' for market data, " +
            "'general' for everything else.",
        ),
      searchDepth: z
        .enum(["basic", "advanced"])
        .optional()
        .default("basic")
        .describe(
          "'basic' is fast and good for simple lookups. " +
            "'advanced' is slower but better for complex or research queries.",
        ),
      includeRawContent: z
        .union([z.literal(false), z.literal("markdown"), z.literal("text")])
        .optional()
        .default(false)
        .describe(
          "Include raw page content in results. false = disabled, " +
            "'text' = plain text, 'markdown' = formatted markdown. " +
            "Keep false unless you need full content without a separate web_fetch call.",
        ),
    }),
  },
);

// ─────────────────────────────────────────────
// Tool 2: Web Fetch
// ─────────────────────────────────────────────

export const webFetchTool = tool(
  async ({
    url,
    extractText = true,
    maxChars = DEFAULT_MAX_CHARS,
  }: {
    url: string;
    extractText?: boolean;
    maxChars?: number;
  }) => {
    try {
      const response = await withRetry(() =>
        fetch(url, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "follow",
        }),
      );

      if (!response.ok) {
        return (
          `Failed to fetch page (HTTP ${response.status}: ${response.statusText}). ` +
          `The page may require authentication, be behind a paywall, or no longer exist.`
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (
        !contentType.includes("text/html") &&
        !contentType.includes("text/plain")
      ) {
        return (
          `Cannot read this URL — content type is '${contentType}'. ` +
          `This tool only supports HTML and plain text pages. ` +
          `For PDFs or other files, consider a dedicated parser.`
        );
      }

      const html = await response.text();

      if (!extractText) {
        return html.slice(0, maxChars);
      }

      const text = extractReadableText(html);

      if (!text || text.length < 50) {
        return (
          "Page fetched but no readable text could be extracted. " +
          "The page may be JavaScript-rendered (SPA), require login, or be empty."
        );
      }

      if (text.length > maxChars) {
        return (
          text.slice(0, maxChars) +
          `\n\n[Content truncated at ${maxChars.toLocaleString()} characters. ` +
          `Total page length: ${text.length.toLocaleString()} characters. ` +
          `Call again with a higher maxChars if you need more.]`
        );
      }

      return text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes("timeout") || message.includes("abort")) {
        return `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s. The site may be slow or blocking automated requests.`;
      }
      if (message.includes("ENOTFOUND") || message.includes("getaddrinfo")) {
        return `Could not resolve hostname. Check the URL is correct: ${url}`;
      }
      if (message.includes("ECONNREFUSED")) {
        return `Connection refused by the server: ${url}`;
      }

      console.error("[webFetchTool] Error:", message);
      return `Failed to fetch page: ${message}`;
    }
  },
  {
    name: "web_fetch",
    description:
      "Fetches and reads the full content of a specific webpage by URL. " +
      "Use this AFTER internet_search when you need to read a page in full detail. " +
      "Do NOT use this for searching — use internet_search for that. " +
      "Not suitable for JavaScript-heavy SPAs, PDFs, login-protected pages, or paywalled content.",
    schema: z.object({
      url: z
        .string()
        .url()
        .describe("The full URL to fetch (must start with https://)."),
      extractText: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "If true (default), strips HTML tags and returns clean readable text. " +
            "Set false only if you specifically need raw HTML markup.",
        ),
      maxChars: z
        .number()
        .int()
        .min(1000)
        .max(50000)
        .optional()
        .default(DEFAULT_MAX_CHARS)
        .describe(
          "Max characters to return (default 15000 ≈ 3750 tokens). " +
            "Increase up to 50000 for deep research, decrease for quick fact lookups.",
        ),
    }),
  },
);

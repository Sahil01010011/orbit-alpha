import { z } from "zod";
import { registerTool } from "./registry.js";

registerTool("web_search", {
  description:
    "Search the web for current information, documentation, " +
    "news, or any topic. Use this when you need up-to-date information " +
    "that may not be in your training data. Returns a list of results " +
    "with titles, URLs, and content snippets.",
  parameters: z.object({
    query: z.string().describe("The search query"),
    max_results: z.number().optional().default(5)
      .describe("Maximum number of results to return (default 5, max 10)"),
  }),
  execute: async ({ query, max_results = 5 }, context) => {
    try {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        return { success: false, error: "TAVILY_API_KEY is not set in environment variables" };
      }
      const { tavily } = await import("@tavily/core");
      const client = tavily({ apiKey });
      const response = await client.search(query, {
        maxResults: Math.min(max_results, 10),
        searchDepth: "basic",
      });
      const results = response.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content?.slice(0, 500),
        score: r.score,
      }));
      return { success: true, result: results };
    } catch (err) {
      return { success: false, error: `Web search failed: ${err.message}` };
    }
  },
});

registerTool("fetch_url", {
  description:
    "Fetch and read the content of a URL. Use this to read " +
    "documentation pages, GitHub READMEs, API references, or any web page. " +
    "Returns the page content as plain text.",
  parameters: z.object({
    url: z.string().describe("The URL to fetch"),
    max_length: z.number().optional().default(3000)
      .describe("Maximum characters to return (default 3000)"),
  }),
  execute: async ({ url, max_length = 3000 }, context) => {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OrbitAgent/1.0)",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return {
          success: false,
          error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
        };
      }
      let text = await response.text();
      // Strip HTML tags for cleaner content
      text = text.replace(/<[^>]*>/g, " ")
                 .replace(/\s+/g, " ")
                 .trim()
                 .slice(0, max_length);
      return { success: true, result: text, url };
    } catch (err) {
      return { success: false, error: `Failed to fetch URL: ${err.message}` };
    }
  },
});

import { z } from "zod";
import { registerTool } from "./registry.js";

const PINCHTAB_BASE = process.env.PINCHTAB_URL || 'http://localhost:9867';

async function pinchtabRequest(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${PINCHTAB_BASE}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PinchTab ${method} ${path} failed: ${res.status} ${text}`);
  }
  return res.json().catch(() => ({}));
}

async function isAvailable() {
  try {
    await fetch(`${PINCHTAB_BASE}/health`, {
      signal: AbortSignal.timeout(2000)
    });
    return true;
  } catch {
    return false;
  }
}

registerTool("browser_navigate", {
  description: "Navigate Chrome to a URL and return the page " +
    "content as plain text. Use for JavaScript-rendered pages " +
    "that fetch_url cannot handle. Requires PinchTab running " +
    "locally (npm install -g pinchtab && pinchtab).",
  parameters: z.object({
    url: z.string().describe("URL to navigate to"),
    instance_id: z.string().optional().default("default")
      .describe("PinchTab instance ID"),
  }),
  execute: async (args, context) => {
    const url = args?.url;
    const instance_id = args?.instance_id ?? 'default';
    if (!url) return { success: false, error: 'url is required' };
    if (!(await isAvailable())) {
      return {
        success: false,
        error: 'PinchTab is not running. Start it with: pinchtab'
      };
    }
    try {
      await pinchtabRequest(
        `/instances/${instance_id}/navigate`,
        'POST',
        { url }
      );
      const text = await pinchtabRequest(
        `/instances/${instance_id}/text`
      );
      return {
        success: true,
        result: typeof text === 'string'
          ? text.slice(0, 4000)
          : JSON.stringify(text).slice(0, 4000),
        url
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

registerTool("browser_snapshot", {
  description: "Get interactive elements on the current browser " +
    "page as a structured snapshot. Returns clickable elements " +
    "with their reference IDs for use with browser_click.",
  parameters: z.object({
    instance_id: z.string().optional().default("default"),
  }),
  execute: async (args, context) => {
    const instance_id = args?.instance_id ?? 'default';
    if (!(await isAvailable())) {
      return { success: false, error: 'PinchTab is not running' };
    }
    try {
      const snap = await pinchtabRequest(
        `/instances/${instance_id}/snapshot?filter=interactive`
      );
      return { success: true, result: snap };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

registerTool("browser_click", {
  description: "Click an element on the current browser page " +
    "by its reference ID. Get reference IDs from browser_snapshot.",
  parameters: z.object({
    ref: z.string().describe("Element reference ID from snapshot"),
    instance_id: z.string().optional().default("default"),
  }),
  execute: async (args, context) => {
    const ref = args?.ref;
    const instance_id = args?.instance_id ?? 'default';
    if (!ref) return { success: false, error: 'ref is required' };
    if (!(await isAvailable())) {
      return { success: false, error: 'PinchTab is not running' };
    }
    try {
      await pinchtabRequest(
        `/instances/${instance_id}/action`,
        'POST',
        { kind: 'click', ref }
      );
      return { success: true, result: `Clicked element ${ref}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

registerTool("browser_fill", {
  description: "Fill a text input on the current browser page.",
  parameters: z.object({
    ref: z.string().describe("Element reference ID from snapshot"),
    value: z.string().describe("Text to fill into the input"),
    instance_id: z.string().optional().default("default"),
  }),
  execute: async (args, context) => {
    const ref = args?.ref;
    const value = args?.value;
    const instance_id = args?.instance_id ?? 'default';
    if (!ref || !value) {
      return { success: false, error: 'ref and value are required' };
    }
    if (!(await isAvailable())) {
      return { success: false, error: 'PinchTab is not running' };
    }
    try {
      await pinchtabRequest(
        `/instances/${instance_id}/action`,
        'POST',
        { kind: 'fill', ref, value }
      );
      return { success: true, result: `Filled element ${ref}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

registerTool("browser_extract_text", {
  description: "Extract plain text from the current browser page. " +
    "Token-efficient: ~800 tokens per page vs 5000+ for raw HTML.",
  parameters: z.object({
    instance_id: z.string().optional().default("default"),
  }),
  execute: async (args, context) => {
    const instance_id = args?.instance_id ?? 'default';
    if (!(await isAvailable())) {
      return { success: false, error: 'PinchTab is not running' };
    }
    try {
      const text = await pinchtabRequest(
        `/instances/${instance_id}/text`
      );
      return {
        success: true,
        result: typeof text === 'string'
          ? text.slice(0, 4000)
          : JSON.stringify(text).slice(0, 4000)
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

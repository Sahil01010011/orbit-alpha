import { tool } from "ai";

const MAX_TOOL_RESULT_TOKENS = 8000; // ~6000 words, safe for all providers
const TRUNCATION_NOTICE = '\n\n[...result truncated to save context. Use more specific queries to get focused results...]';

function truncateToolResult(str) {
  // Rough token estimate: 1 token ≈ 4 characters
  const maxChars = MAX_TOOL_RESULT_TOKENS * 4;
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + TRUNCATION_NOTICE;
}

// Central in-memory registry: Map<name, { description, parameters, execute }>
const _registry = new Map();

/**
 * Register a tool.
 * @param {string} name - Unique tool name (snake_case)
 * @param {{ description: string, parameters: import('zod').ZodTypeAny, execute: (args: object, context: object) => Promise<any> }} definition
 */
export function registerTool(name, definition) {
  if (_registry.has(name)) {
    throw new Error(`Tool "${name}" is already registered`);
  }
  _registry.set(name, definition);
}

/**
 * Return a single tool definition by name.
 * @param {string} name
 * @returns {{ description: string, parameters: import('zod').ZodTypeAny, execute: Function } | undefined}
 */
export function getTool(name) {
  return _registry.get(name);
}

/**
 * Return all registered tool definitions.
 * @returns {Array<{ name: string, description: string, parameters: import('zod').ZodTypeAny, execute: Function }>}
 */
export function getAllTools() {
  return Array.from(_registry.entries()).map(([name, def]) => ({
    name,
    ...def,
  }));
}

/**
 * Return tool definitions formatted for the Vercel AI SDK (streamText compatible).
 * Context (e.g. outputDirectory) is baked into each execute closure so tools
 * automatically operate in the correct working directory.
 *
 * @param {{ outputDirectory?: string }} [context]
 * @returns {Record<string, import('ai').CoreTool>}
 */
export function getToolSchemas(context = {}) {
  const schemas = {};
  for (const [name, def] of _registry.entries()) {
    schemas[name] = tool({
      description: def.description,
      parameters: def.parameters,
      execute: async (args) => {
        const result = await def.execute(args, context);
        const str =
          typeof result === "string" ? result : JSON.stringify(result);
        return truncateToolResult(str);
      },
    });
  }
  return schemas;
}

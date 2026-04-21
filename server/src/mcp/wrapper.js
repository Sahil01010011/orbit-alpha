import { z } from 'zod';

const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * Normalize a tool name to match ^[a-zA-Z0-9_-]{1,64}$
 * Replaces invalid characters with underscores.
 */
export function normalizeToolName(serverName, toolName) {
  const normalized = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const full = `mcp__${serverName}__${normalized}`;
  return full.slice(0, 64);
}

/**
 * Convert an MCP tool definition into Orbit registry format.
 * @param {string} serverName
 * @param {object} mcpTool - Tool definition from tools/list response
 * @param {Function} callFn - Async function(toolName, args) that calls the MCP server
 * @returns {{ name: string, description: string, parameters: import('zod').ZodTypeAny, execute: Function }}
 */
export function wrapMcpTool(serverName, mcpTool, callFn) {
  const name = normalizeToolName(serverName, mcpTool.name);

  const description = (mcpTool.description || 'MCP tool')
    .slice(0, MAX_DESCRIPTION_LENGTH);

  // Convert JSON Schema to a permissive Zod schema.
  // We accept any object and let the MCP server validate.
  const parameters = z.object({}).passthrough().describe(description);

  const execute = async (args) => {
    try {
      const result = await callFn(mcpTool.name, args);
      if (typeof result === 'string') return result;
      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({ error: error.message });
    }
  };

  return { name, description, parameters, execute };
}

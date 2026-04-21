import { z } from 'zod';

const MAX_DESCRIPTION_LENGTH = 1000;

export function normalizeToolName(serverName, toolName) {
  const normalized = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const full = `mcp__${serverName}__${normalized}`;
  return full.slice(0, 64);
}

function jsonSchemaToZod(schema) {
  if (!schema || !schema.properties) {
    return z.object({}).passthrough();
  }
  const shape = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const required = schema.required?.includes(key) ?? false;
    let field;
    if (prop.type === 'string') field = z.string();
    else if (prop.type === 'number') field = z.number();
    else if (prop.type === 'boolean') field = z.boolean();
    else if (prop.type === 'array') field = z.array(z.any());
    else field = z.any();
    if (prop.description) field = field.describe(prop.description);
    shape[key] = required ? field : field.optional();
  }
  return z.object(shape);
}

export function wrapMcpTool(serverName, mcpTool, callFn) {
  const name = normalizeToolName(serverName, mcpTool.name);

  const description = (mcpTool.description || 'MCP tool')
    .slice(0, MAX_DESCRIPTION_LENGTH);

  const parameters = jsonSchemaToZod(mcpTool.inputSchema);

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
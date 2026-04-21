import { z } from 'zod';

const MAX_DESCRIPTION_LENGTH = 1000;

export function normalizeToolName(serverName, toolName) {
  const normalized = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const full = `mcp__${serverName}__${normalized}`;
  return full.slice(0, 64);
}

function jsonSchemaPropertyToZod(prop) {
  if (!prop) return z.any();

  switch (prop.type) {
    case 'string':
      return prop.enum ? z.enum(prop.enum) : z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      if (prop.items) {
        if (prop.items.type === 'object' && prop.items.properties) {
          return z.array(jsonSchemaToZod(prop.items));
        }
        return z.array(jsonSchemaPropertyToZod(prop.items));
      }
      return z.array(z.any());
    case 'object':
      return prop.properties
        ? jsonSchemaToZod(prop)
        : z.record(z.string(), z.any());
    default:
      if (prop.anyOf) return z.any();
      if (prop.oneOf) return z.any();
      if (prop.allOf) return z.any();
      return z.any();
  }
}

function jsonSchemaToZod(schema) {
  if (!schema) return z.object({}).passthrough();

  if (schema.type === 'object' || schema.properties) {
    if (!schema.properties) return z.object({}).passthrough();

    const shape = {};
    const required = schema.required || [];

    for (const [key, prop] of Object.entries(schema.properties)) {
      let field = jsonSchemaPropertyToZod(prop);
      if (prop.description) field = field.describe(prop.description);
      shape[key] = required.includes(key) ? field : field.optional();
    }
    return z.object(shape);
  }

  return z.object({}).passthrough();
}

function buildSchemaHint(schema) {
  if (!schema?.properties) return '';
  const fields = Object.entries(schema.properties)
    .map(([k, v]) => {
      if (v.type === 'array' && v.items?.properties) {
        const itemFields = Object.keys(v.items.properties).join(', ');
        return `${k}(array of objects with: ${itemFields})`;
      }
      if (v.type === 'array' && v.items?.type) {
        return `${k}(array of ${v.items.type})`;
      }
      return `${k}(${v.type || 'any'})`;
    })
    .join('; ');
  return ' Required fields: ' + fields;
}

export function wrapMcpTool(serverName, mcpTool, callFn) {
  const name = normalizeToolName(serverName, mcpTool.name);

  const schemaHint = buildSchemaHint(mcpTool.inputSchema);
  const description = ((mcpTool.description || 'MCP tool') + schemaHint)
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
import "../tools/index.js"; // triggers all registerTool() calls
import { getAllTools, getToolSchemas, registerTool } from "../tools/registry.js";

// Tracks which tool names the user has enabled this session
const _enabledIds = new Set();

export let availableTools = getAllTools().map(t => ({
  id: t.name,
  name: t.name,
  description: t.description,
}));

export function refreshAvailableTools() {
  availableTools = getAllTools().map(t => ({
    id: t.name,
    name: t.name,
    description: t.description,
  }));
}

export function enableTools(toolIds) {
  _enabledIds.clear();
  toolIds.forEach(id => _enabledIds.add(id));
}

export function getEnabledTools(context = {}) {
  if (_enabledIds.size === 0) return undefined;
  const all = getToolSchemas(context);
  const filtered = {};
  for (const id of _enabledIds) {
    if (all[id]) filtered[id] = all[id];
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export function getEnabledToolNames() {
  return [..._enabledIds];
}

export function resetTools() {
  _enabledIds.clear();
}

export function toggleTool(toolId) {
  if (_enabledIds.has(toolId)) {
    _enabledIds.delete(toolId);
    return false;
  }
  _enabledIds.add(toolId);
  return true;
}

/**
 * Inject MCP tools into the registry.
 * Called at startup after loadMcpTools() returns wrapped tools.
 * Skips tools that are already registered to avoid conflicts.
 * @param {Array<{ name: string, description: string, parameters: any, execute: Function }>} mcpTools
 */
export function injectMcpTools(mcpTools) {
  let injected = 0;
  for (const tool of mcpTools) {
    try {
      registerTool(tool.name, {
        description: tool.description,
        parameters: tool.parameters,
        execute: tool.execute,
      });
      injected++;
    } catch (error) {
      // Tool already registered — skip silently
    }
  }
  return injected;
}

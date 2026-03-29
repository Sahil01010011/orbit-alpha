import "../tools/index.js"; // triggers all registerTool() calls
import { getAllTools, getToolSchemas } from "../tools/registry.js";

// Tracks which tool names the user has enabled this session
const _enabledIds = new Set();

export const availableTools = getAllTools().map(t => ({
  id: t.name,
  name: t.name,
  description: t.description,
}));

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
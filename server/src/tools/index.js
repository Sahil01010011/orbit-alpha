/**
 * Tool index — import this file once at startup to register all tools.
 *
 * Adding a new tool in the future requires only:
 *   1. Creating a new file in server/src/tools/
 *   2. Importing it here
 *
 * Zero orchestrator changes needed.
 */

import "./filesystem.js";
import "./shell.js";
import "./git.js";
import "./dependencies.js";
import "./package-manager.js";
import "./directory.js";
import "./web.js";
import "./browser.js";

export { registerTool, getTool, getAllTools, getToolSchemas } from "./registry.js";

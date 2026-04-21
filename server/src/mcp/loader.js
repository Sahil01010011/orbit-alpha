import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import { connectMcpServer } from './client.js';

/**
 * Load MCP config from .orbit-mcp.json in the given directory.
 * Returns null if file not found.
 */
async function loadMcpConfig(directory) {
  let current = resolve(directory);

  for (let i = 0; i < 10; i++) {
    const configPath = resolve(current, '.orbit-mcp.json');
    if (existsSync(configPath)) {
      try {
        const raw = await readFile(configPath, 'utf-8');
        return JSON.parse(raw);
      } catch (error) {
        console.log(
          chalk.hex('#facc15')(
            'mcp  ·  failed to parse .orbit-mcp.json: ' + error.message
          )
        );
        return null;
      }
    }
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  // Fallback: ~/.orbit/mcp.json
  const { homedir } = await import('os');
  const globalConfig = resolve(homedir(), '.orbit', 'mcp.json');
  if (existsSync(globalConfig)) {
    try {
      const raw = await readFile(globalConfig, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      console.log(chalk.hex('#facc15')('mcp  ·  failed to parse ~/.orbit/mcp.json: ' + error.message));
    }
  }

  return null;
}

/**
 * Connect to all MCP servers defined in .orbit-mcp.json and
 * return all wrapped tools ready for registry injection.
 *
 * @param {string} workingDirectory - Directory to look for .orbit-mcp.json
 * @returns {Promise<Array<{ name: string, description: string, parameters: any, execute: Function }>>}
 */
export async function loadMcpTools(workingDirectory) {
  const config = await loadMcpConfig(workingDirectory);
  if (!config || !Array.isArray(config.servers) || config.servers.length === 0) {
    return [];
  }

  const allTools = [];

  for (const serverConfig of config.servers) {
    if (!serverConfig.name || !serverConfig.command) {
      console.log(
        chalk.hex('#facc15')(
          'mcp  ·  skipping invalid server config (missing name or command)'
        )
      );
      continue;
    }

    try {
      console.log(
        chalk.hex('#22d3ee')('mcp  ·  connecting to ') +
        chalk.hex('#a78bfa')(serverConfig.name) +
        chalk.hex('#6b7280')('...')
      );

      const tools = await connectMcpServer(serverConfig);
      allTools.push(...tools);

      console.log(
        chalk.hex('#4ade80')('mcp  ·  ') +
        chalk.hex('#a78bfa')(serverConfig.name) +
        chalk.hex('#4ade80')(' connected  ·  ') +
        chalk.hex('#f9fafb')(tools.length + ' tools loaded')
      );
    } catch (error) {
      console.log(
        chalk.hex('#f87171')(
          'mcp  ·  ' + serverConfig.name + ' failed: ' + error.message
        )
      );
    }
  }

  return allTools;
}

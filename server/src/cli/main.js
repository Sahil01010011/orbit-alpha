#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = dirname(currentFilePath);

import dotenv from 'dotenv';

// __PROJECT_ROOT__ is injected by esbuild at build time.
// When running from source directly, fall back to path traversal.
const projectRoot = typeof __PROJECT_ROOT__ !== 'undefined'
  ? __PROJECT_ROOT__
  : resolve(currentDirPath, '../../..');

const envCandidates = [
  resolve(projectRoot, '.env'),
  resolve(projectRoot, 'server', '.env'),
  resolve(process.cwd(), '.env'),
  resolve(currentDirPath, '../../../.env'),
  resolve(currentDirPath, '../../../../.env'),
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
    break;
  }
}

import chalk from 'chalk';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { login, logout, whoami } from './commands/auth/login.js';
import { createWakeUpCommand } from './commands/ai/wakeUp.js';
import { history } from './commands/history/history.js';
import { Banner } from './ui/Banner.js';

process.removeAllListeners('warning');

const INVOCATION_DIR = process.cwd();

async function main() {
  const { unmount } = render(<Banner />);
  await new Promise((r) => setTimeout(r, 80));
  unmount();

  const program = new Command('orbit');

  program
    .version('0.0.1')
    .description('Orbital CLI - A Cli Based AI Tool')
    .addCommand(login)
    .addCommand(logout)
    .addCommand(whoami)
    .addCommand(createWakeUpCommand(INVOCATION_DIR))
    .addCommand(history);

  if (process.argv.slice(2).length === 0) {
    program.outputHelp();
    process.exit(0);
  }

  program.parse();
}

main().catch((err) => {
  console.log(chalk.red('Error running Orbital CLI'), err);
  process.exit(1);
});

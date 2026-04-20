import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

await build({
  entryPoints: [resolve(__dirname, 'src/cli/main.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: resolve(__dirname, 'dist/main.js'),
  external: [
    '@prisma/client',
    'better-auth',
    '@ai-sdk/google',
    'ai',
    '@anthropic-ai/sdk',
    'openai',
    '@tavily/core',
    'chalk',
    'commander',
    '@clack/prompts',
    'boxen',
    'yocto-spinner',
    'marked',
    'marked-terminal',
    'ink',
    'ink-text-input',
    'react',
    'react/jsx-runtime',
    'zod',
    'dotenv',
    'express',
    'cors',
    'better-auth',
    'pg',
    'open',
    'figlet',
  ],
  define: {
    '__PROJECT_ROOT__': JSON.stringify(projectRoot),
  },
  jsx: 'automatic',
  jsxImportSource: 'react',
  loader: {
    '.js': 'jsx',
  },
  logLevel: 'info',
});

console.log('build complete → dist/main.js');

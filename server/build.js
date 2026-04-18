import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, 'src/cli/main.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: resolve(__dirname, 'dist/main.js'),
  external: [
    // Node built-ins
    'fs', 'path', 'url', 'os', 'child_process', 'crypto',
    'stream', 'util', 'events', 'http', 'https', 'net',
    // All node_modules — bundle only src files
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
    'zod',
    'dotenv',
  ],
  jsx: 'automatic',
  jsxImportSource: 'react',
  loader: {
    '.js': 'jsx',
  },
  logLevel: 'info',
});

console.log('Build complete: dist/main.js');

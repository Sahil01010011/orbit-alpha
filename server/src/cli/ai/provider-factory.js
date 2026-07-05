import chalk from 'chalk';
import { GeminiProvider } from './providers/gemini-provider.js';
import { ClaudeProvider } from './providers/claude-provider.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { validateProvider } from './provider-interface.js';

let _activeName = 'Gemini 2.5 Flash';
let _requestedName = 'Gemini 2.5 Flash';
let _isFallback = false;

const PROVIDERS = {
  gemini: () => new GeminiProvider(),
  claude: () => new ClaudeProvider(),
  openai: () => new OpenAIProvider(),
};

export function getProvider() {
  const key = (process.env.ORBITAL_MODEL_PROVIDER || 'gemini').toLowerCase();
  const factory = PROVIDERS[key] || PROVIDERS['gemini'];
  const provider = factory();
  validateProvider(provider);
  _requestedName = provider.getProviderName();
  _isFallback = false;
  if (!provider.isAvailable()) {
    _isFallback = true;
    console.log(
      chalk.yellow(
        `⚠  ${provider.getProviderName()} API key not found. Falling back to Gemini.`
      )
    );
    const fallbackProvider = new GeminiProvider();
    validateProvider(fallbackProvider);
    _activeName = fallbackProvider.getProviderName();
    return fallbackProvider;
  }
  _activeName = provider.getProviderName();
  return provider;
}

export async function sendMessageWithFallback(
  messages,
  onChunk,
  options,
  spinner
) {
  const provider = getProvider();
  try {
    return await provider.sendMessage(messages, onChunk, options);
  } catch (error) {
    const isQuotaError = error?.status === 429
  || error?.status === 400
  || error?.status === 401
  || error?.status === 403
  || error?.code === 'insufficient_quota'
  || error?.message?.toLowerCase().includes('quota')
  || error?.message?.toLowerCase().includes('rate limit')
  || error?.message?.toLowerCase().includes('unauthorized')
  || error?.message?.toLowerCase().includes('invalid api key')
  || error?.message?.toLowerCase().includes('credit balance')
  || error?.message?.toLowerCase().includes('too low')
  || error?.message?.toLowerCase().includes('billing')
  || error?.message?.toLowerCase().includes('upgrade');

    if (isQuotaError && _activeName !== 'Gemini 2.5 Flash') {
      if (spinner) spinner.stop();
      console.log(
        chalk.yellow(
          `\n⚠  ${_activeName} failed: ${
            error?.code || error?.message?.slice(0, 60)
          }`
        )
      );
      console.log(chalk.yellow(`   Falling back to Gemini automatically.\n`));
      _isFallback = true;
      _activeName = 'Gemini 2.5 Flash';
      const fallback = new GeminiProvider();
      return await fallback.sendMessage(messages, onChunk, options);
    }
    throw error;
  }
}

export function getAvailableProviders() {
  return Object.keys(PROVIDERS);
}

export function registerProvider(key, factory) {
  PROVIDERS[key] = factory;
}

export function getProviderInfo() {
  return [
    {
      key: 'gemini',
      name: 'Gemini 2.5 Flash',
      hint: 'Requires GOOGLE_GENERATIVE_AI_API_KEY',
      available: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    },
    {
      key: 'claude',
      name: 'Claude Sonnet 4.6',
      hint: 'Requires ANTHROPIC_API_KEY',
      available: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      key: 'openai',
      name: 'GPT-4o',
      hint: 'Requires OPENAI_API_KEY',
      available: !!process.env.OPENAI_API_KEY,
    },
  ];
}

export function getActiveProviderInfo() {
  const key = (process.env.ORBITAL_MODEL_PROVIDER || 'gemini').toLowerCase();
  const infoMap = {
    gemini: 'Gemini 2.5 Flash',
    claude: 'Claude Sonnet 4.6',
    openai: 'GPT-4o',
  };
  const resolvedName = infoMap[key] || 'Gemini 2.5 Flash';
  return {
    activeName: _isFallback ? 'Gemini 2.5 Flash' : resolvedName,
    requestedName: resolvedName,
    isFallback: _isFallback,
  };
}
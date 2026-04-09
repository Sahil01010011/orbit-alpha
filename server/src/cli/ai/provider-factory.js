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

/**
 * Returns the active provider instance based on ORBITAL_MODEL_PROVIDER env var.
 * Defaults to 'gemini' if not set or if the specified provider is not registered.
 * Validates the provider implements the required interface before returning.
 */
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

/**
 * Returns all registered provider keys.
 */
export function getAvailableProviders() {
  return Object.keys(PROVIDERS);
}

/**
 * Register a new provider at runtime.
 * Used by future provider modules to self-register.
 */
export function registerProvider(key, factory) {
  PROVIDERS[key] = factory;
}

/**
 * Returns display info for all providers including availability status.
 * Used by the startup menu to show which providers have API keys configured.
 */
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
      name: 'Claude Sonnet 3.5', //name: 'Claude Sonnet 4.5'
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
  return {
    activeName: _activeName,
    requestedName: _requestedName,
    isFallback: _isFallback,
  };
}

import { GeminiProvider } from './providers/gemini-provider.js';
import { validateProvider } from './provider-interface.js';

const PROVIDERS = {
  gemini: () => new GeminiProvider(),
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

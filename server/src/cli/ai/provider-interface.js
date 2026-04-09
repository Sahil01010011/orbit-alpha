/**
 * Every model provider must implement this interface.
 * 
 * sendMessage(messages, onChunk, options) -> Promise<ProviderResponse>
 *   messages: array of { role, content } objects
 *   onChunk: function called with each streamed text chunk
 *   options: { tools, onToolCall, system }
 *   returns: { content, toolCalls, toolResults, finishReason, usage }
 *
 * getMessage(messages, tools) -> Promise<string>
 *   Convenience wrapper — returns text content only.
 *
 * getProviderName() -> string
 *   Returns a human-readable provider name e.g. 'Gemini 2.5 Flash'
 *
 * isAvailable() -> boolean
 *   Returns true if the required API key is present in environment variables.
 */

export function validateProvider(provider) {
  const required = ['sendMessage', 'getMessage', 'getProviderName', 'isAvailable'];
  for (const method of required) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`Model provider is missing required method: ${method}`);
    }
  }
  return true;
}

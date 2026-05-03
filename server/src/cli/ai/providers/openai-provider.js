import OpenAI from "openai";
import chalk from "chalk";

export class OpenAIProvider {
  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  getProviderName() {
    return "GPT-4o";
  }

  isAvailable() {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async sendMessage(messages, onChunk, { system } = {}) {
    try {
      const requestMessages = system
        ? [{ role: "system", content: system }, ...messages]
        : messages;

      const stream = await this.client.chat.completions.create({
        model: "gpt-4o",
        messages: requestMessages,
        stream: true,
        max_tokens: 8096,
      });

      let fullResponse = "";
      let finishReason;
      let usage;

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullResponse += delta;
          if (onChunk) {
            onChunk(delta);
          }
        }

        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }

        if (chunk.usage) {
          usage = chunk.usage;
        }
      }

      return {
        content: fullResponse,
        toolCalls: [],
        toolResults: [],
        finishReason,
        usage,
      };
    } catch (error) {
      
      throw error;
    }
  }

  async getMessage(messages, tools = undefined) {
    const result = await this.sendMessage(messages, () => {}, { tools });
    return result.content;
  }

  generateStructured() {
    throw new Error(
      "generateStructured is not supported by OpenAIProvider. Use GeminiProvider for structured output."
    );
  }
}

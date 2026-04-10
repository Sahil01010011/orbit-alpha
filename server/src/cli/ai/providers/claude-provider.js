import Anthropic from "@anthropic-ai/sdk";
import chalk from "chalk";

const EMPTY_SCHEMA = { type: "object", properties: {} };

export class ClaudeProvider {
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  getProviderName() {
    return "Claude Sonnet 3.5"; // it can be changed like Claude Sonnet 4.6
  }

  isAvailable() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async sendMessage(messages, onChunk, { tools, system } = {}) {
    try {
      const request = {
        model: "claude-3-5-sonnet-20241022", //model: "claude-sonnet-4-5-20251001",
        max_tokens: 8096,
        messages,
        ...(system && { system }),
      };

      if (tools && Object.keys(tools).length > 0) {
        request.tools = Object.entries(tools).map(([name, tool]) => {
          const inputSchema = tool?.parameters?.jsonSchema || EMPTY_SCHEMA;
          return {
            name,
            description: tool.description || "",
            input_schema: inputSchema,
          };
        });
      }

      const stream = this.client.messages.stream(request);
      let fullResponse = "";

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          const text = event.delta.text || "";
          if (text) {
            fullResponse += text;
            if (onChunk) {
              onChunk(text);
            }
          }
        }
      }

      const finalMessage = await stream.finalMessage();

      return {
        content: fullResponse,
        toolCalls: [],
        toolResults: [],
        finishReason: finalMessage?.stop_reason,
        usage: finalMessage?.usage,
      };
    } catch (error) {
      // console.error(chalk.red("AI Service Error:"), error.message);
      // console.error(chalk.red("Full error:"), error);
      throw error;
    }
  }

  async getMessage(messages, tools = undefined) {
    const result = await this.sendMessage(messages, () => {}, { tools });
    return result.content;
  }

  generateStructured() {
    throw new Error(
      "generateStructured is not supported by ClaudeProvider. Use GeminiProvider for structured output."
    );
  }
}

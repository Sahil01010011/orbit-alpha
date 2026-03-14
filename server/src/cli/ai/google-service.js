import { google } from "@ai-sdk/google";
// import prisma from "../lib/db.js";
import { streamText, generateObject, convertToModelMessages } from "ai";
import { config } from "../../config/google.config.js";
import chalk from "chalk";

export class AIService {
  constructor() {
    if (!config.googleApiKey) {
      throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set in environment variables");
    }
    
    this.model = google(config.model, {
      apiKey: config.googleApiKey,
    });
  }

  /**
   * Send a message and get streaming response
   * @param {Array} messages - Array of message objects {role, content}
   * @param {Function} onChunk - Callback for each text chunk
   * @param {Object} [options] - Optional configuration
   * @param {Object} [options.tools] - Tools to enable for this request
   * @param {Function} [options.onToolCall] - Callback invoked after each tool call step with (toolCall, toolResult)
   * @param {string} [options.system] - System prompt to separate from user messages
   * @returns {Promise<Object>} Full response with content, tool calls, and usage
   */
  async sendMessage(messages, onChunk, { tools, onToolCall, system } = {}) {
    try {
      const streamConfig = {
        model: this.model,
        messages: messages,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        ...(system && { system }),
      };

      // Add tools if provided with maxSteps for multi-step tool calling
      if (tools && Object.keys(tools).length > 0) {
        streamConfig.tools = tools;
        streamConfig.maxSteps = 5; // Allow up to 5 tool call steps

        // Fire onToolCall in real-time as each step with tool calls finishes,
        // pairing each tool call with its corresponding result.
        if (onToolCall) {
          streamConfig.onStepFinish = (stepResult) => {
            if (stepResult.toolCalls && stepResult.toolCalls.length > 0) {
              for (const toolCall of stepResult.toolCalls) {
                const toolResult = stepResult.toolResults?.find(
                  (r) => r.toolCallId === toolCall.toolCallId
                );
                onToolCall(toolCall, toolResult);
              }
            }
          };
        }

        console.log(chalk.gray(`[DEBUG] Tools enabled: ${Object.keys(tools).join(', ')}`));
      }

      const result = streamText(streamConfig);
      
      let fullResponse = "";
      
      // Stream text chunks
      for await (const chunk of result.textStream) {
        fullResponse += chunk;
        if (onChunk) {
          onChunk(chunk);
        }
      }

      // IMPORTANT: Await the result to get access to steps, toolCalls, etc.
      const fullResult = await result;
      
      const toolCalls = [];
      const toolResults = [];
      
      // Collect tool calls and results from all steps for the return value.
      // onToolCall has already been invoked in real-time via onStepFinish above.
      if (fullResult.steps && Array.isArray(fullResult.steps)) {
        for (const step of fullResult.steps) {
          if (step.toolCalls && step.toolCalls.length > 0) {
            toolCalls.push(...step.toolCalls);
          }
          
          // Collect tool results
          if (step.toolResults && step.toolResults.length > 0) {
            toolResults.push(...step.toolResults);
          }
        }
      }

      return {
        content: fullResponse,
        finishReason: fullResult.finishReason,
        usage: fullResult.usage,
        toolCalls,
        toolResults,
        steps: fullResult.steps,
      };
    } catch (error) {
      console.error(chalk.red("AI Service Error:"), error.message);
      console.error(chalk.red("Full error:"), error);
      throw error;
    }
  }

  /**
   * Get a non-streaming response
   * @param {Array} messages - Array of message objects
   * @param {Object} tools - Optional tools
   * @returns {Promise<string>} Response text
   */
  async getMessage(messages, tools = undefined) {
    let fullResponse = "";
    const result = await this.sendMessage(messages, (chunk) => {
      fullResponse += chunk;
    }, { tools });
    return result.content;
  }

  /**
   * Generate structured output using a Zod schema
   * @param {Object} schema - Zod schema
   * @param {string} prompt - Prompt for generation
   * @param {string} [system] - Optional system prompt to separate from the generation prompt
   * @returns {Promise<Object>} Parsed object matching the schema
   */
  async generateStructured(schema, prompt, system = undefined) {
    try {
      const result = await generateObject({
        model: this.model,
        schema: schema,
        prompt: prompt,
        ...(system && { system }),
      });
      
      return result.object;
    } catch (error) {
      console.error(chalk.red("AI Structured Generation Error:"), error.message);
      throw error;
    }
  }
}
import Anthropic from "@anthropic-ai/sdk";

const EMPTY_SCHEMA = { type: "object", properties: {} };

export class ClaudeProvider {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    });
  }

  getProviderName() {
    return "Claude Sonnet 4.6";
  }

  isAvailable() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async sendMessage(messages, onChunk, { tools, onToolCall, system } = {}) {
    try {
      const claudeTools =
        tools && Object.keys(tools).length > 0
          ? Object.entries(tools).map(([name, tool]) => ({
              name,
              description: tool.description || "",
              input_schema: tool?.parameters?.jsonSchema || EMPTY_SCHEMA,
            }))
          : undefined;

      let currentMessages = [...messages];
      let fullResponse = "";
      const allToolCalls = [];
      const allToolResults = [];

      while (true) {
        const request = {
          model: "claude-sonnet-4-6",
          max_tokens: 8096,
          messages: currentMessages,
          ...(system && { system }),
          ...(claudeTools && { tools: claudeTools }),
        };

        const stream = this.client.messages.stream(request);
        let stepText = "";
        const stepToolBlocks = [];

        for await (const event of stream) {
          if (
            event.type === "content_block_start" &&
            event.content_block?.type === "tool_use"
          ) {
            stepToolBlocks.push({
              id: event.content_block.id,
              name: event.content_block.name,
              rawInput: "",
            });
          } else if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta") {
              const text = event.delta.text || "";
              if (text) {
                stepText += text;
                fullResponse += text;
                if (onChunk) onChunk(text);
              }
            } else if (
              event.delta?.type === "input_json_delta" &&
              stepToolBlocks.length > 0
            ) {
              stepToolBlocks[stepToolBlocks.length - 1].rawInput +=
                event.delta.partial_json || "";
            }
          }
        }

        const finalMessage = await stream.finalMessage();

        if (
          stepToolBlocks.length === 0 ||
          finalMessage.stop_reason !== "tool_use"
        ) {
          return {
            content: fullResponse,
            toolCalls: allToolCalls,
            toolResults: allToolResults,
            finishReason: finalMessage.stop_reason,
            usage: finalMessage.usage,
          };
        }

        const assistantContent = [];
        if (stepText) {
          assistantContent.push({ type: "text", text: stepText });
        }
        for (const block of stepToolBlocks) {
          let input = {};
          try { input = JSON.parse(block.rawInput || "{}"); } catch {}
          assistantContent.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input,
          });
        }
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: assistantContent },
        ];

        const toolResultContent = [];
        for (const block of stepToolBlocks) {
          let input = {};
          try { input = JSON.parse(block.rawInput || "{}"); } catch {}

          const toolDef = tools?.[block.name];
          let resultText = "(tool not found)";

          if (toolDef?.execute) {
            try {
              const raw = await toolDef.execute(input, {});
              resultText = typeof raw === "string" ? raw : JSON.stringify(raw);
            } catch (err) {
              resultText = `Error: ${err.message}`;
            }
          }

          const toolCall = { toolName: block.name, input, toolCallId: block.id };
          const toolResult = { toolName: block.name, result: resultText, toolCallId: block.id };

          allToolCalls.push(toolCall);
          allToolResults.push(toolResult);
          if (onToolCall) onToolCall(toolCall, toolResult);

          toolResultContent.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: resultText,
          });
        }

        currentMessages = [
          ...currentMessages,
          { role: "user", content: toolResultContent },
        ];
      }
    } catch (error) {
      throw error;
    }
  }

  async getMessage(messages, tools = undefined) {
    const result = await this.sendMessage(messages, () => {}, { tools });
    return result.content;
  }

  async generateStructured(schema, prompt, system = undefined) {
    const MAX_ATTEMPTS = 3;
    let lastError;

    const systemPrompt = [
      system,
      "Respond with a valid JSON object only. No markdown, no code blocks, no explanation. Raw JSON only.",
    ]
      .filter(Boolean)
      .join("\n\n");

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: `${prompt}\n\nRespond with a valid JSON object only. Raw JSON, no markdown, no code blocks. The "steps" field must be an array of plain strings, not objects.`,
            },
          ],
        });

        const text = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");

        const clean = text.replace(/```json|```/g, "").trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error(`No JSON object found in response: ${clean.slice(0, 100)}`);
        const parsed = JSON.parse(jsonMatch[0]);
        return schema.parse(parsed);
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    throw new Error(
      `Failed after ${MAX_ATTEMPTS} attempts. Last error: ${lastError?.message}`
    );
  }
}
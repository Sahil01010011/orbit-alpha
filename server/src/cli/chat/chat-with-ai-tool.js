import chalk from "chalk";
import { text, isCancel, multiselect } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import {
  getActiveProviderInfo,
  sendMessageWithFallback,
} from "../ai/provider-factory.js";
import { ChatService } from "../../service/chat.service.js";
import { getStoredToken } from "../commands/auth/login.js";
import prisma from "../../lib/db.js";
import {
  availableTools,
  getEnabledTools,
  enableTools,
  getEnabledToolNames,
  resetTools,
} from "../../config/tool.config.js";
import { ORBITAL_SYSTEM_PROMPT } from "../../config/agent.config.js";

// Configure marked for terminal
marked.use(
  markedTerminal({
    code: chalk.hex("#22d3ee"),
    blockquote: chalk.hex("#6b7280").italic,
    heading: chalk.hex("#a78bfa").bold,
    firstHeading: chalk.hex("#c084fc").bold,
    hr: chalk.hex("#374151"),
    listitem: chalk.hex("#f9fafb"),
    list: chalk.hex("#f9fafb"),
    paragraph: chalk.hex("#e2e8f0"),
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.hex("#22d3ee"),
    del: chalk.dim,
    link: chalk.hex("#38bdf8").underline,
    href: chalk.hex("#38bdf8").underline,
  }),
);

const chatService = new ChatService();

async function getUserFromToken() {
  const token = await getStoredToken();

  if (!token?.access_token) {
    throw new Error("Not authenticated. Please run 'orbit login' first.");
  }

  const user = await prisma.user.findFirst({
    where: {
      sessions: {
        some: { token: token.access_token },
      },
    },
  });

  if (!user) {
    throw new Error("User not found. Please login again.");
  }

  return user;
}

async function selectTools() {
  const toolOptions = availableTools.map((tool) => ({
    value: tool.id,
    label: tool.name,
    hint: tool.description,
  }));

  const selectedTools = await multiselect({
    message: chalk.hex("#22d3ee")("Select tools to enable:"),
    options: toolOptions,
    required: false,
  });

  if (isCancel(selectedTools)) {
    console.log(chalk.hex("#6b7280")("tool selection cancelled"));
    process.exit(0);
  }

  enableTools(selectedTools);

  if (selectedTools.length === 0) {
    console.log(
      chalk.hex("#facc15")("no tools selected — running without tools"),
    );
    console.log("");
  } else {
    console.log("");
    console.log(chalk.hex("#4ade80")("active tools"));
    selectedTools.forEach((id) => {
      const tool = availableTools.find((t) => t.id === id);
      console.log(
        chalk.hex("#374151")("  ▸ ") + chalk.hex("#22d3ee")(tool.name),
      );
    });
    console.log("");
  }

  return selectedTools.length > 0;
}

async function initConversation(userId, conversationId = null, mode = "tool") {
  const conversation = await chatService.getOrCreateConversation(
    userId,
    conversationId,
    mode,
  );

  const { activeName, requestedName, isFallback } = getActiveProviderInfo();
  const enabledToolNames = getEnabledToolNames();
  const toolCount = enabledToolNames.length;

  const modelDisplay = isFallback
    ? chalk.hex("#facc15")(activeName + " (fallback)")
    : chalk.hex("#a78bfa")(activeName);

  console.log(
    chalk.hex("#22d3ee").bold("orbit α") +
      chalk.hex("#374151")(" │ ") +
      modelDisplay +
      chalk.hex("#374151")(" │ ") +
      chalk.hex("#38bdf8")("tool calling") +
      chalk.hex("#374151")(" │ ") +
      chalk.hex("#4ade80")(toolCount + " tools") +
      chalk.hex("#374151")(" │ ") +
      chalk.hex("#6b7280")(conversation.id.slice(0, 8)),
  );
  console.log(chalk.hex("#1e2230")("─".repeat(60)));
  console.log("");

  if (conversation.messages?.length > 0) {
    displayMessages(conversation.messages);
  }

  return conversation;
}

function displayMessages(messages) {
  messages.forEach((msg) => {
    if (msg.role === "user") {
      console.log(chalk.hex("#38bdf8").bold("you"));
      console.log(chalk.hex("#38bdf8")("│ ") + chalk.hex("#e2e8f0")(msg.content));
      console.log("");
    } else if (msg.role === "assistant") {
      console.log(chalk.hex("#a78bfa").bold("orbit"));
      const rendered = marked.parse(msg.content).trim();
      rendered.split("\n").forEach((line) => {
        console.log(chalk.hex("#374151")("│ ") + line);
      });
      console.log("");
    }
  });
}

async function saveMessage(conversationId, role, content) {
  return await chatService.addMessage(conversationId, role, content);
}

async function getAIResponse(conversationId) {
  const dbMessages = await chatService.getMessages(conversationId);
  const aiMessages = chatService.formatMessagesForAI(dbMessages);
  const tools = getEnabledTools({ outputDirectory: process.cwd() });

  let fullResponse = "";
  let isFirstChunk = true;
  let lineBuffer = "";
  const toolCallsDetected = [];

  const spinner = yoctoSpinner({
    text: chalk.hex("#facc15")("thinking..."),
    color: "yellow",
  }).start();

  try {
    const result = await sendMessageWithFallback(
      aiMessages,
      (chunk) => {
        if (isFirstChunk) {
          spinner.stop();
          isFirstChunk = false;
        }
        fullResponse += chunk;
        lineBuffer += chunk;

        const lines = lineBuffer.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          console.log(chalk.hex("#374151")("│ ") + lines[i]);
        }
        lineBuffer = lines[lines.length - 1];
      },
      {
        tools,
        onToolCall: (toolCall) => {
          toolCallsDetected.push(toolCall);
        },
        system: ORBITAL_SYSTEM_PROMPT,
      },
      spinner,
    );

    console.log('DEBUG steps:', result.steps?.length);
    console.log('DEBUG toolResults:', result.toolResults?.length);
    console.log('DEBUG content:', result.content?.slice(0, 100));

    if (lineBuffer) {
      console.log(chalk.hex("#374151")("│ ") + lineBuffer);
      lineBuffer = "";
    }

    if (toolCallsDetected.length > 0) {
      console.log("");
      console.log(chalk.hex("#6b7280")("── tool activity " + "─".repeat(43)));
      toolCallsDetected.forEach((tc) => {
        const args = JSON.stringify(tc.input ?? tc.args ?? {});
        console.log(
          chalk.hex("#374151")("  ▸ ") +
            chalk.hex("#22d3ee")(tc.toolName) +
            chalk.hex("#6b7280")(
              "  " +
                args.slice(0, 60) +
                (args.length > 60 ? "..." : ""),
            ),
        );
      });
    }

    if (result.toolResults && result.toolResults.length > 0) {
      console.log("");
      console.log(chalk.hex("#6b7280")("── tool results " + "─".repeat(44)));
      result.toolResults.forEach((tr) => {
        const raw = tr.output ?? tr.result ?? tr;
        let display;
        try {
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          const inner = parsed?.result ?? parsed?.error ?? parsed;
          display =
            typeof inner === "object"
              ? JSON.stringify(inner, null, 2)
              : String(inner);
        } catch {
          display = String(raw);
        }
        console.log(chalk.hex("#4ade80")("  ✓ ") + chalk.hex("#22d3ee")(tr.toolName));
        display
          .split("\n")
          .slice(0, 6)
          .forEach((line) => {
            console.log(chalk.hex("#6b7280")("    " + line));
          });
      });
    }

    if (isFirstChunk) {
      spinner.stop();
    }

    if (!fullResponse && result.toolResults && result.toolResults.length > 0) {
      fullResponse = result.toolResults
        .map((tr) => {
          const raw = tr.output ?? tr.result ?? tr;
          try {
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            const inner = parsed?.result ?? parsed?.error ?? parsed;
            return typeof inner === "object"
              ? JSON.stringify(inner, null, 2)
              : String(inner);
          } catch {
            return String(raw);
          }
        })
        .join("\n\n");
    }

    if (fullResponse) {
      console.log("");
      console.log(chalk.hex("#6b7280")("── response " + "─".repeat(48)));
      console.log(chalk.hex("#a78bfa").bold("orbit"));
      const rendered = marked.parse(fullResponse).trim();
      rendered.split("\n").forEach((line) => {
        console.log(chalk.hex("#374151")("│ ") + line);
      });
    }

    console.log("");
    console.log(chalk.hex("#1e2230")("─".repeat(60)));
    console.log("");

    return result.content || fullResponse || "";
  } catch (error) {
    console.log('DEBUG ERROR:', error.message);
    console.log('DEBUG ERROR code:', error?.code);
    console.log('DEBUG ERROR status:', error?.status);
    spinner.stop();
    console.log(chalk.hex("#f87171")("error: " + error.message));
    throw error;
  }
}

async function updateConversationTitle(
  conversationId,
  userInput,
  messageCount,
) {
  if (messageCount === 1) {
    const title = userInput.slice(0, 50) + (userInput.length > 50 ? "..." : "");
    await chatService.updateTitle(conversationId, title);
  }
}

async function chatLoop(conversation) {
  const enabledToolNames = getEnabledToolNames();

  console.log(
    chalk
      .hex("#6b7280")(
        'type a message and press enter  ·  "exit" to quit  ·  ctrl+c to force quit',
      ),
  );
  console.log(
    chalk.hex("#374151")("tools: ") +
      chalk.hex("#22d3ee")(
        enabledToolNames.length > 0 ? enabledToolNames.join(", ") : "none",
      ),
  );
  console.log("");

  while (true) {
    const userInput = await text({
      message: chalk.hex("#38bdf8")("›"),
      placeholder: "Type a message...",
      validate(value) {
        if (!value || value.trim().length === 0) {
          return "Message cannot be empty";
        }
      },
    });

    if (isCancel(userInput)) {
      console.log("");
      console.log(chalk.hex("#6b7280")("session ended"));
      process.exit(0);
    }

    if (userInput.toLowerCase() === "exit") {
      break;
    }

    console.log("");
    console.log(chalk.hex("#38bdf8").bold("you"));
    console.log(chalk.hex("#38bdf8")("│ ") + chalk.hex("#e2e8f0")(userInput));
    console.log("");

    await saveMessage(conversation.id, "user", userInput);
    const messages = await chatService.getMessages(conversation.id);
    const aiResponse = await getAIResponse(conversation.id);
    await saveMessage(conversation.id, "assistant", aiResponse);
    await updateConversationTitle(conversation.id, userInput, messages.length);
  }
}

export async function startToolChat(conversationId = null) {
  try {
    const user = await getUserFromToken();
    await selectTools();
    const conversation = await initConversation(user.id, conversationId, "tool");
    await chatLoop(conversation);
    resetTools();
  } catch (error) {
    console.log("");
    console.log(chalk.hex("#f87171")("error: " + error.message));
    resetTools();
    process.exit(1);
  }
}

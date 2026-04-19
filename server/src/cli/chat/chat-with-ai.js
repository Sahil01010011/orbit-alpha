import chalk from "chalk";
import { text, isCancel } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { getActiveProviderInfo, sendMessageWithFallback } from "../ai/provider-factory.js";
import { ChatService } from "../../service/chat.service.js";
import { getStoredToken } from "../commands/auth/login.js";
import prisma from "../../lib/db.js";
import { ORBITAL_SYSTEM_PROMPT } from "../../config/agent.config.js";

// Configure marked to use terminal renderer
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
  })
);

// Initialize services
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
    throw new Error('User not found. Please login again.');
  }

  return user;
}

async function initConversation(userId, conversationId = null, mode = "chat") {
  const conversation = await chatService.getOrCreateConversation(
    userId,
    conversationId,
    mode
  );

  const { activeName } = getActiveProviderInfo();

  // Status bar
  console.log(
    chalk.hex("#22d3ee").bold("orbit α") +
      chalk.hex("#374151")(" │ ") +
      chalk.hex("#a78bfa")(activeName) +
      chalk.hex("#374151")(" │ ") +
      chalk.hex("#38bdf8")(mode) +
      chalk.hex("#374151")(" │ ") +
      chalk.hex("#6b7280")(conversation.id.slice(0, 8))
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
    if (msg.role === 'user') {
      console.log(chalk.hex("#38bdf8").bold("you"));
      console.log(chalk.hex("#38bdf8")("│ ") + chalk.hex("#e2e8f0")(msg.content));
      console.log("");
    } else {
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

  console.log(chalk.hex("#a78bfa").bold("orbit"));

  let fullResponse = '';
  let isFirstChunk = true;
  let lineBuffer = '';

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
      { system: ORBITAL_SYSTEM_PROMPT }
    );

    if (lineBuffer) {
      console.log(chalk.hex("#374151")("│ ") + lineBuffer);
    }

    console.log("");
    console.log(chalk.hex("#1e2230")("─".repeat(60)));
    console.log("");

    return result.content || fullResponse;
  } catch (error) {
    spinner.stop();
    console.log(chalk.hex("#f87171")("error: " + error.message));
    throw error;
  }
}

async function updateConversationTitle(conversationId, userInput, messageCount) {
  if (messageCount === 1) {
    const title = userInput.slice(0, 50) + (userInput.length > 50 ? "..." : "");
    await chatService.updateTitle(conversationId, title);
  }
}

async function chatLoop(conversation) {
  console.log(
    chalk.hex("#6b7280")(
      'type a message and press enter  ·  "exit" to quit  ·  ctrl+c to force quit'
    )
  );
  console.log("");

  while (true) {
    const userInput = await text({
      message: chalk.hex("#38bdf8")("›"),
      placeholder: "Type your message...",
      validate(value) {
        if (!value || value.trim().length === 0) {
          return "Message cannot be empty";
        }
      },
    });

    // Handle cancellation (Ctrl+C)
    if (isCancel(userInput)) {
      console.log("");
      console.log(chalk.hex("#6b7280")("session ended"));
      process.exit(0);
    }

    // Handle exit command
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

// Main entry point
export async function startChat(mode = 'chat', conversationId = null) {
  try {
    const user = await getUserFromToken();
    const conversation = await initConversation(user.id, conversationId, mode);
    await chatLoop(conversation);
  } catch (error) {
    console.log("");
    console.log(chalk.hex("#f87171")("error: " + error.message));
    process.exit(1);
  }
}

import chalk from "chalk";
import { Command } from "commander";
import yoctoSpinner from "yocto-spinner";
import { getStoredToken } from "../auth/login.js";
import prisma from "../../../lib/db.js";
import { select, isCancel, cancel } from "@clack/prompts";
import { startChat } from "../../chat/chat-with-ai.js";
import { startToolChat } from "../../chat/chat-with-ai-tool.js";
import { startAgentChat } from "../../chat/chat-with-ai-agent.js";
import { ChatService } from "../../../service/chat.service.js";

const chatService = new ChatService();

/**
 * Ask the user whether to start a new conversation or resume an existing one
 * for the given mode.  Returns { conversationId: string|null }.
 */
async function askSessionStart(userId, mode) {
  const sessionChoice = await select({
    message: "How would you like to start?",
    options: [
      { value: "new", label: "New conversation", hint: "Start fresh" },
      { value: "resume", label: "Resume existing", hint: "Continue a previous chat" },
    ],
  });

  if (isCancel(sessionChoice)) {
    cancel(chalk.yellow("Cancelled"));
    process.exit(0);
  }

  if (sessionChoice === "new") {
    return null;
  }

  // Load past conversations for this mode
  const spinner = yoctoSpinner({ text: "Loading conversations..." }).start();
  const all = await chatService.getUserConversations(userId);
  spinner.stop();

  const filtered = all.filter((c) => c.mode === mode);

  if (filtered.length === 0) {
    console.log(chalk.yellow(`\nNo previous ${mode} conversations found. Starting a new one.\n`));
    return null;
  }

  const options = filtered.map((c) => {
    const preview = c.messages?.[0]?.content
      ? c.messages[0].content.slice(0, 60) + (c.messages[0].content.length > 60 ? "…" : "")
      : "No messages";
    const date = new Date(c.updatedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      value: c.id,
      label: c.title || "Untitled",
      hint: `${date} — ${preview}`,
    };
  });

  const selected = await select({
    message: "Select a conversation to resume:",
    options,
  });

  if (isCancel(selected)) {
    cancel(chalk.yellow("Cancelled"));
    process.exit(0);
  }

  return selected;
}

const wakeUpAction = async () => {
  const token = await getStoredToken();

  if (!token?.access_token) {
    console.log(chalk.red("Not authenticated. Please login."));
    return;
  }

  const spinner = yoctoSpinner({ text: "Fetching User Information..." });
  spinner.start();

  const user = await prisma.user.findFirst({
    where: {
      sessions: {
        some: { token: token.access_token },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
    },
  });

  spinner.stop();

  if (!user) {
    console.log(chalk.red("User not found."));
    return;
  }

  console.log(chalk.green(`\nWelcome back, ${user.name}!\n`));

  const choice = await select({
    message: "Select an option:",
    options: [
      {
        value: "chat",
        label: "Chat",
        hint: "Simple chat with AI",
      },
      {
        value: "tool",
        label: "Tool Calling",
        hint: "Chat with tools (Google Search, Code Execution)",
      },
      {
        value: "agent",
        label: "Agentic Mode",
        hint: "Advanced AI agent (Coming soon)",
      },
    ],
  });

  if (isCancel(choice)) {
    cancel(chalk.yellow("Cancelled"));
    return;
  }

  switch (choice) {
    case "chat": {
      const conversationId = await askSessionStart(user.id, "chat");
      await startChat("chat", conversationId);
      break;
    }
    case "tool": {
      const conversationId = await askSessionStart(user.id, "tool");
      await startToolChat(conversationId);
      break;
    }
    case "agent": {
      const conversationId = await askSessionStart(user.id, "agent");
      await startAgentChat(conversationId);
      break;
    }
  }
};

export const wakeUp = new Command("wakeup")
  .description("Wake up the AI")
  .action(wakeUpAction);

import chalk from "chalk";
import boxen from "boxen";
import { select, isCancel, cancel, intro, outro } from "@clack/prompts";
import { Command } from "commander";
import yoctoSpinner from "yocto-spinner";
import { getStoredToken } from "../auth/login.js";
import prisma from "../../../lib/db.js";
import { ChatService } from "../../../service/chat.service.js";
import { startChat } from "../../chat/chat-with-ai.js";
import { startToolChat } from "../../chat/chat-with-ai-tool.js";
import { startAgentChat } from "../../chat/chat-with-ai-agent.js";

const chatService = new ChatService();

async function getUserFromToken() {
  const token = await getStoredToken();

  if (!token?.access_token) {
    throw new Error("Not authenticated. Please run 'orbit login' first.");
  }

  const spinner = yoctoSpinner({ text: "Authenticating..." }).start();

  const user = await prisma.user.findFirst({
    where: {
      sessions: {
        some: { token: token.access_token },
      },
    },
  });

  spinner.stop();

  if (!user) {
    throw new Error("User not found. Please login again.");
  }

  return user;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function historyAction() {
  try {
    intro(
      boxen(chalk.bold.cyan("📜 Conversation History"), {
        padding: 1,
        borderStyle: "double",
        borderColor: "cyan",
      })
    );

    const user = await getUserFromToken();

    const spinner = yoctoSpinner({ text: "Loading conversations..." }).start();
    const conversations = await chatService.getUserConversations(user.id);
    spinner.stop();

    if (conversations.length === 0) {
      const emptyBox = boxen(
        chalk.yellow("No conversations found.\nStart a new chat with: orbit wakeup"),
        {
          padding: 1,
          margin: 1,
          borderStyle: "round",
          borderColor: "yellow",
        }
      );
      console.log(emptyBox);
      outro(chalk.gray("No history yet."));
      return;
    }

    // Build select options — one per conversation
    const options = conversations.map((c) => {
      const preview = c.messages?.[0]?.content
        ? c.messages[0].content.slice(0, 60) + (c.messages[0].content.length > 60 ? "…" : "")
        : "No messages";
      const modeTag = chalk.gray(`[${c.mode}]`);
      const date = chalk.gray(formatDate(c.updatedAt));
      return {
        value: c.id,
        label: `${c.title || "Untitled"} ${modeTag}`,
        hint: `${date} — ${preview}`,
      };
    });

    const selected = await select({
      message: "Select a conversation to resume:",
      options,
    });

    if (isCancel(selected)) {
      cancel(chalk.yellow("Cancelled"));
      return;
    }

    // Find the selected conversation to get its mode
    const conversation = conversations.find((c) => c.id === selected);

    console.log(
      chalk.green(`\n▶  Resuming: ${conversation.title || "Untitled"}\n`)
    );

    // Resume in the correct mode, passing the conversation ID so history is loaded
    switch (conversation.mode) {
      case "tool":
        await startToolChat(selected);
        break;
      case "agent":
        await startAgentChat(selected);
        break;
      case "chat":
      default:
        await startChat(conversation.mode, selected);
        break;
    }

    outro(chalk.green("✨ Session ended."));
  } catch (error) {
    const errorBox = boxen(chalk.red(`❌ Error: ${error.message}`), {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "red",
    });
    console.log(errorBox);
    process.exit(1);
  }
}

export const history = new Command("history")
  .description("Browse and resume past conversations")
  .action(historyAction);

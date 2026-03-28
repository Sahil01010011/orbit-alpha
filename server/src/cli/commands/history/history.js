import chalk from "chalk";
import boxen from "boxen";
import { select, confirm, isCancel, cancel, intro, outro } from "@clack/prompts";
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

export async function historyAction() {
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
    const buildOptions = (convs) =>
      convs.map((c) => {
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

    // Ask what the user wants to do
    const action = await select({
      message: "What would you like to do?",
      options: [
        { value: "resume", label: "Resume a conversation" },
        { value: "delete", label: "Delete a conversation" },
      ],
    });

    if (isCancel(action)) {
      cancel(chalk.yellow("Cancelled"));
      return;
    }

    if (action === "delete") {
      // Show conversation list for deletion
      const toDelete = await select({
        message: "Select a conversation to delete:",
        options: buildOptions(conversations),
      });

      if (isCancel(toDelete)) {
        cancel(chalk.yellow("Cancelled"));
        return;
      }

      const conversation = conversations.find((c) => c.id === toDelete);
      const name = conversation?.title || "Untitled";

      // Confirmation prompt
      const confirmed = await confirm({
        message: `Are you sure you want to delete ${chalk.bold(name)}? ${chalk.red("This cannot be undone.")}`,
        initialValue: false,
      });

      if (isCancel(confirmed) || !confirmed) {
        cancel(chalk.yellow("Cancelled"));
        return;
      }

      // Delete using the service
      const deleteSpinner = yoctoSpinner({ text: "Deleting conversation..." }).start();
      await chatService.deleteConversation(toDelete, user.id);
      deleteSpinner.stop();

      console.log(
        chalk.green(`\n✅ Conversation "${name}" has been deleted.\n`)
      );
      outro(chalk.green("Done."));
      return;
    }

    // action === "resume"
    const selected = await select({
      message: "Select a conversation to resume:",
      options: buildOptions(conversations),
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

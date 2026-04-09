import chalk from "chalk";
import { Command } from "commander";
import yoctoSpinner from "yocto-spinner";
import path from "path";
import { promises as fs } from "fs";
import { getStoredToken } from "../auth/login.js";
import prisma from "../../../lib/db.js";
import { select, text, confirm, isCancel, cancel } from "@clack/prompts";
import { getProviderInfo, registerProvider, getProvider } from "../../ai/provider-factory.js";
import { ClaudeProvider } from "../../ai/providers/claude-provider.js";
import { OpenAIProvider } from "../../ai/providers/openai-provider.js";
import { startChat } from "../../chat/chat-with-ai.js";
import { startToolChat } from "../../chat/chat-with-ai-tool.js";
import { startAgentChat } from "../../chat/chat-with-ai-agent.js";
import { startIterativeAgentChat } from "../../chat/chat-with-ai-iterative.js";
import { ChatService } from "../../../service/chat.service.js";
import { historyAction } from "../history/history.js";

const chatService = new ChatService();

// Sentinel value used to signal "go back to main menu" from sub-prompts.
const BACK = "__BACK__";

async function selectModelProvider() {
  const providers = getProviderInfo();

  const options = providers.map((p) => ({
    value: p.key,
    label: p.name,
    hint: p.available
      ? "API key configured ✓"
      : `Not configured — ${p.hint}`,
  }));

  const selected = await select({
    message: chalk.cyan("Select AI model:"),
    options,
    initialValue: "gemini",
  });

  if (isCancel(selected)) {
    cancel(chalk.yellow("Model selection cancelled"));
    process.exit(0);
  }

  const chosenProvider = providers.find((p) => p.key === selected);

  if (!chosenProvider.available) {
    console.log(chalk.red(`\n✗ ${chosenProvider.name} requires ${chosenProvider.hint}\n`));
    console.log(chalk.yellow("Falling back to Gemini.\n"));
    process.env.ORBITAL_MODEL_PROVIDER = "gemini";
  } else {
    process.env.ORBITAL_MODEL_PROVIDER = selected;
    const provider = getProvider();
    const isSelectedProvider = provider.getProviderName() === chosenProvider.name;
    if (!isSelectedProvider) {
      process.env.ORBITAL_MODEL_PROVIDER = "gemini";
      return;
    }
  }
}

/**
 * Prompt the user for an output directory.
 * Defaults to the directory where `orbit` was originally invoked.
 * If the path does not exist the user is offered to create it.
 * @param {string} invocationDir - The directory captured at CLI startup
 * @returns {Promise<string>} Resolved absolute output path
 */
async function promptOutputDirectory(invocationDir) {
  const answer = await text({
    message: "Where should the output be created?",
    placeholder: invocationDir,
    defaultValue: invocationDir,
  });

  if (isCancel(answer)) {
    cancel(chalk.yellow("Cancelled"));
    process.exit(0);
  }

  const outputDir = path.resolve(answer || invocationDir);

  try {
    await fs.access(outputDir);
  } catch {
    const shouldCreate = await confirm({
      message: `Directory "${outputDir}" does not exist. Create it?`,
      initialValue: true,
    });

    if (isCancel(shouldCreate) || !shouldCreate) {
      cancel(chalk.yellow("Cancelled"));
      process.exit(0);
    }

    await fs.mkdir(outputDir, { recursive: true });
    console.log(chalk.green(`✓ Created directory: ${outputDir}`));
  }

  return outputDir;
}

/**
 * Ask the user whether to start a new conversation or resume an existing one
 * for the given mode.
 * Returns null for a new conversation, a conversation ID string to resume,
 * or BACK to return to the main menu.
 */
async function askSessionStart(userId, mode) {
  const sessionChoice = await select({
    message: "How would you like to start?",
    options: [
      { value: "new", label: "New conversation", hint: "Start fresh" },
      { value: "resume", label: "Resume existing", hint: "Continue a previous chat" },
      { value: BACK, label: "← Back to main menu" },
    ],
  });

  if (isCancel(sessionChoice)) {
    cancel(chalk.yellow("Cancelled"));
    process.exit(0);
  }

  if (sessionChoice === BACK) return BACK;

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

  // Build options using the conversation ID as the unique value.
  // Deduplicate by ID and remove any entries without a valid ID.
  const seen = new Set();
  const options = filtered
    .filter((c) => c.id != null)
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .map((c) => {
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

  options.push({ value: BACK, label: "← Back to main menu" });

  const selected = await select({
    message: "Select a conversation to resume:",
    options,
  });

  if (isCancel(selected)) {
    cancel(chalk.yellow("Cancelled"));
    process.exit(0);
  }

  if (selected === BACK) return BACK;

  return selected;
}

const wakeUpAction = async (options, invocationDir) => {
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

  await selectModelProvider();

  // Persistent main-menu loop — exits only when the user explicitly chooses "Exit"
  // or presses Ctrl+C.
  while (true) {
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
          label: options.iterative ? "Agentic Mode (Iterative Loop)" : "Agentic Mode",
          hint: options.iterative
            ? "Reasoning loop: goal → plan → act → reflect"
            : "Autonomous application generator",
        },
        {
          value: "history",
          label: "View conversation history",
          hint: "Browse and resume past conversations",
        },
        {
          value: "exit",
          label: "Exit",
          hint: "Quit Orbital CLI",
        },
      ],
    });

    if (isCancel(choice) || choice === "exit") {
      cancel(chalk.yellow("Goodbye! 👋"));
      process.exit(0);
    }

    switch (choice) {
      case "chat": {
        const conversationId = await askSessionStart(user.id, "chat");
        if (conversationId === BACK) continue;
        await startChat("chat", conversationId);
        break;
      }
      case "tool": {
        const conversationId = await askSessionStart(user.id, "tool");
        if (conversationId === BACK) continue;
        await startToolChat(conversationId);
        break;
      }
      case "agent": {
        const conversationId = await askSessionStart(user.id, "agent");
        if (conversationId === BACK) continue;
        const outputDir = await promptOutputDirectory(invocationDir);
        if (options.iterative) {
          await startIterativeAgentChat(conversationId, outputDir);
        } else {
          await startAgentChat(conversationId, outputDir);
        }
        break;
      }
      case "history": {
        await historyAction();
        break;
      }
    }

    // Visual separator between sessions
    console.log("\n" + chalk.gray("─".repeat(60)) + "\n");

    // After every completed action, ask whether to return or exit
    const next = await select({
      message: "What would you like to do next?",
      options: [
        { value: "menu", label: "Return to main menu" },
        { value: "exit", label: "Exit" },
      ],
    });

    if (isCancel(next) || next === "exit") {
      cancel(chalk.yellow("Goodbye! 👋"));
      process.exit(0);
    }

    // next === "menu" → loop continues, showing the main menu again
    console.log("\n" + chalk.gray("─".repeat(60)) + "\n");
  }
};

export function createWakeUpCommand(invocationDir) {
  return new Command("wakeup")
    .description("Wake up the AI")
    .option("--iterative", "Use iterative agent reasoning loop (goal → plan → act → reflect)")
    .action((options) => wakeUpAction(options, invocationDir));
}

import chalk from "chalk";
import { text, isCancel, confirm } from "@clack/prompts";
import { AIService } from "../ai/google-service.js";
import { ChatService } from "../../service/chat.service.js";
import { getStoredToken } from "../commands/auth/login.js";
import prisma from "../../lib/db.js";
import { generateApplication } from "../../config/agent.config.js";

const aiService = new AIService();
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

async function initConversation(userId, conversationId = null, outputDir) {
  const conversation = await chatService.getOrCreateConversation(
    userId,
    conversationId,
    'agent'
  );

  console.log(
    chalk.hex('#22d3ee').bold('orbit α') +
    chalk.hex('#374151')(' │ ') +
    chalk.hex('#c084fc')('agent') +
    chalk.hex('#374151')(' │ ') +
    chalk.hex('#6b7280')(conversation.id.slice(0, 8)) +
    chalk.hex('#374151')(' │ ') +
    chalk.hex('#4ade80')(outputDir)
  );
  console.log(chalk.hex('#1e2230')('─'.repeat(60)));
  console.log('');

  return conversation;
}

async function saveMessage(conversationId, role, content) {
  return await chatService.addMessage(conversationId, role, content);
}

async function agentLoop(conversation, outputDir) {
  console.log(
    chalk.hex('#6b7280')(
      'describe what you want to build  ·  "exit" to quit  ·  ctrl+c to force quit'
    )
  );
  console.log('');

  while (true) {
    const userInput = await text({
      message: chalk.hex('#38bdf8')('›'),
      placeholder: "Describe your application...",
      validate(value) {
        if (!value || value.trim().length === 0) {
          return "Description cannot be empty";
        }
        if (value.trim().length < 10) {
          return "Please provide more details (at least 10 characters)";
        }
      },
    });

    if (isCancel(userInput)) {
      console.log('');
      console.log(chalk.hex('#6b7280')('session cancelled'));
      process.exit(0);
    }

    if (userInput.toLowerCase() === 'exit') {
      console.log('');
      console.log(chalk.hex('#6b7280')('session ended'));
      break;
    }

    console.log('');
    console.log(chalk.hex('#38bdf8').bold('you'));
    console.log(
      chalk.hex('#38bdf8')('│ ') +
      chalk.hex('#e2e8f0')(userInput)
    );
    console.log('');

    await saveMessage(conversation.id, 'user', userInput);

    try {
      console.log(chalk.hex('#c084fc').bold('orbit'));
      console.log(
        chalk.hex('#374151')('│ ') +
        chalk.hex('#facc15')('generating application...')
      );
      console.log('');

      const result = await generateApplication(
        userInput,
        aiService,
        outputDir
      );

      if (result && result.success) {
        const responseMessage =
          `Generated application: ${result.folderName}\n` +
          `Files created: ${result.files.length}\n` +
          `Location: ${result.appDir}\n\n` +
          `Setup commands:\n${result.commands.join('\n')}`;

        await saveMessage(conversation.id, 'assistant', responseMessage);

        console.log(chalk.hex('#c084fc').bold('orbit'));
        console.log(
          chalk.hex('#374151')('│ ') +
          chalk.hex('#4ade80')('application generated successfully')
        );
        console.log('');

        console.log(
          chalk.hex('#374151')('  ▸ ') +
          chalk.hex('#6b7280')('name      ') +
          chalk.hex('#f9fafb')(result.folderName)
        );
        console.log(
          chalk.hex('#374151')('  ▸ ') +
          chalk.hex('#6b7280')('location  ') +
          chalk.hex('#22d3ee')(result.appDir)
        );
        console.log(
          chalk.hex('#374151')('  ▸ ') +
          chalk.hex('#6b7280')('files     ') +
          chalk.hex('#f9fafb')(result.files.length + ' created')
        );

        if (result.commands && result.commands.length > 0) {
          console.log('');
          console.log(chalk.hex('#6b7280')('── setup commands ' + '─'.repeat(42)));
          result.commands.forEach(cmd => {
            console.log(
              chalk.hex('#374151')('  $ ') +
              chalk.hex('#22d3ee')(cmd)
            );
          });
        }

        console.log('');
        console.log(chalk.hex('#1e2230')('─'.repeat(60)));
        console.log('');

        const continuePrompt = await confirm({
          message: chalk.hex('#38bdf8')('generate another application?'),
          initialValue: false,
        });

        if (isCancel(continuePrompt) || !continuePrompt) {
          console.log('');
          console.log(chalk.hex('#6b7280')('session ended'));
          break;
        }

        console.log('');

      } else {
        throw new Error('Generation returned no result');
      }

    } catch (error) {
      console.log('');
      console.log(chalk.hex('#f87171')('error: ' + error.message));
      console.log('');

      await saveMessage(conversation.id, "assistant", `Error: ${error.message}`);

      const retry = await confirm({
        message: chalk.hex('#38bdf8')('try again?'),
        initialValue: true,
      });

      if (isCancel(retry) || !retry) {
        break;
      }

      console.log('');
    }
  }
}

export async function startAgentChat(conversationId = null, outputDir = process.cwd()) {
  try {
    const user = await getUserFromToken();

    console.log('');
    const shouldContinue = await confirm({
      message: chalk.hex('#facc15')(
        'agent will create files in "' + outputDir + '" — continue?'
      ),
      initialValue: true,
    });

    if (isCancel(shouldContinue) || !shouldContinue) {
      console.log(chalk.hex('#6b7280')('agent mode cancelled'));
      return;
    }

    console.log('');
    const conversation = await initConversation(user.id, conversationId, outputDir);
    await agentLoop(conversation, outputDir);

  } catch (error) {
    console.log('');
    console.log(chalk.hex('#f87171')('error: ' + error.message));
  }
}

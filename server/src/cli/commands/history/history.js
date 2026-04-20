import chalk from "chalk";
import { select, confirm, isCancel } from "@clack/prompts";
import { Command } from "commander";
import yoctoSpinner from "yocto-spinner";
import { getStoredToken } from "../auth/login.js";
import prisma from "../../../lib/db.js";
import { ChatService } from "../../../service/chat.service.js";
import { startChat } from "../../chat/chat-with-ai.js";
import { startToolChat } from "../../chat/chat-with-ai-tool.js";
import { startAgentChat } from "../../chat/chat-with-ai-agent.js";

const chatService = new ChatService();

// Sentinel value used to signal "go back" from a sub-prompt.
const BACK = "__BACK__";

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

export async function historyAction() {
  try {
    const user = await getUserFromToken();

    const spinner = yoctoSpinner({
      text: chalk.hex('#6b7280')('loading conversations...'),
      color: 'yellow',
    }).start();
    const conversations = await chatService.getUserConversations(user.id);
    spinner.stop();

    const buildOptions = (convs) => {
      const seen = new Set();
      return convs
        .filter((c) => c.id != null)
        .filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        })
        .map((c) => {
          const preview = c.messages?.[0]?.content
            ? c.messages[0].content.slice(0, 55) +
              (c.messages[0].content.length > 55 ? '...' : '')
            : 'no messages';
          const date = new Date(c.updatedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          const modeBadge =
            c.mode === 'chat'
              ? chalk.hex('#083344').bgHex('#083344')(
                  chalk.hex('#22d3ee')(' chat ')
                )
              : c.mode === 'tool'
              ? chalk.hex('#052e16').bgHex('#052e16')(
                  chalk.hex('#4ade80')(' tool ')
                )
              : chalk.hex('#1e1b4b').bgHex('#1e1b4b')(
                  chalk.hex('#a78bfa')(' agent ')
                );
          return {
            value: c.id,
            label:
              chalk.hex('#f9fafb')(
                (c.title || 'Untitled').slice(0, 45) +
                  ((c.title || 'Untitled').length > 45 ? '...' : '')
              ) +
              '  ' +
              modeBadge,
            hint:
              chalk.hex('#6b7280')(date) +
              chalk.hex('#374151')('  ·  ') +
              chalk.hex('#6b7280')(preview),
          };
        });
    };

    console.log(
      chalk.hex('#22d3ee').bold('orbit α') +
      chalk.hex('#374151')(' │ ') +
      chalk.hex('#a78bfa')('history') +
      chalk.hex('#374151')(' │ ') +
      chalk.hex('#6b7280')(conversations.length + ' conversations')
    );
    console.log(chalk.hex('#1e2230')('─'.repeat(60)));
    console.log('');

    if (conversations.length === 0) {
      console.log(chalk.hex('#facc15')('no conversations found'));
      console.log(chalk.hex('#6b7280')('start a new chat with: orbit wakeup'));
      console.log('');
      return;
    }

    const action = await select({
      message: chalk.hex('#38bdf8')('what would you like to do?'),
      options: [
        {
          value: 'resume',
          label: chalk.hex('#22d3ee')('resume a conversation'),
          hint: 'continue where you left off',
        },
        {
          value: 'delete',
          label: chalk.hex('#f87171')('delete a conversation'),
          hint: 'permanently remove a conversation',
        },
        {
          value: BACK,
          label: chalk.hex('#6b7280')('back to main menu'),
        },
      ],
    });

    if (isCancel(action) || action === BACK) {
      return;
    }

    if (action === 'delete') {
      const deleteOptions = [
        ...buildOptions(conversations),
        { value: BACK, label: chalk.hex('#6b7280')('cancel — back to menu') },
      ];

      const toDelete = await select({
        message: chalk.hex('#f87171')('select a conversation to delete:'),
        options: deleteOptions,
      });

      if (isCancel(toDelete) || toDelete === BACK) {
        return;
      }

      const conversation = conversations.find((c) => c.id === toDelete);
      const name = (conversation?.title || 'Untitled').slice(0, 50);

      console.log('');
      console.log(chalk.hex('#374151')('── selected ' + '─'.repeat(48)));
      console.log(
        chalk.hex('#374151')('  ▸ ') +
        chalk.hex('#f9fafb')(name)
      );
      console.log('');
      console.log(
        chalk.hex('#3d1515')('  ! ') +
        chalk.hex('#f87171').bold('this action cannot be undone')
      );
      console.log(
        chalk.hex('#6b7280')(
          '    all messages in this conversation will be permanently deleted'
        )
      );
      console.log('');

      const confirmed = await confirm({
        message: chalk.hex('#f87171')('delete "' + name + '"?'),
        initialValue: false,
      });

      if (isCancel(confirmed) || !confirmed) {
        console.log('');
        console.log(chalk.hex('#6b7280')('cancelled — conversation kept'));
        console.log('');
        return;
      }

      const deleteSpinner = yoctoSpinner({
        text: chalk.hex('#6b7280')('deleting...'),
        color: 'yellow',
      }).start();
      await chatService.deleteConversation(toDelete, user.id);
      deleteSpinner.stop();

      console.log('');
      console.log(chalk.hex('#4ade80')('deleted  ·  "' + name + '"'));
      console.log('');
      return;
    }

    const resumeOptions = [
      ...buildOptions(conversations),
      { value: BACK, label: chalk.hex('#6b7280')('cancel — back to menu') },
    ];

    const selected = await select({
      message: chalk.hex('#38bdf8')('select a conversation to resume:'),
      options: resumeOptions,
    });

    if (isCancel(selected) || selected === BACK) {
      return;
    }

    const conversation = conversations.find((c) => c.id === selected);
    const name = conversation?.title || 'Untitled';

    console.log('');
    console.log(
      chalk.hex('#4ade80')('resuming  ·  ') +
      chalk.hex('#f9fafb')(name)
    );
    console.log('');

    switch (conversation.mode) {
      case 'tool':
        await startToolChat(selected);
        break;
      case 'agent':
        await startAgentChat(selected);
        break;
      case 'chat':
      default:
        await startChat(conversation.mode, selected);
        break;
    }

    console.log('');
    console.log(chalk.hex('#6b7280')('session ended'));
    console.log('');
  } catch (error) {
    console.log('');
    console.log(chalk.hex('#f87171')('error: ' + error.message));
    console.log('');
  }
}

export const history = new Command("history")
  .description("Browse and resume past conversations")
  .action(historyAction);

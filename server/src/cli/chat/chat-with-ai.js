import React from 'react';
import { render } from 'ink';
import { ChatView } from '../ui/ChatView.js';
import { getActiveProviderInfo, sendMessageWithFallback } from '../ai/provider-factory.js';
import { ChatService } from '../../service/chat.service.js';
import { getStoredToken } from '../commands/auth/login.js';
import prisma from '../../lib/db.js';
import { ORBITAL_SYSTEM_PROMPT } from '../../config/agent.config.js';

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

async function initConversation(userId, conversationId = null, mode = 'chat') {
  const conversation = await chatService.getOrCreateConversation(
    userId,
    conversationId,
    mode
  );
  return conversation;
}

async function saveMessage(conversationId, role, content) {
  return await chatService.addMessage(conversationId, role, content);
}

async function updateConversationTitle(conversationId, userInput, messageCount) {
  if (messageCount === 1) {
    const title = userInput.slice(0, 50) + (userInput.length > 50 ? '...' : '');
    await chatService.updateTitle(conversationId, title);
  }
}

async function startChatWithInk(conversation) {
  const { activeName } = getActiveProviderInfo();

  const dbMessages = await chatService.getMessages(conversation.id);
  let currentMessages = dbMessages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  let isThinking = false;
  let streamingContent = '';
  let inkInstance = null;

  function getProps(onSubmitFn) {
    return {
      conversationTitle: conversation.title,
      conversationId: conversation.id,
      model: activeName,
      mode: 'chat',
      initialMessages: currentMessages,
      isThinking,
      streamingContent,
      onSubmit: onSubmitFn,
      onExit: () => inkInstance && inkInstance.unmount(),
    };
  }

  async function handleUserInput(userText) {
    if (userText.toLowerCase() === 'exit') {
      inkInstance && inkInstance.unmount();
      return;
    }

    currentMessages = [
      ...currentMessages,
      { role: 'user', content: userText },
    ];
    isThinking = true;
    streamingContent = '';
    inkInstance && inkInstance.rerender(
      React.createElement(ChatView, getProps(handleUserInput))
    );

    await saveMessage(conversation.id, 'user', userText);

    const messageCountBefore = currentMessages.length - 1;
    let fullResponse = '';

    try {
      const result = await sendMessageWithFallback(
        currentMessages.map(m => ({ role: m.role, content: m.content })),
        (chunk) => {
          streamingContent += chunk;
          fullResponse += chunk;
          inkInstance && inkInstance.rerender(
            React.createElement(ChatView, getProps(handleUserInput))
          );
        },
        { system: ORBITAL_SYSTEM_PROMPT }
      );
      fullResponse = result.content || fullResponse;
    } catch (err) {
      fullResponse = `Error: ${err.message}`;
    }

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: fullResponse },
    ];
    isThinking = false;
    streamingContent = '';

    await saveMessage(conversation.id, 'assistant', fullResponse);
    await updateConversationTitle(
      conversation.id,
      currentMessages.find(m => m.role === 'user')?.content || '',
      messageCountBefore
    );

    inkInstance && inkInstance.rerender(
      React.createElement(ChatView, getProps(handleUserInput))
    );
  }

  inkInstance = render(
    React.createElement(ChatView, getProps(handleUserInput))
  );

  await inkInstance.waitUntilExit();
}

export async function startChat(mode = 'chat', conversationId = null) {
  try {
    const user = await getUserFromToken();
    const conversation = await initConversation(user.id, conversationId, mode);
    await startChatWithInk(conversation);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

import chalk from "chalk";
import React, { useState } from "react";
import { render } from "ink";
import { intro, outro } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { ChatView } from "../ui/ChatView.jsx";
import {
  sendMessageWithFallback,
  getActiveProviderInfo,
} from "../ai/provider-factory.js";
import { ChatService } from "../../service/chat.service.js";
import { getStoredToken } from "../commands/auth/login.js";
import prisma from "../../lib/db.js";
import { ORBITAL_SYSTEM_PROMPT } from "../../config/agent.config.js";

// Initialize services
// const aiService = getProvider();
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

  if (!user) {
    spinner.error("User not found");
    throw new Error("User not found. Please login again.");
  }

  spinner.success(`Welcome back, ${user.name}!`);
  return user;
}

async function initConversation(userId, conversationId = null, mode = "chat") {
  const spinner = yoctoSpinner({ text: "Loading conversation..." }).start();
  
  const conversation = await chatService.getOrCreateConversation(
    userId,
    conversationId,
    mode
  );
  
  spinner.success("Conversation loaded");
  
  return conversation;
}

async function saveMessage(conversationId, role, content) {
  return await chatService.addMessage(conversationId, role, content);
}

async function startChatWithInk(conversation, user) {
  const { activeName } = getActiveProviderInfo();
  const dbMessages = await chatService.getMessages(conversation.id);
  const initialMessages = dbMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let currentMessages = [...initialMessages];
  let isThinking = false;
  let streamingContent = "";
  let inkInstance = null;

  const rerender = () => {
    if (inkInstance) {
      inkInstance.rerender(
        React.createElement(ChatView, {
          conversationTitle: conversation.title,
          conversationId: conversation.id,
          model: activeName,
          mode: "chat",
          initialMessages: currentMessages,
          isThinking,
          streamingContent,
          onSubmit: handleUserInput,
          onExit: () => inkInstance?.unmount(),
        })
      );
    }
  };

  const handleUserInput = async (userText) => {
    if (!userText || isThinking) {
      return;
    }

    if (userText.toLowerCase() === "exit") {
      inkInstance?.unmount();
      return;
    }

    currentMessages = [...currentMessages, { role: "user", content: userText }];
    isThinking = true;
    streamingContent = "";
    rerender();

    await saveMessage(conversation.id, "user", userText);

    const messageCountBeforeAI = (await chatService.getMessages(conversation.id)).length;

    let fullResponse = "";
    try {
      const aiMessages = currentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const result = await sendMessageWithFallback(
        aiMessages,
        (chunk) => {
          streamingContent += chunk;
          fullResponse += chunk;
          rerender();
        },
        { system: ORBITAL_SYSTEM_PROMPT }
      );

      fullResponse = result.content || fullResponse;
    } catch (err) {
      fullResponse = `Error: ${err.message}`;
    }

    currentMessages = [...currentMessages, { role: "assistant", content: fullResponse }];
    isThinking = false;
    streamingContent = "";
    await saveMessage(conversation.id, "assistant", fullResponse);
    await updateConversationTitle(conversation.id, userText, messageCountBeforeAI);
    rerender();
  };

  inkInstance = render(
    React.createElement(ChatView, {
      conversationTitle: conversation.title,
      conversationId: conversation.id,
      model: activeName,
      mode: "chat",
      initialMessages: currentMessages,
      isThinking: false,
      streamingContent: "",
      onSubmit: handleUserInput,
      onExit: () => {},
    })
  );

  await inkInstance.waitUntilExit();
}

async function updateConversationTitle(conversationId, userInput, messageCount) {
  if (messageCount === 1) {
    const title = userInput.slice(0, 50) + (userInput.length > 50 ? "..." : "");
    await chatService.updateTitle(conversationId, title);
  }
}

// Main entry point
export async function startChat(mode = "chat", conversationId = null) {
  try {
    // Display intro banner
    intro(chalk.bold.cyan("🚀 Orbit AI Chat"));

    const user = await getUserFromToken();
    const conversation = await initConversation(user.id, conversationId, mode);
    await startChatWithInk(conversation, user);
    outro(chalk.yellow("Chat session ended. Goodbye! 👋"));
  } catch (error) {
    console.log(chalk.red(`❌ Error: ${error.message}`));
    process.exit(1);
  }
}

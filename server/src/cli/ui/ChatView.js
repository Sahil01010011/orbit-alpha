import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBar } from './InputBar.js';
import { theme } from './theme.js';

export function ChatView({
  conversationTitle,
  conversationId,
  model,
  mode,
  initialMessages,
  onSubmit,
  onExit,
  isThinking,
  streamingContent,
}) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (onExit) onExit();
      exit();
    }
  });

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(StatusBar, {
      model: model,
      mode: mode || 'chat',
      sessionId: conversationId,
    }),
    React.createElement(Box, {
      flexDirection: 'column',
      marginY: 1,
      paddingX: 1,
    },
      React.createElement(MessageList, {
        messages: initialMessages,
        isThinking: isThinking,
        streamingContent: streamingContent,
      })
    ),
    React.createElement(InputBar, {
      onSubmit: onSubmit,
      disabled: isThinking,
      placeholder: 'Type a message... (Ctrl+C to exit)',
    })
  );
}

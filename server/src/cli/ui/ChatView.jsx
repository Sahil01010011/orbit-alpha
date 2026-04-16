import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { StatusBar } from './StatusBar.jsx';
import { MessageList } from './MessageList.jsx';
import { InputBar } from './InputBar.jsx';
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
  const [messages, setMessages] = useState(initialMessages || []);

  useEffect(() => {
    setMessages(initialMessages || []);
  }, [initialMessages]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (onExit) onExit();
      exit();
    }
  });

  const allMessages = streamingContent
    ? [...messages, { role: 'assistant', content: streamingContent }]
    : messages;

  return (
    <Box flexDirection="column">
      <StatusBar
        model={model}
        mode={mode || 'chat'}
        sessionId={conversationId}
      />
      <Box marginY={1} flexDirection="column">
        <MessageList messages={allMessages} />
      </Box>
      {isThinking && (
        <Box marginLeft={2} marginBottom={1}>
          <Text color={theme.yellow}>● thinking...</Text>
        </Box>
      )}
      <InputBar
        onSubmit={onSubmit}
        disabled={isThinking}
        placeholder="Type a message... (Ctrl+C to exit)"
      />
    </Box>
  );
}

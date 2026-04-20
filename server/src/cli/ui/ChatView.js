import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBar } from './InputBar.js';
import { theme } from './theme.js';

export function ChatView({
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

  return (
    <Box flexDirection="column">
      <StatusBar
        model={model}
        mode={mode || 'chat'}
        sessionId={conversationId}
      />
      <Box
        flexDirection="column"
        marginY={1}
        paddingX={1}
      >
        <MessageList
          messages={initialMessages}
          isThinking={isThinking}
          streamingContent={streamingContent}
        />
      </Box>
      <InputBar
        onSubmit={onSubmit}
        disabled={isThinking}
        placeholder="type a message..."
      />
    </Box>
  );
}

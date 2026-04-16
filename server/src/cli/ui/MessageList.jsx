import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

function ToolCallItem({ toolName, status, args }) {
  const statusIcon = status === 'done' 
    ? <Text color={theme.green}>✓</Text>
    : status === 'error'
    ? <Text color={theme.red}>✗</Text>
    : <Text color={theme.yellow}>…</Text>;

  return (
    <Box gap={1} marginLeft={2}>
      <Text color={theme.gray}>▸</Text>
      <Text color={theme.cyan}>{toolName}</Text>
      {args && (
        <Text color={theme.dimGray}>
          {JSON.stringify(args).slice(0, 60)}
        </Text>
      )}
      {statusIcon}
    </Box>
  );
}

function Message({ role, content, toolCalls }) {
  if (role === 'user') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.blue} bold>You</Text>
        <Box marginLeft={2}>
          <Text color={theme.white}>{content}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.purple} bold>Orbit</Text>
      {toolCalls && toolCalls.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {toolCalls.map((tc, i) => (
            <ToolCallItem
              key={i}
              toolName={tc.toolName}
              status={tc.status}
              args={tc.args}
            />
          ))}
        </Box>
      )}
      {content && (
        <Box marginLeft={2}>
          <Text color={theme.white}>{content}</Text>
        </Box>
      )}
    </Box>
  );
}

export function MessageList({ messages }) {
  if (!messages || messages.length === 0) {
    return (
      <Box marginLeft={2} marginTop={1}>
        <Text color={theme.gray} dimColor>
          Start a conversation...
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {messages.map((msg, i) => (
        <Message
          key={i}
          role={msg.role}
          content={msg.content}
          toolCalls={msg.toolCalls}
        />
      ))}
    </Box>
  );
}

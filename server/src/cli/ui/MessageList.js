import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

function CodeBlock({ code }) {
  return (
    <Box
      borderStyle="single"
      borderColor={theme.dimGray}
      paddingX={1}
      marginY={1}
    >
      <Text color={theme.cyan}>{code}</Text>
    </Box>
  );
}

function renderContent(content) {
  if (!content) return null;
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const code = part.replace(/^```\w*\n?/, '').replace(/```$/, '');
      return <CodeBlock key={i} code={code} />;
    }
    return (
      <Text key={i} color={theme.white} wrap="wrap">
        {part}
      </Text>
    );
  });
}

function ToolCallItem({ toolName, status, args }) {
  const statusColor = status === 'done' ? theme.green
    : status === 'error' ? theme.red
    : theme.yellow;
  const statusChar = status === 'done' ? '✓'
    : status === 'error' ? '✗' : '…';

  return (
    <Box gap={1} marginLeft={2}>
      <Text color={theme.gray}>▸</Text>
      <Text color={theme.cyan}>{toolName}</Text>
      {args && (
        <Text color={theme.dimGray}>
          {JSON.stringify(args).slice(0, 60)}
        </Text>
      )}
      <Text color={statusColor}>{statusChar}</Text>
    </Box>
  );
}

function Message({ role, content, toolCalls, isStreaming }) {
  if (role === 'user') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.blue} bold>you</Text>
        <Box marginLeft={2} borderStyle="single" borderColor={theme.dimGray} paddingX={1}>
          <Text color={theme.white} wrap="wrap">{content}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={theme.violet} bold>orbit</Text>
        {isStreaming && (
          <Text color={theme.yellow}>●</Text>
        )}
      </Box>
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
        <Box marginLeft={2} flexDirection="column">
          {renderContent(content)}
        </Box>
      )}
    </Box>
  );
}

export function MessageList({ messages, isThinking, streamingContent }) {
  if (!messages || messages.length === 0) {
    return (
      <Box marginLeft={2} marginTop={1}>
        <Text color={theme.gray} dimColor>
          start a conversation...
        </Text>
      </Box>
    );
  }

  const allMessages = streamingContent
    ? [
        ...messages,
        { role: 'assistant', content: streamingContent, isStreaming: true },
      ]
    : messages;

  return (
    <Box flexDirection="column">
      {allMessages.map((msg, i) => (
        <Message
          key={i}
          role={msg.role}
          content={msg.content}
          toolCalls={msg.toolCalls}
          isStreaming={msg.isStreaming}
        />
      ))}
      {isThinking && !streamingContent && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={theme.yellow}>● thinking...</Text>
        </Box>
      )}
    </Box>
  );
}

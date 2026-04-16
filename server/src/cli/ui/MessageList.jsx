import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

function renderContent(content) {
  if (!content) return null;

  const renderInline = (text, keyPrefix) => {
    const inlineParts = text.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*)/g);
    return inlineParts.map((inlinePart, j) => {
      if (
        inlinePart.startsWith("**") &&
        inlinePart.endsWith("**") &&
        inlinePart.length > 4
      ) {
        return (
          <Text key={`${keyPrefix}-b-${j}`} color="#f9fafb" bold>
            {inlinePart.slice(2, -2)}
          </Text>
        );
      }
      if (
        inlinePart.startsWith("*") &&
        inlinePart.endsWith("*") &&
        inlinePart.length > 2
      ) {
        return (
          <Text key={`${keyPrefix}-i-${j}`} color="#f9fafb" italic>
            {inlinePart.slice(1, -1)}
          </Text>
        );
      }
      return (
        <Text key={`${keyPrefix}-t-${j}`} color="#f9fafb">
          {inlinePart}
        </Text>
      );
    });
  };

  // Split on code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const code = part.replace(/^```\w*\n*/, '').replace(/```$/, '');
      return (
        <Box
          key={i}
          borderStyle="single"
          borderColor="#374151"
          paddingX={1}
          marginY={1}
        >
          <Text color="#22d3ee">{code}</Text>
        </Box>
      );
    }
    return <Box key={i} flexDirection="column">{renderInline(part, `inline-${i}`)}</Box>;
  });
}

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
        <Box marginLeft={2} flexDirection="column">
          {renderContent(content)}
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

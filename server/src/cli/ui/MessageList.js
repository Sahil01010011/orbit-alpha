import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

function renderContent(content) {
  if (!content) return null;
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const code = part.replace(/^```\w*\n?/, '').replace(/```$/, '');
      return (
        React.createElement(Box, {
          key: i,
          borderStyle: 'single',
          borderColor: theme.dimGray,
          paddingX: 1,
          marginY: 1,
        },
          React.createElement(Text, { color: theme.cyan }, code)
        )
      );
    }
    return React.createElement(Text, {
      key: i,
      color: theme.white,
      wrap: 'wrap',
    }, part);
  });
}

function ToolCallItem({ toolName, status, args }) {
  const statusColor = status === 'done'
    ? theme.green
    : status === 'error'
    ? theme.red
    : theme.yellow;

  const statusChar = status === 'done' ? '✓'
    : status === 'error' ? '✗' : '…';

  return React.createElement(Box, { gap: 1, marginLeft: 2 },
    React.createElement(Text, { color: theme.gray }, '▸'),
    React.createElement(Text, { color: theme.cyan }, toolName),
    args && React.createElement(Text, { color: theme.dimGray },
      JSON.stringify(args).slice(0, 60)
    ),
    React.createElement(Text, { color: statusColor }, statusChar)
  );
}

function Message({ role, content, toolCalls, isStreaming }) {
  if (role === 'user') {
    return React.createElement(Box, {
      flexDirection: 'column',
      marginBottom: 1,
    },
      React.createElement(Text, { color: theme.blue, bold: true }, 'You'),
      React.createElement(Box, { marginLeft: 2 },
        React.createElement(Text, { color: theme.white, wrap: 'wrap' }, content)
      )
    );
  }

  return React.createElement(Box, {
    flexDirection: 'column',
    marginBottom: 1,
  },
    React.createElement(Box, { gap: 1 },
      React.createElement(Text, { color: theme.purple, bold: true }, 'Orbit'),
      isStreaming && React.createElement(Text, { color: theme.yellow }, '●')
    ),
    toolCalls && toolCalls.length > 0 && React.createElement(Box, {
      flexDirection: 'column',
      marginBottom: 1,
    },
      ...toolCalls.map((tc, i) =>
        React.createElement(ToolCallItem, {
          key: i,
          toolName: tc.toolName,
          status: tc.status,
          args: tc.args,
        })
      )
    ),
    content && React.createElement(Box, { marginLeft: 2 },
      ...renderContent(content)
    )
  );
}

export function MessageList({ messages, isThinking, streamingContent }) {
  if (!messages || messages.length === 0) {
    return React.createElement(Box, { marginLeft: 2, marginTop: 1 },
      React.createElement(Text, { color: theme.gray, dimColor: true },
        'Start a conversation...'
      )
    );
  }

  const allMessages = streamingContent
    ? [
        ...messages,
        { role: 'assistant', content: streamingContent, isStreaming: true },
      ]
    : messages;

  return React.createElement(Box, { flexDirection: 'column' },
    ...allMessages.map((msg, i) =>
      React.createElement(Message, {
        key: i,
        role: msg.role,
        content: msg.content,
        toolCalls: msg.toolCalls,
        isStreaming: msg.isStreaming,
      })
    ),
    isThinking && !streamingContent && React.createElement(Box, {
      marginLeft: 2,
      marginTop: 1,
    },
      React.createElement(Text, { color: theme.yellow }, '● thinking...')
    )
  );
}

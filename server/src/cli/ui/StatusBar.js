import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export function StatusBar({ model, mode, sessionId, toolCount }) {
  return (
    <Box
      borderStyle="single"
      borderColor={theme.cyan}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={2}>
        <Text color={theme.cyan} bold>orbit α</Text>
        <Text color={theme.dimGray}>│</Text>
        <Text color={theme.violet}>{model || 'gemini 2.5 flash'}</Text>
        <Text color={theme.dimGray}>│</Text>
        <Text color={theme.blue}>{mode || 'chat'}</Text>
      </Box>
      <Box gap={2}>
        {toolCount > 0 && (
          <>
            <Text color={theme.green}>{toolCount} tools</Text>
            <Text color={theme.dimGray}>│</Text>
          </>
        )}
        <Text color={theme.gray}>
          {sessionId ? sessionId.slice(0, 8) : 'new'}
        </Text>
      </Box>
    </Box>
  );
}

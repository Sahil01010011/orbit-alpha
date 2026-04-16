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
        <Text color={theme.gray}>│</Text>
        <Text color={theme.purple}>{model || 'Gemini 2.5 Flash'}</Text>
        <Text color={theme.gray}>│</Text>
        <Text color={theme.blue}>{mode || 'chat'}</Text>
      </Box>
      <Box gap={2}>
        {toolCount > 0 && (
          <>
            <Text color={theme.gray}>{toolCount} tools</Text>
            <Text color={theme.gray}>│</Text>
          </>
        )}
        <Text color={theme.dimGray}>
          {sessionId ? sessionId.slice(0, 8) : 'new'}
        </Text>
      </Box>
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export function Banner() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.cyan}>{'  ██████╗ '}</Text>
        <Text color={theme.blue}>{'██████╗ '}</Text>
        <Text color={theme.purple}>{'██████╗ '}</Text>
        <Text color={theme.violet}>{'██╗████████╗'}</Text>
      </Box>
      <Box>
        <Text color={theme.cyan}>{' ██╔═══██╗'}</Text>
        <Text color={theme.blue}>{'██╔══██╗'}</Text>
        <Text color={theme.purple}>{'██╔══██╗'}</Text>
        <Text color={theme.violet}>{'██║╚══██╔══╝'}</Text>
      </Box>
      <Box>
        <Text color={theme.cyan}>{' ██║   ██║'}</Text>
        <Text color={theme.blue}>{'██████╔╝'}</Text>
        <Text color={theme.purple}>{'██████╔╝'}</Text>
        <Text color={theme.violet}>{'██║   ██║  '}</Text>
      </Box>
      <Box>
        <Text color={theme.cyan}>{' ██║   ██║'}</Text>
        <Text color={theme.blue}>{'██╔══██╗'}</Text>
        <Text color={theme.purple}>{'██╔══██╗'}</Text>
        <Text color={theme.violet}>{'██║   ██║  '}</Text>
      </Box>
      <Box>
        <Text color={theme.cyan}>{' ╚██████╔╝'}</Text>
        <Text color={theme.blue}>{'██║  ██║'}</Text>
        <Text color={theme.purple}>{'██████╔╝'}</Text>
        <Text color={theme.violet}>{'██║   ██║  '}</Text>
      </Box>
      <Box>
        <Text color={theme.cyan}>{'  ╚═════╝ '}</Text>
        <Text color={theme.blue}>{'╚═╝  ╚═╝'}</Text>
        <Text color={theme.purple}>{'╚═════╝ '}</Text>
        <Text color={theme.violet}>{'╚═╝   ╚═╝  '}</Text>
      </Box>
      <Text color={theme.pink}>
        {'  orbit α · autonomous cli developer agent'}
      </Text>
    </Box>
  );
}

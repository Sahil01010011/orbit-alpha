import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from './theme.js';

export function InputBar({ onSubmit, placeholder, disabled }) {
  const [value, setValue] = useState('');

  const handleSubmit = (val) => {
    if (val.trim() && !disabled) {
      onSubmit(val.trim());
      setValue('');
    }
  };

  return (
    <Box
      borderStyle="single"
      borderColor={disabled ? theme.gray : theme.cyan}
      paddingX={1}
      marginTop={1}
    >
      <Text color={disabled ? theme.gray : theme.cyan}>{'› '}</Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder={
          disabled ? 'thinking...' : (placeholder || 'type a message...')
        }
      />
      <Box flexGrow={1} />
      <Text color={theme.dimGray} dimColor>
        {'[ctrl+c] quit'}
      </Text>
    </Box>
  );
}

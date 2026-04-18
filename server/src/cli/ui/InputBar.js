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

  return React.createElement(Box, {
    borderStyle: 'single',
    borderColor: disabled ? theme.gray : theme.cyan,
    paddingX: 1,
    marginTop: 1,
  },
    React.createElement(Text, {
      color: disabled ? theme.gray : theme.cyan,
    }, '> '),
    React.createElement(TextInput, {
      value,
      onChange: setValue,
      onSubmit: handleSubmit,
      placeholder: disabled ? 'Thinking...' : (placeholder || 'Type a message...'),
    }),
    React.createElement(Box, { flexGrow: 1 }),
    React.createElement(Text, { color: theme.dimGray, dimColor: true }, '[Ctrl+C] quit')
  );
}
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export function StatusBar({ model, mode, sessionId, toolCount }) {
  return React.createElement(Box, {
    borderStyle: 'single',
    borderColor: theme.cyan,
    paddingX: 1,
    justifyContent: 'space-between',
  },
    React.createElement(Box, { gap: 2 },
      React.createElement(Text, { color: theme.cyan, bold: true }, 'orbit α'),
      React.createElement(Text, { color: theme.gray }, '│'),
      React.createElement(Text, { color: theme.purple }, model || 'Gemini 2.5 Flash'),
      React.createElement(Text, { color: theme.gray }, '│'),
      React.createElement(Text, { color: theme.blue }, mode || 'chat'),
    ),
    React.createElement(Box, { gap: 2 },
      toolCount > 0 && React.createElement(React.Fragment, null,
        React.createElement(Text, { color: theme.gray }, `${toolCount} tools`),
        React.createElement(Text, { color: theme.gray }, '│'),
      ),
      React.createElement(Text, { color: theme.dimGray },
        sessionId ? sessionId.slice(0, 8) : 'new'
      ),
    )
  );
}
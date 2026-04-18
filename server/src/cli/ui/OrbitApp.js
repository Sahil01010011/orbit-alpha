import React, { useState } from 'react';
import { Box, useApp } from 'ink';
import { Banner } from './Banner.js';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBar } from './InputBar.js';

export function OrbitApp({ 
  model, 
  mode, 
  sessionId, 
  toolCount,
  initialMessages = [] 
}) {
  const { exit } = useApp();
  const [messages, setMessages] = useState(initialMessages);

  const handleSubmit = (text) => {
    setMessages(prev => [
      ...prev,
      { role: 'user', content: text },
    ]);
  };

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Banner),
    React.createElement(StatusBar, {
      model,
      mode,
      sessionId,
      toolCount,
    }),
    React.createElement(Box, {
      flexDirection: 'column',
      flexGrow: 1,
      marginY: 1,
    },
      React.createElement(MessageList, { messages })
    ),
    React.createElement(InputBar, {
      onSubmit: handleSubmit,
      placeholder: 'Type a message...',
    })
  );
}
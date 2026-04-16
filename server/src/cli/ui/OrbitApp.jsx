import React, { useState } from 'react';
import { Box, Text, useApp } from 'ink';
import { Banner } from './Banner.jsx';
import { StatusBar } from './StatusBar.jsx';
import { MessageList } from './MessageList.jsx';
import { InputBar } from './InputBar.jsx';
import { theme } from './theme.js';

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

  return (
    <Box flexDirection="column" height="100%">
      <Banner />
      <StatusBar
        model={model}
        mode={mode}
        sessionId={sessionId}
        toolCount={toolCount}
      />
      <Box flexDirection="column" flexGrow={1} marginY={1}>
        <MessageList messages={messages} />
      </Box>
      <InputBar
        onSubmit={handleSubmit}
        placeholder="Type a message..."
      />
    </Box>
  );
}

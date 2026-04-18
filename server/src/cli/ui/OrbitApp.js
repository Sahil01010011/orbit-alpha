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

  return (
    <Box flexDirection="column">
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

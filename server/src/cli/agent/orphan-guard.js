export function fillOrphanedToolResults(messages) {
  const messagesCopy = [...messages];
  const toolUseIds = new Set();
  const toolResultIds = new Set();

  for (const message of messagesCopy) {
    if (message?.role !== 'assistant') {
      continue;
    }

    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const block of message.content) {
      if (block?.type === 'tool_use') {
        toolUseIds.add(block.id);
      }
    }
  }

  for (const message of messagesCopy) {
    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const block of message.content) {
      if (block?.type === 'tool_result') {
        toolResultIds.add(block.toolCallId);
      }
    }
  }

  for (const id of toolUseIds) {
    if (!toolResultIds.has(id)) {
      messagesCopy.push({
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolCallId: id,
            content: 'Tool execution was interrupted. No result available.',
          },
        ],
      });
    }
  }

  return messagesCopy;
}

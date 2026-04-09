const MESSAGE_THRESHOLD = 20;
const RECENT_MESSAGES_TO_PRESERVE = 6;

export async function compressIfNeeded(messages, aiService) {
  try {
    if (messages.length <= MESSAGE_THRESHOLD) {
      return messages;
    }

    if (!aiService || typeof aiService.getMessage !== "function") {
      return messages;
    }

    const recentMessages = messages.slice(-RECENT_MESSAGES_TO_PRESERVE);
    const olderMessages = messages.slice(0, -RECENT_MESSAGES_TO_PRESERVE);
    const prompt =
      "Provide a concise technical summary of this conversation. Preserve: decisions made, files created or modified, errors encountered, current task state.\n\n" +
      JSON.stringify(olderMessages);
    const summary = await aiService.getMessage(prompt);
    const summaryMessage = { role: "assistant", content: "Session summary: " + summary };
    return [summaryMessage, ...recentMessages];
  } catch (error) {
    return messages;
  }
}

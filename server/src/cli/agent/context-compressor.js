export async function compressIfNeeded(messages, aiService) {
  try {
    if (messages.length <= 20) {
      return messages;
    }

    const last6Messages = messages.slice(-6);
    const olderMessages = messages.slice(0, -6);
    const prompt =
      "Provide a concise technical summary of this conversation. Preserve: decisions made, files created or modified, errors encountered, current task state.\n\n" +
      JSON.stringify(olderMessages);
    const summary = await aiService.getMessage(prompt);
    const summaryMessage = { role: "assistant", content: "Session summary: " + summary };
    return [summaryMessage, ...last6Messages];
  } catch (error) {
    return messages;
  }
}

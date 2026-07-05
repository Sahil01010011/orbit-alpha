// token-manager.js
const MODEL_CONFIGS = {
  'gemini-2.5-flash': { contextWindow: 1_000_000, outputBuffer: 16_384 },
  'gemini-2.0-flash': { contextWindow: 1_000_000, outputBuffer: 16_384 },
  'gemini-1.5-flash': { contextWindow: 1_000_000, outputBuffer: 8_192 },
  'claude-3-5-sonnet': { contextWindow: 200_000, outputBuffer: 8_192 },
  'claude-opus-4': { contextWindow: 200_000, outputBuffer: 8_192 },
  'gpt-4o': { contextWindow: 128_000, outputBuffer: 4_096 },
  'gpt-4o-mini': { contextWindow: 128_000, outputBuffer: 4_096 },
  default: { contextWindow: 100_000, outputBuffer: 4_096 },
};

// Prefix match so dated/suffixed IDs (gpt-4o-2024-08-06) resolve correctly.
function resolveConfig(model = '') {
  if (MODEL_CONFIGS[model]) return MODEL_CONFIGS[model];
  const key = Object.keys(MODEL_CONFIGS)
    .filter((k) => k !== 'default' && model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]; // longest prefix wins
  return key ? MODEL_CONFIGS[key] : MODEL_CONFIGS.default;
}

// Byte-aware estimate: counts UTF-8 bytes / ~4. Handles CJK/emoji far better
// than String.length, which counts UTF-16 units.
const encoder = new TextEncoder();
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(encoder.encode(text).length / 4);
}

// Serialize any message into a single counted string, INCLUDING tool metadata
// (tool_calls, name, tool_call_id) that lives outside `content`.
function serializeForCount(message) {
  if (!message) return '';
  const parts = [];
  if (typeof message.content === 'string') parts.push(message.content);
  else if (message.content != null) parts.push(JSON.stringify(message.content));
  if (message.tool_calls) parts.push(JSON.stringify(message.tool_calls));
  if (message.function_call) parts.push(JSON.stringify(message.function_call));
  if (message.name) parts.push(message.name);
  if (message.tool_call_id) parts.push(message.tool_call_id);
  return parts.join('\n');
}

export function estimateMessageTokens(message) {
  if (!message) return 0;
  return estimateTokens(serializeForCount(message)) + 4; // per-message overhead
}

export function getModelBudget(model) {
  const c = resolveConfig(model);
  return c.contextWindow - c.outputBuffer;
}

// Truncate on a UTF-8 byte boundary so we never split a surrogate pair.
export function truncateToolResult(content, maxTokens = 4000) {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  const tokens = estimateTokens(str);
  if (tokens <= maxTokens) return str;
  const byteLimit = maxTokens * 4;
  const bytes = encoder.encode(str).slice(0, byteLimit);
  // fatal:false drops a trailing incomplete code point cleanly.
  const safe = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes)
    .replace(/\uFFFD$/, '');
  return `${safe}\n[TRUNCATED — original ${tokens} tokens, limit ${maxTokens}]`;
}

// True when a message must NOT be separated from its pair.
function toolCallIds(msg) {
  if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls))
    return msg.tool_calls.map((c) => c.id).filter(Boolean);
  return [];
}

export function preparePayload(messages, systemPrompt, model, ragChunks = [], opts = {}) {
  const RECENT_PRESERVE = opts.recentPreserve ?? 6;
  const TOOL_MAX = opts.toolResultMaxTokens ?? 4000;
  const RAG_FRACTION = opts.ragFraction ?? 0.2;
  const budget = getModelBudget(model);

  const stats = {
    model, budget,
    systemPromptTokens: estimateTokens(systemPrompt),
    ragDropped: 0, messagesDropped: 0, toolResultsTruncated: 0, overBudget: false,
  };
  let used = stats.systemPromptTokens;

  // --- Step 1: RAG, greedy by score, capped, and never past remaining budget ---
  const ragBudget = Math.min(Math.floor(budget * RAG_FRACTION), Math.max(0, budget - used));
  let ragUsed = 0;
  const keptRagChunks = [];
  for (const chunk of [...ragChunks].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    const t = estimateTokens(chunk.content);
    if (ragUsed + t <= ragBudget) { keptRagChunks.push(chunk); ragUsed += t; }
    else stats.ragDropped++;
  }
  used += ragUsed;

  // --- Step 2: truncate oversized tool results in place (preserve role/shape) ---
  const processed = messages.map((msg) => {
    const isToolish =
      msg.role === 'tool' || (msg.role === 'user' && Array.isArray(msg.content));
    if (!isToolish) return msg;
    const str = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    if (estimateTokens(str) <= TOOL_MAX) return msg;
    stats.toolResultsTruncated++;
    return { ...msg, content: truncateToolResult(str, TOOL_MAX), _truncated: true };
  });

  // --- Step 3: protected recent tail, but ENFORCE budget on it too ---
  let recent = processed.slice(-RECENT_PRESERVE);
  let older = processed.slice(0, -RECENT_PRESERVE);

  // If the tail alone overflows, shrink it from the oldest end.
  let recentTokens = recent.reduce((s, m) => s + estimateMessageTokens(m), 0);
  while (recentTokens > budget - used && recent.length > 1) {
    const dropped = recent.shift();
    recentTokens -= estimateMessageTokens(dropped);
    stats.messagesDropped++;
  }
  used += recentTokens;

  // --- Step 4: fill remaining budget with older messages, newest-first ---
  // Track which tool_call ids are satisfied in what we keep, to avoid orphans.
  const keptOlder = [];
  let remaining = budget - used;

  // Ids of tool results present in the recent tail (their calls must be kept).
  const neededCallIds = new Set();
  for (const m of recent) if (m.role === 'tool' && m.tool_call_id) neededCallIds.add(m.tool_call_id);

  for (let i = older.length - 1; i >= 0; i--) {
    const m = older[i];
    const t = estimateMessageTokens(m);
    const mustKeep = toolCallIds(m).some((id) => neededCallIds.has(id));
    if (mustKeep || t <= remaining) {
      keptOlder.unshift(m);
      remaining -= t;
      // keep this message's own tool linkage consistent
      if (m.role === 'tool' && m.tool_call_id) neededCallIds.add(m.tool_call_id);
      for (const id of toolCallIds(m)) neededCallIds.add(id);
    } else {
      stats.messagesDropped++;
    }
  }

  let finalMessages = [...keptOlder, ...recent];

  // --- Step 5: drop orphans (tool result whose call was cut, or assistant
  // tool_call whose result was cut) so the payload is always API-valid. ---
  const presentCallIds = new Set();
  for (const m of finalMessages) for (const id of toolCallIds(m)) presentCallIds.add(id);
  finalMessages = finalMessages.filter((m) => {
    if (m.role === 'tool' && m.tool_call_id && !presentCallIds.has(m.tool_call_id)) {
      stats.messagesDropped++;
      return false;
    }
    return true;
  });
  const presentResultIds = new Set(
    finalMessages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)
  );
  finalMessages = finalMessages.map((m) => {
    const ids = toolCallIds(m);
    if (ids.length && !ids.every((id) => presentResultIds.has(id))) {
      // strip unanswered tool_calls rather than drop assistant text
      const kept = m.tool_calls.filter((c) => presentResultIds.has(c.id));
      return kept.length ? { ...m, tool_calls: kept } : { ...m, tool_calls: undefined };
    }
    return m;
  });

  const totalEstimatedTokens =
    used + (budget - used - remaining - recentTokens >= 0 ? 0 : 0) + (budget - used - remaining);
  stats.totalEstimatedTokens =
    stats.systemPromptTokens + ragUsed +
    finalMessages.reduce((s, m) => s + estimateMessageTokens(m), 0);
  stats.overBudget = stats.totalEstimatedTokens > budget;
  stats.utilizationPercent = Math.round((stats.totalEstimatedTokens / budget) * 100);

  return { messages: finalMessages, ragChunks: keptRagChunks, stats };
}

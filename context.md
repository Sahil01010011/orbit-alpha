```markdown
# Orbit Alpha — Project Context Document

## What Is This Project
Orbit Alpha is an autonomous AI developer agent that runs in the terminal. The user installs it globally, runs `orbit wakeup` from any directory, and gets an AI agent that can chat, execute tools, plan and run multi-step tasks, read existing project context, and generate code directly into their working directory.

Built by Sahil Mallick (GitHub: Sahil01010011, repo: orbit-alpha). All development is done through GitHub Copilot agent sessions using GPT-5.x-Codex models. Sahil pastes prompts into the Copilot agent, reviews the diff, merges pull requests, then tests locally. All prompt writing and architectural decisions are made in collaboration with Claude.

---

## Tech Stack

**CLI layer:**
- Node.js ESM modules (`"type": "module"` in server/package.json)
- Clack for interactive prompts
- Chalk for terminal colors (hex-based color system)
- Commander.js for command routing
- Entry point: `server/src/cli/main.js`
- Global install via bin field in root `package.json`
- Command: `orbit wakeup`

**Backend:**
- Express.js server (only needed for initial GitHub OAuth login)
- Once authenticated, CLI runs fully standalone
- Agent orchestrator handles the reasoning loop

**Tool registry:**
- `server/src/tools/registry.js` — central registry
- `server/src/tools/index.js` — imports all tool files
- 32 built-in tools across 7 tool files

**MCP layer:**
- `server/src/mcp/client.js` — stdio transport via @modelcontextprotocol/sdk
- `server/src/mcp/loader.js` — reads .orbit-mcp.json with walk-up search + ~/.orbit/mcp.json global fallback
- `server/src/mcp/wrapper.js` — JSON Schema to Zod conversion, name normalization, schema hints
- Tool names: `mcp__{serverName}__{toolName}` pattern
- MCP tools injected into central registry at startup, available in all modes

**Database:**
- PostgreSQL via Neon serverless
- Prisma ORM
- Schema: User, Session, Account, Conversation, Message, AgentTask, DeviceCode

**Auth:**
- Better Auth with GitHub OAuth
- Device code flow
- Server only needed for initial login — token stored locally after that

**AI layer:**
- Multiple providers via provider abstraction
- Vercel AI SDK v5 (ai@5.x) with @ai-sdk/google@2.x
- `gemini-provider.js` uses `result.fullStream` for v5 — chunk field is `chunk.text` NOT `chunk.textDelta`
- Provider factory at `server/src/cli/ai/provider-factory.js`

---

## Environment Variables (both root .env and server/.env)
```
PORT=3005
DATABASE_URL=neon_postgresql_connection_string
BETTER_AUTH_SECRET=supersecretkey
BETTER_AUTH_URL=http://localhost:3005
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_key
ORBITAL_MODEL=gemini-2.5-flash
ORBITAL_MODEL_PROVIDER=gemini
ANTHROPIC_API_KEY=your_anthropic_key
OPENAI_API_KEY=your_openai_key
TAVILY_API_KEY=your_tavily_key
PINCHTAB_URL=http://localhost:9867
PINCHTAB_TOKEN=your_pinchtab_bearer_token
```

---

## How To Run Locally
```
cd server && npm install && cd ..
npm install -g .
orbit wakeup
```
Server only needed for initial OAuth login:
```
cd server && npm run dev
```
If global install fails with EEXIST:
```
del "%AppData%\npm\orbit.cmd"
del "%AppData%\npm\orbit.ps1"
del "%AppData%\npm\orbit"
npm install -g .
```

---

## File Structure (Key Files)
```
server/src/
  cli/
    main.js                        — entry point, banner, Commander setup, env loading
    contextReader.js               — project stack detection
    agent/
      terminal-reason.js           — typed exit states enum
      circuit-breaker.js           — retry constants and backoff
      context-compressor.js        — sliding window summarization
      orphan-guard.js              — fills unmatched tool_use blocks
    ai/
      provider-interface.js        — validateProvider contract
      provider-factory.js          — getProvider(), getActiveProviderInfo(), sendMessageWithFallback()
      google-service.js            — re-export shim only
      providers/
        gemini-provider.js         — GeminiProvider, uses fullStream, chunk.text
        claude-provider.js         — ClaudeProvider
        openai-provider.js         — OpenAIProvider
    chat/
      chat-with-ai.js              — chat mode (Concept A TUI)
      chat-with-ai-tool.js         — tool calling mode (Concept C TUI)
      chat-with-ai-iterative.js    — agentic mode orchestrator (Concept B TUI)
      chat-with-ai-agent.js        — one-shot agent helper
    commands/
      ai/wakeUp.js                 — main menu, model selection, mode routing, MCP loading
      auth/login.js                — GitHub OAuth
      history/history.js           — conversation history with mode badges
  mcp/
    client.js                      — StdioClientTransport, stderr suppressed via pipe
    loader.js                      — walk-up .orbit-mcp.json search + ~/.orbit/mcp.json
    wrapper.js                     — jsonSchemaToZod, normalizeToolName, buildSchemaHint
  tools/
    registry.js                    — central tool registry
    index.js                       — imports all tool files
    directory.js                   — resolveWithContext fix applied
    filesystem.js                  — resolveWithContext fix applied
    web.js                         — web_search, fetch_url
    browser.js                     — 5 PinchTab browser tools
    package-manager.js             — run_python, run_cargo, run_go, run_ruby
    git.js, shell.js, dependencies.js
  config/
    agent.config.js                — ORBITAL_SYSTEM_PROMPT (restructured, 10 sections)
    tool.config.js                 — getEnabledTools(), injectMcpTools(), refreshAvailableTools()
    google.config.js               — Gemini config, loads own .env independently
```

---

## What Is Working
- orbit wakeup launches globally from any directory
- GitHub OAuth authentication
- Four mode menu: Chat, Tool Calling, Agentic Mode, History
- Model selection menu at startup — Gemini 2.5 Flash, Claude Sonnet 3.5, GPT-4o
- Automatic fallback to Gemini if selected provider fails or API key missing
- Conversation history — list, resume, delete with mode badges
- Iterative agent reasoning loop: goal → plan → act → observe → reflect → repeat
- Project context reader — detects Node.js, Python, Rust, Go, Ruby stacks
- Output directory control
- 32 built-in tools across 7 files
- 50 MCP tools across 4 servers (filesystem 14, memory 9, sequential-thinking 1, github 26)
- MCP config: project-level .orbit-mcp.json (walk-up search) + global ~/.orbit/mcp.json
- MCP server stderr suppressed — clean startup output
- Agent loop hardening: circuit breakers, context compression, orphan guard, typed terminal exits
- Vercel AI SDK v5 compatibility — uses result.fullStream, chunk.text
- Redesigned TUI across all 4 modes — unified hex color system, status bars, role labels
- Tool path resolution fix — file tools resolve relative to outputDirectory not process.cwd()
- Restructured ORBITAL_SYSTEM_PROMPT — 10 named sections, MCP field names, large codebase strategy

---

## Critical Known Patterns

**Tool execute functions must use args object pattern:**
```js
execute: async (args, context) => {
  const query = args?.query;
  const base = context?.outputDirectory || process.cwd();
```

**gemini-provider.js uses fullStream for v5 with chunk.text:**
```js
for await (const chunk of result.fullStream) {
  if (chunk.type === 'text-delta') {
    fullResponse += chunk.text;  // NOT chunk.textDelta
    if (onChunk) onChunk(chunk.text);
  }
}
```

**Provider is instantiated lazily inside functions:**
```js
async function getAIResponse() {
  const aiService = getProvider(); // inside function, not module level
```

**aiService in chat-with-ai-iterative.js must NOT be commented out:**
```js
const aiService = getProvider(); // MUST be uncommented
const chatService = new ChatService();
```

**google.config.js loads its own .env independently** (needed because it runs before main.js dotenv):
```js
// Uses multi-path candidate resolution relative to __dirname
// Paths: ../../../.env, ../../.env, ../.env, process.cwd()/.env
```

**resolveWithContext in filesystem.js and directory.js:**
```js
function resolveWithContext(filePath, context) {
  const base = context?.outputDirectory || process.cwd();
  return path.isAbsolute(filePath) ? filePath : resolvePath(base, filePath);
}
```

**MCP tool names follow pattern:**
```
mcp__{serverName}__{toolName}  (max 64 chars, invalid chars → underscores)
```

**MCP memory tool exact field names (model hallucinates these):**
```js
// create_entities: entities array, each object needs:
// "name" (string), "entityType" (string), "observations" (array of strings)
// NEVER "type" — always "entityType"
```

**sendMessageWithFallback handles provider errors and auto-falls back to Gemini.**

---

## Current Bugs / Known Issues
- Gemini free tier rate limits (5 req/min) — use paid key or switch to Claude/GPT-4o
- MCP memory field names — Gemini occasionally uses "type" instead of "entityType" despite system prompt guidance
- Puppeteer MCP incompatible — times out, removed from config
- One dotenv verbose line on startup — source unidentified

---

## Active MCP Config (~/\.orbit/mcp.json)
```json
{
  "servers": [
    { "name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    { "name": "memory", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },
    { "name": "sequential-thinking", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
    { "name": "github", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "token" } }
  ]
}
```

---

## ORBITAL_SYSTEM_PROMPT Structure (10 sections)
Located in `server/src/config/agent.config.js`:
1. Identity
2. System
3. Doing Tasks
4. Executing Actions With Care (reversibility guidance)
5. Using Your Tools (built-in hierarchy + MCP field names with examples)
6. Output Efficiency
7. Output Quality
8. Context Integration
9. Large Codebase Strategy (memory-first, selective reading)
10. Termination and Communication

---

## Development Rules
- Always use GPT-5.x-Codex in GitHub Copilot agent
- Add this line at top of every agent prompt: "You are an expert Node.js developer. Follow every instruction exactly as written. Do not skip any requirement. Implement all changes completely — no stubs, no placeholders. Your output will be reviewed by Claude for correctness."
- After every merged session run: `cd server && npm install && cd .. && npm install -g .`
- If global install fails with EEXIST, delete the three stuck files manually then reinstall
- Never batch merge untested sessions — merge one, test, then next
- The CLI entry point is `server/src/cli/main.js`
- Tools live in `server/src/tools/`
- Both root `.env` AND `server/.env` need credentials

---

## Planned Next Work (Priority Order)

1. **Token management** — Tool result truncation before API calls, per-session budget, step result compression in iterative agent, token usage in status bar.
2. **Test suite** — vitest, unit tests for tools, MCP modules, integration tests for agent loop.
3. **RAG / vector memory** — pgvector on Neon for semantic codebase search.
4. **Production hardening** — env validation on startup, structured logging, public release.

---

## Browser Automation Setup (Optional)
PinchTab required for browser tools:
```
npm install -g pinchtab
pinchtab          # select Guard DOWN, then Start server
pinchtab config token   # copy token to .env as PINCHTAB_TOKEN
```
Keep PinchTab running in a separate terminal when using browser tools.
```


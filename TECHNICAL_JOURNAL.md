# Technical Journal — Orbital CLI

> A development journal for contributors and developers. Documents architecture decisions, session history, problems encountered, and the road ahead.

---

## Project Vision

Orbital CLI is trying to become a fully autonomous terminal-resident developer agent. Not a code generator, not a chatbot with a command-line wrapper — an agent that can receive a high-level goal, reason about the steps required to achieve it, execute those steps using real developer tools, observe the results, and decide what to do next without further human input.

The philosophy is the goal → plan → act → observe → reflect → repeat loop. A simple code generator takes your prompt and produces output in one shot. There is no planning, no correction, no awareness of what already exists in your project. When the first output is wrong or incomplete, you are back to editing manually.

Orbital breaks that pattern. It reads your project first. It plans before it acts. After each action it reflects on whether the goal was advanced. It runs the loop again if it was not. The agent is not finished when it produces output — it is finished when the goal is met.

The long-term vision is a CLI developer agent that can spin up new projects, extend existing codebases, run tests, fix failing builds, and manage dependencies — all from a single terminal session, with the same level of reliability you would expect from a skilled human developer.

---

## Architecture Overview

Orbital is a client-server application. The client is a thin CLI layer. The server is where all intelligence, storage, and orchestration live. This split is a deliberate design decision explained in the Design Decisions section.

### CLI Layer

**Location:** `server/src/cli/`

The CLI is built with Node.js using three libraries:

- **Commander.js** — Registers the top-level `orbit` command and all subcommands (`wakeup`, `login`, `logout`, `whoami`, `history`). Handles argument and flag parsing (e.g., `--iterative`).
- **Clack** — Provides the interactive UI: spinning prompts, select menus, text inputs, confirmation dialogs. Chosen for its modern async API and clean visual output compared to older Inquirer.js.
- **Chalk** — Terminal colour and formatting for output text.

The main entry point is `server/src/cli/main.js`. It registers all Commander commands and delegates each to the appropriate handler in `server/src/cli/commands/`.

### Backend Layer

**Location:** `server/src/`

The backend is an Express.js HTTP server. Its primary responsibilities are:

- **Authentication** — Exposes Better Auth endpoints under `/api/auth`.
- **Conversation management** — REST endpoints for creating, listing, retrieving, and deleting conversations and messages.
- **AI orchestration** — Receives messages from the CLI, injects system prompts and project context, calls the AI model, handles tool call loops, and streams responses back.
- **Tool execution** — When the model requests a tool call, the orchestrator looks up the tool in the registry, executes it with the provided arguments and context, and returns the result to the model.

The orchestrator logic lives in `server/src/service/` and `server/src/lib/`.

### Database Layer

**Location:** `server/prisma/`

Storage uses PostgreSQL accessed through Prisma ORM. For development and hosted deployments, Neon provides a serverless PostgreSQL database that requires no local installation.

Prisma handles schema definition in `server/prisma/schema.prisma`, type-safe client generation via `prisma generate`, and schema push via `prisma db push`.

### Auth Layer

**Location:** `server/src/lib/`

Authentication is handled by Better Auth with the GitHub OAuth provider. The flow uses a device code pattern — the CLI requests a device code from the server, opens the browser to the GitHub authorization URL, and polls until the user completes login. The session is stored server-side and the CLI receives a token for subsequent requests.

### AI Layer

**Location:** `server/src/cli/ai/` and `server/src/config/agent.config.js`

The AI layer uses a provider abstraction supporting Gemini (via Vercel AI SDK), Claude (via Anthropic SDK), and OpenAI (via OpenAI SDK). All providers implement the same validated interface defined in `provider-interface.js`. The factory in `provider-factory.js` reads `ORBITAL_MODEL_PROVIDER` from the environment at call time and returns the appropriate provider instance with automatic fallback to Gemini if the selected provider is unavailable.

Model calls are structured as follows:

1. The system prompt is loaded from `server/src/config/agent.config.js`.
2. Project context from the context reader is appended.
3. Conversation history is assembled from database records.
4. The token manager trims the payload to fit the active model's context window.
5. The model call is made via the active provider instance.
6. If the model response contains a tool call, the orchestrator executes the tool and returns the result for the next iteration.

### Tool Layer

**Location:** `server/src/tools/`

Tools are implemented using a registry pattern. Each tool file registers one or more tools by calling `registerTool(name, definition)` from `server/src/tools/registry.js`. The registry stores tools in an in-memory Map.

At startup, `server/src/tools/index.js` imports all tool files, which triggers registration as a side effect. The orchestrator then calls `getToolSchemas(context)` to retrieve all registered tools formatted for the active provider's SDK.

The 32 built-in tools are spread across 8 files: `filesystem.js`, `shell.js`, `git.js`, `dependencies.js`, `package-manager.js`, `directory.js`, `web.js`, and `browser.js`.

### Token Management Layer

**Location:** `server/src/cli/ai/token-manager.js`

The token manager sits between message assembly and every API dispatch. It estimates token counts using UTF-8 byte counting (accurate across ASCII, CJK, and emoji), resolves the active model's context window and output buffer from a config map, and trims the payload in a fixed priority order: RAG chunks first, oversized tool results second, middle message history third. The protected recent tail (last 6 messages) is only shrunk if the tail alone exceeds the budget. Orphaned tool call/result pairs are cleaned up in a final pass so the payload is always API-valid. The system is provider-agnostic — swapping models changes the budget ceiling, not the logic.

---

## Database Schema

Every model is defined in `server/prisma/schema.prisma`.

### User

Stores authenticated users created via GitHub OAuth.

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | Primary key |
| `name` | String | Display name from GitHub |
| `email` | String (unique) | Email from GitHub |
| `emailVerified` | Boolean | Default false |
| `image` | String? | Avatar URL |
| `createdAt` | DateTime | Auto-set on create |
| `updatedAt` | DateTime | Auto-updated |

Relations: has many `Session`, `Account`, `Conversation`.

### Session

Active authentication sessions managed by Better Auth.

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key |
| `expiresAt` | DateTime | Session expiry |
| `token` | String (unique) | Session token |
| `userId` | String | Foreign key → User |

### Account

OAuth provider account links. One user can have multiple provider accounts.

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key |
| `accountId` | String | Provider's user ID |
| `providerId` | String | e.g. "github" |
| `userId` | String | Foreign key → User |
| `accessToken` | String? | OAuth access token |
| `refreshToken` | String? | OAuth refresh token |

### Conversation

A single chat or agentic session. Groups messages together.

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | Primary key |
| `userId` | String | Foreign key → User |
| `title` | String? | Optional display title |
| `mode` | String | "chat", "tool", or "agent" |
| `createdAt` | DateTime | Auto-set |
| `updatedAt` | DateTime | Auto-updated |

Relations: has many `Message`, `AgentTask`.

### Message

A single message within a conversation.

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | Primary key |
| `conversationId` | String | Foreign key → Conversation |
| `role` | String | "user", "assistant", "system", "tool" |
| `content` | String | JSON string for complex content |
| `createdAt` | DateTime | Auto-set |

### AgentTask

Stores the state of an agentic loop run.

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | Primary key |
| `conversationId` | String | Foreign key → Conversation |
| `goal` | String | The user's stated goal |
| `plan` | Json | Array of planned steps |
| `currentStep` | Int | Which step is executing |
| `stepResults` | Json | Array of step output objects |
| `status` | String | "planning", "running", "complete", "failed" |
| `finalOutput` | String? | Summary of completed work |
| `createdAt` | DateTime | Auto-set |
| `updatedAt` | DateTime | Auto-updated |

### DeviceCode

Stores temporary device codes used in the CLI OAuth login flow.

| Field | Type | Notes |
|---|---|---|
| `id` | String | Primary key |
| `deviceCode` | String | The device code sent to the CLI |
| `userCode` | String | The short code shown to the user |
| `userId` | String? | Set after the user authorizes |
| `expiresAt` | DateTime | When the code expires |
| `status` | String | "pending", "authorized", "expired" |
| `lastPolledAt` | DateTime? | Last time CLI polled |
| `pollingInterval` | Int? | Recommended polling interval in seconds |

---

## Development Sessions Log

---

### 0.1 — Conversation History Retrieval

**What was built:** The ability to list, view, and resume past conversations from inside the CLI.

**Approach:** Added two GET endpoints — one to list all conversations for the authenticated user, one to retrieve the full message history of a specific conversation. On the CLI side, added a `history` command and a `View history` option in the main menu. Used Clack's `select` component to display the list and let the user choose a session to resume. When a session is resumed, the message history is injected into the AI context so the model has full recall.

**Problems:** Conversation history was being stored in the database but there was no way to retrieve it into the CLI. The CLI had no history command and no menu option.

**Resolution:** Implemented the GET endpoints and CLI UI from scratch.

---

### 0.2 — Iterative Agent Reasoning Loop

**What was built:** A multi-step agentic loop that plans before acting and reflects after each step.

**Approach:** Implemented the goal → plan → act → observe → reflect → repeat loop in the orchestrator. The loop has a hard limit of 10 steps to prevent runaway execution. Added the `--iterative` flag to `orbit wakeup` to invoke this mode. Loop state (current step, results so far) is held in memory during execution.

**Problems:** Single-shot generation has no planning or self-correction. If the first output is wrong, there is no mechanism to detect that and try again. Long goals produce incomplete results.

**Resolution:** The iterative loop breaks the goal into a plan at the start, executes one step at a time, feeds each step's result back to the model, and decides whether to continue or conclude.

---

### 0.3 — Project Context Reader

**What was built:** A context reader that scans the user's project before the agent acts.

**Approach:** Before starting an agentic or chat session, Orbital traverses the project directory (up to a configurable depth), reads `package.json` to detect the framework and dependencies, and assembles a structured context summary. This summary is injected into the system prompt so the model understands what already exists before generating anything.

**Problems:** Without project context, the agent acted blind. It would generate code that conflicted with existing implementations, use the wrong package names, or recreate things that already existed.

**Resolution:** The context reader at `server/src/cli/contextReader.js` handles filesystem traversal, package.json parsing, and framework detection. The output is appended to the system prompt at the start of each agentic session.

---

### 0.4 — Agent System Prompt Overhaul

**What was built:** A completely rewritten system prompt for the agent, exported from a dedicated config file.

**Approach:** The original system prompt was a generic instruction. It was replaced with `ORBITAL_SYSTEM_PROMPT` in `server/src/config/agent.config.js`. The new prompt gives the agent a clear professional identity, reasoning directives, tool usage directives, output quality directives, and context integration directives. The system prompt is applied via `AIService.sendMessage({ system })` and `AIService.generateStructured()` across all modes.

**Problems:** The basic generation prompt produced inconsistent, low-quality output. The model had no instructions for how to behave as an agent versus a chat assistant.

**Resolution:** Full system prompt rewrite applied consistently across chat mode, tool calling mode, and agentic mode.

---

### 0.5 — Global CLI Installation and Output Directory Control

**What was built:** The ability to install `orbit` globally and control where generated files are written.

**Approach:** Added a `bin` field to the root `package.json` pointing to `server/src/cli/main.js`. This allows `npm install -g .` to register the `orbit` binary system-wide. To solve the output directory problem, the CLI captures `process.cwd()` at invocation time before any directory changes. In agentic mode, the user is prompted to specify an output directory. The input is resolved to an absolute path using `path.resolve()`. All file operations use this resolved path.

**Problems:** Before this, the CLI only worked when run from the source directory. Generated files landed wherever the Node process happened to be running — often inside the Orbital source folder.

**Resolution:** `bin` registration for global install. `process.cwd()` capture at startup. User-facing output directory prompt with `path.resolve()` for absolute path safety.

---

### 0.6 — Project Documentation

**What was built:** `README.md`, `.env.example`, `CHANGELOG.md`.

**Approach:** Created a beginner-friendly README covering what Orbital is, all prerequisites, step-by-step installation, environment variable reference, usage guide, troubleshooting, and contributing guide. Created `.env.example` with every required variable and plain-English comments.

---

### 0.7 — Prisma 6 Compatibility Fix

**What was built:** A fix for Prisma schema validation errors that broke migrations on Prisma 6.

**Approach:** Prisma 6 requires an explicit `url = env("DATABASE_URL")` field in the datasource block. An earlier change had commented this line out. Restored the `url` field to `schema.prisma`. Simplified `prisma.config.ts` to remove the programmatic URL override. Fixed dotenv load order so `DATABASE_URL` is in the environment before Prisma initializes.

**Problems:** `npx prisma db push` and `npx prisma generate` were failing with `P1012: error in data model: Argument "url" is missing in data source block "db"`.

**Resolution:** `url = env("DATABASE_URL")` restored to the datasource block.

---

### 0.8 — CLI Command Registration Fixes

**What was built:** Fixes for the `orbit history` command and history menu option.

**Approach:** Commander.js subcommand registration had an issue where `orbit history` threw "too many arguments" because the command was not correctly defined as a subcommand. Fixed the Commander.js registration. Added the history option to the main Clack menu.

**Problems:** Running `orbit history` produced an error. The main menu had no history option.

**Resolution:** Corrected Commander.js subcommand definition. Added `View history` to the main menu select options.

---

### 0.9 — Dotenv Absolute Path Fix and Task State Memory

**What was built:** A reliable dotenv loading mechanism and the `AgentTask` Prisma model.

**Approach:** The original dotenv load called `dotenv.config()` without a path argument, which defaults to `process.cwd() + '/.env'`. When the CLI is invoked from a different directory, `process.cwd()` is the user's project folder, not the Orbital source folder. Fixed by using `import.meta.url` to derive the absolute path to `.env` at the Orbital source location regardless of invocation directory.

The `AgentTask` model was added to the Prisma schema to support task state persistence — storing the goal, plan, current step, step results, and status so that an interrupted agentic session can be resumed.

**Problems:** `injecting env (0)` on every invocation from outside the source directory. No database model for storing agentic task state.

**Resolution:** Absolute path derivation via `import.meta.url`. `AgentTask` model added to schema and migrated.

---

### 0.10 — Tool Registry and Core Developer Tools

**What was built:** The tool registry pattern and 21 developer tools.

**Approach:** Previously, tools were hardcoded in the orchestrator. Implemented a registry pattern: `registerTool(name, definition)` stores tools in an in-memory Map. `getToolSchemas(context)` returns all tools formatted for the Vercel AI SDK. Tool files self-register at import time. `server/src/tools/index.js` imports all tool files once at startup.

Implemented 21 tools across 5 files: `filesystem.js`, `shell.js`, `git.js`, `dependencies.js`, and `directory.js`.

**Problems:** Hardcoded tool list made the tool layer fragile and hard to extend. Every new tool required orchestrator changes.

**Resolution:** Registry pattern with clean import-time registration. Zero orchestrator changes needed to add a new tool.

---

### 0.11 — Tool Invocation Fix

**What was built:** The tool use loop in the orchestrator.

**Approach:** Tools were registered correctly but the model was not calling them — or when it did, results were returning `undefined`. Implemented the tool use loop: after each model call, check whether the response contains a tool call. If it does, execute the tool via the registry, collect the result, and pass it back to the model as a tool result message. Continue until the model returns a text response with no pending tool calls.

**Problems:** The model would request a tool call but the orchestrator was not handling the response type. Tool results were never sent back, so the model could not complete its reasoning.

**Resolution:** Tool call detection in the orchestrator response handler. Execution via registry. Result returned to model in the next message.

---

### 0.12 — Windows Path Spaces Fix

**What was built:** A fix for file and shell operations failing when paths contain spaces.

**Approach:** Paths like `C:\Users\name\Stock analysis` broke `child_process.exec` because the space was interpreted as an argument separator. Fixed by adding a `resolvePath` utility using `path.resolve()` to normalize all paths before use. For shell execution, the working directory is passed as a separate `cwd` option to `child_process` rather than being concatenated into the command string.

**Problems:** Any agentic session targeting a directory with spaces in the path would fail immediately.

**Resolution:** `path.resolve()` everywhere. `cwd` as a separate option, never string-concatenated into shell commands.

---

### 0.13 — Conversation Deletion and CLI Output Cleanup

**What was built:** Conversation deletion from the history UI and suppression of verbose startup output.

**Approach:** Added a `DELETE /conversations/:id` endpoint with Prisma cascade deletion. Added a delete option in the history menu after selecting a conversation with confirmation before deletion. Set `quiet: true` on the dotenv config call to suppress its output. Removed development debug `console.log` statements.

**Problems:** No way to delete conversations. Startup output was cluttered with dotenv messages and development debug logs.

**Resolution:** DELETE endpoint with cascade. Clack confirmation UI for deletion. `quiet: true` on dotenv.

---

### 0.14 — Navigation and UX Fixes

**What was built:** Persistent main menu loop, back navigation in every submenu, and fixed arrow key selection.

**Approach:** The main menu was implemented as a recursive function call. Replaced recursion with a `while` loop. Back navigation was added to every submenu. Arrow key navigation in the history select menu was fixed by using the unique conversation `id` as the value and the title as the label, since duplicate titles caused Clack to navigate to the wrong option.

**Problems:** CLI exited after each mode. No back button. History navigation broke with duplicate titles.

**Resolution:** `while` loop for persistent menu. Back options in every submenu. Unique conversation IDs as select values.

---

### 0.15 — Tool Execution Registry Fix

**What was built:** A registry-backed tool configuration that exposes all 21 tools in Tool Calling mode.

**Approach:** Rewrote `server/src/config/tool.config.js` to source `availableTools` from `getAllTools()` and to call `getToolSchemas(context)` inside `getEnabledTools()`. Updated `server/src/cli/chat/chat-with-ai-tool.js` to pass `{ outputDirectory: process.cwd() }` into `getEnabledTools`.

**Problems:** `tool.config.js` was disconnected from the tool registry and only knew about three Google-native tools, which disabled most tool calls.

**Resolution:** Tool Calling mode now exposes and executes all 21 registered tools correctly.

---

### 0.16 — Web Search Integration

**What was built:** Two new web tools (`web_search`, `fetch_url`). Tool count increased from 21 to 23.

**Approach:** Created `server/src/tools/web.js` and registered both tools. Updated `server/src/tools/index.js` to import `web.js`. Added `@tavily/core` to `server/package.json`.

`web_search` uses `@tavily/core` to query the Tavily search API and returns result titles, URLs, and content snippets with a maximum of 10 results.

`fetch_url` uses native `fetch`, strips HTML tags, returns plain text, applies a 10-second timeout, and defaults to a maximum of 3000 characters.

**Problems:** The agent lacked native web retrieval capability for current information and page content extraction.

**Resolution:** Web search and URL fetching are now first-class registered tools available to the agent.

---

### 0.17 — Multi-Language Runtime Support

**What was built:** Four new language runtime tools. Tool count increased from 23 to 27.

**Approach:** Added `run_python`, `run_cargo`, `run_go`, and `run_ruby` to `server/src/tools/package-manager.js`. Extended the context reader to detect Python, Rust, Go, and Ruby projects from common project files.

Detection sources: Python (`requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile`, `poetry.lock`), Rust (`Cargo.toml`), Go (`go.mod`), Ruby (`Gemfile`).

**Problems:** npm-only execution paths limited agent workflows in non-Node repositories.

**Resolution:** Orbit now supports multi-language execution workflows with language-aware tool selection.

---

### 0.18 — Browser Automation Integration

**What was built:** Five new browser automation tools. Tool count increased from 27 to 32.

**Approach:** Integrated PinchTab as a Chrome automation backend over HTTP and added `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`, and `browser_extract_text` to `server/src/tools/browser.js`. Added environment variable support for `PINCHTAB_URL` and `PINCHTAB_TOKEN`.

**Problems:** `fetch_url` could not handle JavaScript-rendered or interactive browser workflows.

**Resolution:** Orbit now supports token-efficient browser automation for dynamic pages through PinchTab.

**Bug fixes applied during 0.17 and 0.18:**

1. Vercel AI SDK v5 compatibility in `gemini-provider.js` — migrated from the v4-style `result.textStream + result.steps` pattern to `result.fullStream`. Chunk handling now covers `text-delta`, `tool-call`, `tool-result`, and `step-finish`. Fixed tool results becoming `undefined` after execution.

2. Zod v4 args destructuring fix across `web.js`, `browser.js`, and `package-manager.js` — replaced `execute({ ... })` parameter destructuring with `execute(args)` plus field extraction inside the function body. This avoids dropped fields under Zod v4 combined with AI SDK v5 schema parsing behavior.

3. Tool call and result rendering fix in `chat-with-ai-tool.js` — updated tool call rendering from `tc.args` to `tc.input ?? tc.args`. Updated tool result rendering from `tr.result` to `tr.output ?? tr.result ?? tr`. Added spinner stop handling when no text chunks arrive after a tool call.

---

### 0.19 — Agent Loop Hardening

**What was built:** A hardened agent loop with typed exit reasons, bounded retries, context compression, and orphaned tool result handling.

**Approach:** Added new modules under `server/src/cli/agent/`:

- `terminal-reason.js` — typed exit state enum
- `circuit-breaker.js` — retry constants and exponential backoff
- `context-compressor.js` — sliding window summarization (triggers at 20 messages, preserves last 6, summarizes older messages into a single assistant message)
- `orphan-guard.js` — fills unmatched tool_use blocks to prevent API validation errors

All four modules were integrated into `server/src/cli/chat/chat-with-ai-iterative.js`.

**Problems:** The agent loop could run unbounded, grow context indefinitely, and crash on orphaned tool executions.

**Resolution:** The loop now exits cleanly with typed terminal reasons, respects circuit breaker limits, compresses long histories, and repairs missing tool results.

---

### 0.20 — Provider Abstraction Layer

**What was built:** A provider abstraction layer with a validated interface and a factory entry point.

**Approach:** Added `server/src/cli/ai/provider-interface.js` to define the provider contract (`sendMessage`, `getMessage`, `generateStructured`, `isAvailable`, `getProviderName`). Moved Gemini logic into `server/src/cli/ai/providers/gemini-provider.js`. Added `server/src/cli/ai/provider-factory.js` for provider lookup, registration, fallback logic, and active provider state tracking. Converted `server/src/cli/ai/google-service.js` into a backwards-compatible re-export shim.

**Problems:** Model access was hard-wired to Gemini, making additional providers difficult to integrate without orchestrator changes.

**Resolution:** All model access now flows through a single validated provider interface and factory.

---

### 0.21 — Multi-Model Support

**What was built:** Multi-model provider support with a startup selection menu and API key availability checks.

**Approach:** Added `server/src/cli/ai/providers/claude-provider.js` and `server/src/cli/ai/providers/openai-provider.js`. Registered all providers in `provider-factory.js` with display info and availability status. Updated `server/src/cli/commands/ai/wakeUp.js` to prompt for provider selection at startup, set `ORBITAL_MODEL_PROVIDER` in the environment, and fall back to Gemini when keys are missing.

`sendMessageWithFallback` in `provider-factory.js` catches quota errors, rate limit errors, and auth errors from any provider and automatically retries the same request against Gemini.

**Problems:** Users could not choose between models or see which providers were configured.

**Resolution:** Gemini, Claude Sonnet, and GPT-4o are selectable at startup with safe fallback behavior.

---

### 0.22 — Terminal UI Redesign

**What was built:** A complete redesign of all four mode displays and the main menu using a unified chalk-based design language.

**Approach:** Applied a unified hex color system across all files: cyan (`#22d3ee`) for orbit branding, blue (`#38bdf8`) for user messages, purple (`#a78bfa`) for AI responses, green (`#4ade80`) for success, yellow (`#facc15`) for warnings and thinking state, red (`#f87171`) for errors, gray (`#6b7280`) for secondary text.

Files modified: `chat-with-ai.js`, `chat-with-ai-tool.js`, `chat-with-ai-agent.js`, `chat-with-ai-iterative.js`, `wakeUp.js`, and `history.js`.

The iterative agent received block character progress bars (`█░`), phase labels (`planning` / `acting` / `reflecting`), reflection decision display, and a token stats line.

**Why chalk over Ink:** Ink was attempted across three separate sub-sessions. JSX transpilation via esbuild broke Prisma's native binary resolution because the bundled dist file resolved paths from AppData/npm rather than the project directory. tsx as a loader could not be found from the global install context. Chalk renders natively in Node.js ESM with no build step, no path resolution issues, and no bundling required.

**Problems:** Ink JSX files require either a build step or a loader. Both approaches broke the global install path resolution.

**Resolution:** Full chalk-based redesign with no build step. Works in any terminal on Windows, Mac, and Linux.

---

### 0.23 — MCP Implementation

**What was built:** Full Model Context Protocol support. Orbit can now connect to any MCP-compatible tool server and use its tools alongside the 32 built-in tools.

**Approach:** Three new files in `server/src/mcp/`:

- `client.js` — Connects to a single MCP server via stdio transport using `@modelcontextprotocol/sdk`. Calls `tools/list` to discover available tools. Wraps `callTool` responses into plain strings. Suppresses server stderr via pipe and discard.
- `loader.js` — Reads `.orbit-mcp.json` with walk-up directory search (mirrors git's `.gitignore` discovery, max 10 levels). Falls back to `~/.orbit/mcp.json` for global tools.
- `wrapper.js` — Converts MCP JSON Schema tool definitions to Zod schemas via recursive `jsonSchemaToZod`. Normalizes tool names to `mcp__{serverName}__{toolName}` pattern (max 64 chars). Appends schema hints to tool descriptions so the model knows exact field names.

Integration point: `wakeUp.js` calls `loadMcpTools(invocationDir)` at startup, then `injectMcpTools()` and `refreshAvailableTools()` to make MCP tools available in all modes.

MCP servers integrated and tested:

| Server | Tools | Purpose |
|--------|-------|---------|
| `@modelcontextprotocol/server-filesystem` | 14 | File operations via MCP protocol |
| `@modelcontextprotocol/server-memory` | 9 | Persistent cross-session knowledge graph |
| `@modelcontextprotocol/server-sequential-thinking` | 1 | Structured multi-step reasoning scratchpad |
| `@modelcontextprotocol/server-github` | 26 | Repository, issues, PRs, code search |

**Problems encountered:**

1. JSON Schema to Zod conversion — MCP tools use nested object arrays (entities array containing objects with `name`/`entityType`/`observations`). Fixed with recursive `jsonSchemaPropertyToZod` that handles arrays of objects.
2. Model field name hallucination — Gemini used `"type"` instead of `"entityType"` despite the schema. Fixed by appending explicit field name examples to tool descriptions and adding MCP tool instructions to `ORBITAL_SYSTEM_PROMPT`.
3. `@modelcontextprotocol/server-postgres` deprecated — removed from config.
4. `@modelcontextprotocol/server-puppeteer` times out on connection — removed in favor of existing PinchTab tools.
5. MCP server stderr noise — server startup messages printed to terminal interleaved with Orbit's own status output. Fixed by adding `stderr: 'pipe'` to `StdioClientTransport` and discarding all stderr data.

**Resolution:** 50 MCP tools available alongside 32 built-in tools. Total 82 tools accessible in all modes.

---

### 0.24 — System Prompt Rewrite and Tool Path Resolution Fix

**What was built:** A complete rewrite of `ORBITAL_SYSTEM_PROMPT` based on analysis of production agent system prompt architecture. Fixed a critical path resolution bug in all file and directory tools.

**System prompt restructure — 10 named sections:**

1. `# Identity` — Agent name, role, environment, primary function
2. `# System` — How output reaches the user, tool result handling
3. `# Doing Tasks` — Planning before acting, step-by-step execution, failure recovery, verification before claiming completion
4. `# Executing Actions With Care` — Reversibility guidance. Explicit list of free actions vs actions requiring confirmation (delete, force push, drop database, send messages to external services)
5. `# Using Your Tools` — Built-in tool preference hierarchy, MCP tool field names with exact JSON examples, parallel tool call instruction
6. `# Output Efficiency` — Concise output, no narration, no step-by-step commentary
7. `# Output Quality` — Production-ready code, no placeholders, security awareness
8. `# Context Integration` — Use detected stack, verify dependencies before importing
9. `# Large Codebase Strategy` — Check memory first, use directory_tree before reading files, store findings in memory progressively
10. `# Termination and Communication` — Final summary format, never silently fail, verify before reporting completion

**Tool path resolution fix:** Built-in file and directory tools resolved all paths using `process.cwd()` as base. When the iterative agent operated on a project in a different directory (the output directory the user specifies), all file reads returned empty results or file not found errors.

Root cause: `resolvePath(file_path)` in `filesystem.js` called `path.resolve(file_path)` with only one argument, making `file_path` itself the base, resolving relative to `process.cwd()` not the output directory.

Fix: Added `resolveWithContext(filePath, context)` helper to both `filesystem.js` and `directory.js`. If `filePath` is absolute, use it directly. If relative, resolve against `context.outputDirectory`. Fallback to `process.cwd()`.

**Resolution:** Agent can now correctly read, write, and search files in any project directory regardless of where `orbit wakeup` was launched from.

---

### 0.25 — MCP Startup Noise Suppression

**What was built:** Suppression of MCP server process stdout/stderr from appearing in the terminal during startup.

**Problem:** MCP servers print their own startup messages to stderr when launched. These messages appeared interleaved with Orbit's own MCP status lines.

**Fix:** Added `stderr: 'pipe'` to the `StdioClientTransport` configuration in `server/src/mcp/client.js`. Added an empty data handler on `transport.stderr` to consume and discard all server stderr output.

**Result:** Clean startup output showing only Orbit's own status lines.

---

### 0.26 — Token Management System

**What was built:** A provider-agnostic token management system that gates every API dispatch to fit the active model's context window.

**Approach:** Created `server/src/cli/ai/token-manager.js` with the following design:

- `MODEL_CONFIGS` map — context window and output buffer per model. Supports Gemini 2.5 Flash (1M), Claude Sonnet 4.6 (200K), GPT-4o (128K), and all variants via longest-prefix matching so dated model IDs like `gpt-4o-2024-08-06` resolve correctly.
- `estimateTokens(text)` — UTF-8 byte counting via `TextEncoder`, dividing bytes by 4. Accurate across ASCII, CJK, and emoji. Superior to string length division which uses UTF-16 units and undercounts CJK content.
- `estimateMessageTokens(message)` — serializes all message fields including `tool_calls` and `tool_call_id` outside the `content` field, which the previous count-only approach silently missed. This was a significant undercounting error in agentic loops where most assistant turns contain tool calls.
- `truncateToolResult(content, maxTokens)` — truncates on a UTF-8 byte boundary to avoid splitting surrogate pairs. Appends a truncation notice with original token count.
- `preparePayload(messages, systemPrompt, model, ragChunks, opts)` — the main dispatch gate. Executes in five steps: (1) RAG chunk allocation, greedy by score, capped at 20% of budget; (2) oversized tool result truncation in place, preserving message role and shape; (3) recent tail protection with budget enforcement — tail shrinks from oldest end if it alone exceeds budget; (4) budget fill with older messages newest-first; (5) orphan cleanup — drops tool results whose calls were cut, strips unanswered tool_calls from assistant messages while preserving assistant text.

Integration point in `chat-with-ai-iterative.js`: `preparePayload` is called inside the `while(true)` loop in `executeStep`, immediately before every `sendMessageWithFallback` call. The `stats` object is displayed in the terminal via `displayTokenStats` and written to `.orbit/agent.log` via `logLoop`.

`ragChunks` parameter is wired and accepts input but is fed an empty array until the RAG layer is implemented. The injection point is already present.

**Why this does not save tokens:** Terminal output (`console.log`) never enters the API payload and costs zero tokens. Verbosity reduction is purely a UX concern. Actual token reduction requires shorter system prompts, smaller tool results, or fewer history messages — all handled by this module.

**Provider-agnostic design:** When the active model changes from Gemini free to Claude Sonnet 4.6 paid, `getModelBudget` reads the config for that model and returns 191,808 (200K minus 8192 output buffer). The truncation logic is identical. Adding a new model requires one line in `MODEL_CONFIGS`.

**Files touched:** `server/src/cli/ai/token-manager.js` (created), `server/src/cli/chat/chat-with-ai-iterative.js` (integration).

---

### 0.27 — Claude Provider — Tool Execution and Structured Output

**What was built:** Full tool execution loop and `generateStructured` implementation in `ClaudeProvider`, eliminating the dependency on Gemini for planning and reflection phases.

**Background — root cause of Gemini rate limit errors while using Claude:** `ClaudeProvider.sendMessage` only listened for `text_delta` stream events. It discarded all `tool_use` content blocks, collected only the preceding text (the model's intent description before the tool call), and returned it as the step result. This caused the iterative agent to log "I'll start by checking memory..." as a complete step result with nothing actually executed. `generateStructured` threw unconditionally with a message directing callers to use GeminiProvider. `sendMessageWithFallback` caught this throw and routed all planning and reflection calls to Gemini regardless of the selected provider.

**Tool execution loop:** Rewrote `sendMessage` in `claude-provider.js` to implement a proper multi-turn tool execution loop:

1. Stream the request. Accumulate text deltas and tool_use block starts/input deltas separately.
2. After `stream.finalMessage()`, if `stop_reason` is `tool_use`, append the assistant turn as a structured content array (text block + tool_use blocks).
3. Execute each tool via `toolDef.execute(input, {})` from the tools object.
4. Append a user turn with tool_result blocks for all executed tools.
5. Loop back to step 1. Exit when `stop_reason` is `end_turn` with no tool blocks.

This matches the Anthropic API's required multi-turn tool use pattern.

**Structured output:** Implemented `generateStructured(schema, prompt, system)` in `ClaudeProvider` calling `client.messages.create` (non-streaming) with a JSON-only system instruction. Retry loop with backoff up to 3 attempts. Response text extraction filters for `type === "text"` blocks. JSON extraction uses a regex `\{[\s\S]*\}` to locate the JSON object regardless of prose Claude may prepend, stripping any markdown fences before parsing. Parsed result is validated against the Zod schema before returning.

**Proxy constraint — no assistant prefill:** The aerolink proxy rejected requests containing an assistant turn as the last message (`400 — This model does not support assistant message prefill`). The prefill approach (seeding `{` to force JSON output) was removed. The regex-based JSON extraction handles prose-prefixed responses without requiring prefill.

**Schema shape error:** Claude Sonnet 4.6 returned `steps` as an array of objects with fields like `{ step, description }` rather than an array of plain strings as the `PlanSchema` Zod definition requires. Fixed by appending an explicit shape instruction to the user message: `The "steps" field must be an array of plain strings, not objects`. Claude 3.5 and earlier follow JSON schema instructions implicitly; Claude 4.6 is more generative by default and requires explicit shape constraints in the prompt text.

**Files touched:** `server/src/cli/ai/providers/claude-provider.js`.

---

### 0.28 — Provider Factory and Lazy Instantiation Fix

**What was built:** Fixed module-level provider instantiation that caused all AI calls to use Gemini regardless of the model selected at the startup menu. Fixed `getActiveProviderInfo` to read the active model name from the environment at call time rather than from stale module-level state.

**Root cause:** `chat-with-ai-iterative.js` had a module-level declaration:

```javascript
const aiService = getProvider();
```

ESM modules evaluate when first imported. The module was imported before `wakeUp.js` ran `selectModelProvider()` and wrote `ORBITAL_MODEL_PROVIDER` to the environment. `getProvider()` read an empty or default env var and returned `GeminiProvider`. All subsequent calls to `aiService.generateStructured` and the `compressIfNeeded` call passed this stale Gemini instance, regardless of what the user selected.

Previous fix attempts that moved `getProvider()` inside `generatePlan` and `reflectOnStep` did not work because the module-level declaration was not removed simultaneously. Both the local and module-level variables coexisted, and `compressIfNeeded` still received the stale module-level instance.

**Fix:** Removed the module-level `const aiService = getProvider()` declaration entirely. Added `const aiService = getProvider()` as the first line of the `try` block inside `generatePlan` and inside `reflectOnStep`. Replaced the `compressIfNeeded` call with `compressIfNeeded(messages, getProvider())`. Removed the unused `import { AIService } from "../ai/google-service.js"` import which referenced Gemini directly.

**`getActiveProviderInfo` fix:** The function was reading `_activeName` — a module-level variable set during the last `getProvider()` call. Because the module-level call happened before the env var was written, `_activeName` was always `'Gemini 2.5 Flash'`. The header displayed in `startIterativeAgentChat` showed the wrong model name. Fixed by deriving the name live from `process.env.ORBITAL_MODEL_PROVIDER` inside `getActiveProviderInfo` rather than trusting the stale variable. Updated `getProviderInfo` to reflect the current model name (`Claude Sonnet 4.6`).

**`ACTIVE_MODEL` display fix:** `chat-with-ai-iterative.js` has a module-level constant `ACTIVE_MODEL = process.env.ORBITAL_MODEL || "gemini-2.5-flash"` used by `preparePayload` for budget sizing. Since `ORBITAL_MODEL` was not set in `.env`, this always defaulted to `"gemini-2.5-flash"` and appeared in the token stats line. Fix: add `ORBITAL_MODEL=claude-sonnet-4-6` to `.env`.

**Files touched:** `server/src/cli/chat/chat-with-ai-iterative.js`, `server/src/cli/ai/provider-factory.js`.

---

### 0.29 — Aerolink Proxy Integration and Model Updates

**What was built:** Support for third-party Anthropic API proxies via `ANTHROPIC_BASE_URL`. Updated Claude model to Sonnet 4.6.

**Approach:** The Anthropic Node SDK accepts a `baseURL` option at client construction time. Added `baseURL: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"` to the `Anthropic` client constructor in `claude-provider.js`. When `ANTHROPIC_BASE_URL` is set, all requests route through the proxy. When absent, falls back to the real Anthropic API. No other files need changes.

The aerolink proxy (`https://capi.aerolink.lat/`) provides access to the following models (confirmed via API):

| Model ID | Type |
|---|---|
| `claude-opus-4-8` | Opus |
| `claude-opus-4-7` | Opus |
| `claude-opus-4-6` | Opus |
| `claude-sonnet-4-6` | Sonnet |
| `claude-sonnet-5` | Sonnet |
| `claude-haiku-4-5-20251001` | Haiku |
| `claude-fable-5` | Fable |

Updated `claude-provider.js` model string from `claude-3-5-sonnet-20241022` (not on this proxy, caused 400 errors) to `claude-sonnet-4-6`. Updated `getProviderName` and all display references.

**GitHub MCP authentication:** The `~/.orbit/mcp.json` config had a placeholder `"GITHUB_PERSONAL_ACCESS_TOKEN": "token"`. The GitHub MCP server requires a real personal access token. Classic tokens (`ghp_` prefix) and fine-grained tokens (`github_pat_` prefix) both work. Scopes needed: `repo`, `read:org`, `read:user`. The token is separate from `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` which are for OAuth login only.

**Files touched:** `server/src/cli/ai/providers/claude-provider.js`, `.env`, `~/.orbit/mcp.json`.

---

### 0.30 — Terminal UI Verbosity Reduction

**What was built:** Reduced terminal output during iterative agent execution. Removed redundant separator lines, collapsed step headers to a single line, silenced token stats below 70% utilization, reduced reflection output to a single symbol, and removed raw JSON from tool result display.

**Changes to display functions in `chat-with-ai-iterative.js`:**

`displayStepHeader` — step description now truncated to 60 characters and displayed inline with the progress bar on a single line. Removed the separate step text line and surrounding blank lines.

`displayTokenStats` — function now returns early and prints nothing when utilization is below 70% and `overBudget` is false. Above 70% it prints a single muted line. The model name was removed from the stats line (redundant with the session header).

`displayReflection` — reduced from four lines (separator, decision, reason, blank) to a single symbol line: `↓ proceed`, `↺ retry`, or `✓ done`.

`displayFinalOutput` — removed the separator line and the `── final output` header banner. Kept the orbit branding line and the rendered markdown output.

`onToolCall` callback — tool name displayed on a single line with a status symbol (`✓` or `▸`). Raw JSON result content removed entirely.

**Impact:** A 10-step session that previously produced approximately 80-120 terminal lines per step now produces 4-6 lines per step. Total session output is reduced by roughly 70%. Token consumption is unaffected — terminal output never enters the API payload.

**Files touched:** `server/src/cli/chat/chat-with-ai-iterative.js`.

---

## Architecture Note — Server Independence

The Express server is only required for initial GitHub OAuth login. Once authenticated, the CLI calls provider APIs directly and writes to the database via Prisma without the Express server. The server does not need to be running for agentic sessions, chat, or tool calling. It must be running when executing `orbit login` for the first time.

---

## Problems Encountered — Master List

### 1. Gemini Free Tier Rate Limits

**Root cause:** The Gemini free tier allows 15 requests per minute (2 RPM for Gemini 2.5 Flash). The agentic loop makes multiple model calls per step — one for planning, one per action, one for reflection. A task with 3 steps can easily trigger 9+ model calls within a minute. Additionally, planning and reflection were hardwired to Gemini even when Claude was selected, because `generateStructured` threw unconditionally in `ClaudeProvider` and `sendMessageWithFallback` caught the error and fell back to Gemini.

**Status:** Resolved. Planning and reflection now execute on the selected provider via the `generateStructured` implementation in `ClaudeProvider`. Gemini is only used when it is the selected provider or as an explicit fallback on quota/auth errors.

---

### 2. Tool Results Returning Undefined

**Root cause:** The provider stream handling used a v4-style pattern that did not reliably propagate tool result chunks in AI SDK v5. Additional schema argument destructuring issues under Zod v4 caused fields to be dropped in some tools.

**Status:** Resolved in 0.17 and 0.18 by migrating to `fullStream` chunk handling and applying `execute(args)` patterns in affected tools.

---

### 3. npm Global Install EEXIST Error

**Root cause:** A previous global install left binary stub files in the npm global bin directory. A fresh `npm install -g .` attempts to create these files but finds they already exist.

**Solution:** Delete `orbit.cmd`, `orbit.ps1`, and `orbit` from `%AppData%\Roaming\npm` on Windows, then run `npm install -g .` again.

---

### 4. Dotenv Loading Zero Variables

**Root cause:** `dotenv.config()` without an explicit path defaults to `process.cwd() + '/.env'`. When the CLI is invoked from the user's project directory, `process.cwd()` points to that directory, not the Orbital source directory.

**Solution:** Derive the absolute path to `.env` using `import.meta.url` and `fileURLToPath`. This resolves relative to the source file's location regardless of invocation directory.

---

### 5. Prisma 6 Schema Validation Error P1012

**Root cause:** Prisma 6 made the `url` argument in the datasource block mandatory. An earlier refactor had commented it out.

**Solution:** Restore `url = env("DATABASE_URL")` to the datasource block in `schema.prisma`.

---

### 6. Windows Path Spaces

**Root cause:** `child_process.exec()` interprets spaces in command strings as argument separators.

**Solution:** Use `path.resolve()` to normalize all paths. Pass the working directory as a separate `cwd` option to `child_process`.

---

### 7. AgentTask Persistence Empty

**Root cause:** The agentic loop writes `AgentTask` records at the start of execution. Rate limit errors on Gemini free tier can crash the process before the first database write completes.

**Status:** Partially resolved. Multi-step tasks complete reliably when using paid API tiers. Ghost tasks (zero plan, zero steps) now appear in the resume prompt when planning fails — they are harmless but misleading. Selecting "new" skips them. A filter to suppress zero-plan tasks from the resume UI is a known pending fix.

---

### 8. Arrow Key Navigation in Clack Select

**Root cause:** Clack uses the `value` field to track selection. When multiple conversations had the same title, duplicate values caused navigation to jump to the wrong option.

**Solution:** Use the unique conversation `id` as the `value` and the title as the `label`.

---

### 9. Auto-Cycling Main Menu

**Root cause:** The main menu was a recursive function. Returning from nested menus resumed intermediate stack frames, causing phantom menu cycles.

**Solution:** Replace the recursive function with a `while (true)` loop.

---

### 10. Module-Level Provider Instantiation

**Root cause:** `const aiService = getProvider()` at module level in `chat-with-ai-iterative.js` executed before `wakeUp.js` wrote `ORBITAL_MODEL_PROVIDER` to the environment. All AI calls in the iterative agent used Gemini regardless of selection.

**Solution:** Removed the module-level declaration. `getProvider()` is now called lazily inside `generatePlan`, `reflectOnStep`, and the `compressIfNeeded` call. The unused `AIService` import from `google-service.js` was also removed.

---

### 11. ClaudeProvider Tool Execution

**Root cause:** `ClaudeProvider.sendMessage` only listened for `text_delta` stream events. All `tool_use` content blocks were discarded. The model's intent text before the tool call was returned as the step result with nothing executed.

**Solution:** Implemented a full multi-turn tool execution loop in `ClaudeProvider.sendMessage` that correctly handles `content_block_start` for tool_use, `input_json_delta` for streaming tool input, appends structured assistant content, executes tools via the registry, and appends tool_result user turns until `stop_reason` is `end_turn`.

---

### 12. generateStructured Throwing in ClaudeProvider

**Root cause:** `ClaudeProvider.generateStructured` threw unconditionally. `sendMessageWithFallback` caught it as a quota error and routed all planning and reflection to Gemini.

**Solution:** Implemented `generateStructured` in `ClaudeProvider` calling `client.messages.create` (non-streaming) with JSON-only system instruction, regex-based JSON extraction, and Zod schema validation with retry.

---

### 13. Aerolink Proxy Rejecting Assistant Prefill

**Root cause:** The aerolink proxy returns `400 — This model does not support assistant message prefill` when the last message in the array has role `assistant`. The prefill technique (seeding `{` to force JSON-first output) was incompatible with this proxy.

**Solution:** Removed the assistant prefill message. Used regex extraction `\{[\s\S]*\}` to locate the JSON object in whatever response Claude returns, handling prose-prefixed responses without requiring prefill.

---

### 14. Claude Sonnet 4.6 Returning Wrong JSON Shape

**Root cause:** Claude Sonnet 4.6 returned `steps` as an array of objects (`{ step, description }`) rather than an array of plain strings. Gemini's `generateObject` enforces the Zod schema at the SDK level; the Anthropic API does not — shape enforcement must be in the prompt.

**Solution:** Added explicit shape instruction to the `generateStructured` user message: `The "steps" field must be an array of plain strings, not objects`.

---

## Current Known Issues

- **Ghost tasks in resume prompt** — When planning fails (rate limit or API error), an `AgentTask` record is created with an empty plan. On next launch, the resume prompt shows this task. Selecting "new" skips it cleanly. A filter suppressing zero-plan tasks from the resume UI is a pending fix.
- **MCP memory field name hallucination** — Gemini occasionally uses `"type"` instead of `"entityType"` despite schema hints and system prompt guidance. Mitigated via explicit examples in `ORBITAL_SYSTEM_PROMPT` but not fully resolved when Gemini is the active provider.
- **Puppeteer MCP incompatible** — `@modelcontextprotocol/server-puppeteer` times out on connection. Use PinchTab browser tools instead.
- **One dotenv verbose line on startup** — A single status line still appears on first CLI invocation from some environments. Source not yet identified.
- **ORBITAL_MODEL must be set manually** — The `ACTIVE_MODEL` constant in `chat-with-ai-iterative.js` reads `process.env.ORBITAL_MODEL` at module load time. If this is not set in `.env`, the token stats line shows `gemini-2.5-flash` regardless of the selected provider. The budget calculation is still correct for the 1M Gemini context window but displays the wrong model name and uses the wrong budget for Claude or GPT-4o sessions.

---

## Planned Future Sessions

- **RAG / Vector Memory** — pgvector extension on Neon for semantic search over large codebases. Store file embeddings at project analysis time. Retrieve semantically relevant files rather than reading blindly. The `ragChunks` parameter in `preparePayload` is already wired and waiting for this layer. Complement the MCP memory server (knowledge graph) with vector-based similarity search for code.
- **Test Suite** — Unit tests for the tool registry (registration, retrieval, schema generation). Unit tests for the token manager (budget calculation, truncation, orphan cleanup). Unit tests for the MCP client, loader, and wrapper. Integration tests for the iterative agent tool call loop. End-to-end tests for all four CLI modes.
- **Multi-Agent Orchestration** — Spawn sub-agents for independent parallel tasks. One planning agent, multiple execution agents. Results merged by orchestrator. Reduces total session time for large goals.
- **Production Hardening** — Environment validation on startup with clear error messages for missing keys. Structured logging with log levels. Graceful shutdown handling. Public npm package release preparation.

---

## Design Decisions and Rationale

### Client-Server Architecture Over Pure CLI

Keeping all intelligence and secrets on the server rather than in the CLI binary was a deliberate choice. A pure CLI approach would require each user to have their own API keys embedded locally or passed as flags. A server centralizes secret storage, model switching, authentication, and orchestration. The tradeoff is that users must run a server locally. For a hosted deployment, this architecture becomes a clear advantage.

### Prisma Over Raw SQL

Prisma was chosen over raw SQL for three reasons: type safety (the generated client catches schema mismatches at compile time), migration management (`prisma db push` and `prisma migrate` handle schema changes), and relation handling (Prisma's `include` syntax for loading related models is significantly cleaner than manual JOIN queries).

### Clack Over Inquirer.js

Clack provides better visual output, a modern async/await API, and built-in components for spinners, select menus, text inputs, and confirmation prompts. Inquirer.js has a callback-oriented API that does not compose cleanly with the async-first codebase.

### Registry Pattern for Tools

The registry pattern was chosen because extensibility was the primary goal. Adding a new tool requires zero changes to the orchestrator or any existing code — only creating a new file and importing it in `index.js`. Any file that calls `registerTool` at import time is automatically included in the tool set available to the model.

### Better Auth Over Custom Auth

Building a custom GitHub OAuth implementation would require handling the OAuth callback, token exchange, session creation, session validation, refresh logic, and device code flow manually. Better Auth provides all of this with a single configuration.

### Vercel AI SDK

The Vercel AI SDK was chosen because it provides a unified interface across multiple model providers. Switching from Gemini to OpenAI or Groq requires changing a provider import, not rewriting the orchestrator. The SDK also provides built-in abstractions for streaming responses and tool calling. The Claude provider does not use the Vercel AI SDK — it calls the Anthropic SDK directly because the Anthropic SDK's multi-turn tool use pattern (`stream → finalMessage → append → loop`) requires explicit message management that the Vercel AI SDK abstracts away in ways that conflict with the proxy and extended tool loop requirements.

### MCP Registry Integration Pattern

MCP tools are injected into the same central registry as built-in tools rather than maintaining a separate MCP tool list. The orchestrator, tool calling mode, and iterative agent all call `getToolSchemas(context)` to get available tools. By injecting MCP tools into the registry at startup, zero changes were needed to any of the three consumers. MCP tools are indistinguishable from built-in tools at the orchestrator level — they have the same name, description, parameters, and execute function shape. The only difference is their name prefix (`mcp__serverName__toolName`).

### Walk-Up Directory Search for MCP Config

The `.orbit-mcp.json` config file is discovered by walking up the directory tree from the current working directory, checking each level for the config file. This mirrors how git discovers `.gitignore` and `.git` directories. The benefit is that users can run `orbit wakeup` from any subdirectory of their project and still have their project-level MCP config loaded automatically. A global fallback at `~/.orbit/mcp.json` ensures tools are always available when running from directories with no project config.

### Token Manager Design — Provider-Agnostic Budget

The token manager reads model context windows from a static config map keyed by model name, not from API responses or environment variables. This means the budget calculation is always local and fast, never requires an API call, and works identically regardless of which provider is active. The tradeoff is that the config map must be updated when new models are added. Adding a model is a single line in `MODEL_CONFIGS`. The `resolveConfig` function uses longest-prefix matching so versioned or dated model IDs resolve to the correct entry without requiring an exact match.

### Lazy Provider Instantiation

`getProvider()` must be called inside functions at call time, never at module load time. Node.js ESM modules evaluate all top-level code synchronously on first import. The `wakeUp.js` command writes `ORBITAL_MODEL_PROVIDER` to the environment after the iterative agent module has already been imported and evaluated. A module-level `getProvider()` call always reads an empty or stale env var. Calling `getProvider()` lazily inside each function that needs it ensures the env var is read after the user's model selection has been written.
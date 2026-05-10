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
- **Conversation management** — REST endpoints for creating, listing, retrieving, and deleting conversations and messages (`server/src/routes/conversation.routes.js`).
- **AI orchestration** — Receives messages from the CLI, injects system prompts and project context, calls the AI model, handles tool call loops, and streams responses back.
- **Tool execution** — When the model requests a tool call, the orchestrator looks up the tool in the registry, executes it with the provided arguments and context, and returns the result to the model.

The orchestrator logic lives in `server/src/service/` and `server/src/lib/`.

### Database Layer

**Location:** `server/prisma/`

Storage uses **PostgreSQL** accessed through **Prisma ORM**. For development and hosted deployments, **Neon** provides a serverless PostgreSQL database that requires no local installation.

Prisma handles:
- Schema definition in `server/prisma/schema.prisma`
- Type-safe database client generation via `prisma generate`
- Schema push to the database via `prisma db push`

The schema models are documented in the Database Schema section below.

### Auth Layer

**Location:** `server/src/lib/` (Better Auth configuration)

Authentication is handled by **Better Auth** with the GitHub OAuth provider. The flow uses a device code pattern — the CLI requests a device code from the server, opens the browser to the GitHub authorization URL, and polls until the user completes login. The session is then stored server-side and the CLI receives a token for subsequent requests.

### AI Layer

**Location:** `server/src/cli/ai/` and `server/src/config/agent.config.js`

The AI layer uses **Google Gemini** via the **Vercel AI SDK** (`ai` package). The Vercel AI SDK provides a unified interface across model providers, built-in streaming support, and a structured tool calling abstraction.

Model calls are structured as follows:

1. The system prompt is loaded from `server/src/config/agent.config.js` (`ORBITAL_SYSTEM_PROMPT`).
2. Project context (from the context reader) is appended to the system prompt.
3. Conversation history is assembled from database records.
4. The model call is made via `AIService` in `server/src/cli/ai/google-service.js`.
5. If the model response contains a tool call, the orchestrator executes the tool and returns the result to the model for the next iteration.

### Tool Layer

**Location:** `server/src/tools/`

Tools are implemented using a **registry pattern**. Each tool file registers one or more tools by calling `registerTool(name, definition)` from `server/src/tools/registry.js`. The registry stores tools in an in-memory `Map`.

At startup, `server/src/tools/index.js` imports all tool files, which triggers registration as a side effect. The orchestrator then calls `getToolSchemas(context)` to retrieve all 32 registered tools formatted for the Vercel AI SDK.

The 32 tools are spread across 8 files:
- `filesystem.js` — read, write, append, delete files
- `shell.js` — execute shell commands
- `git.js` — git status, add, commit, diff, log
- `dependencies.js` — npm install, uninstall, list
- `package-manager.js` — run Python, Rust, Go, and Ruby commands
- `directory.js` — create directory, list contents, move, copy, delete directory
- `web.js` — web search and URL fetching
- `browser.js` — PinchTab-powered browser navigation and interaction

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

A single message within a conversation. Stores all roles including system and tool messages.

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | Primary key |
| `conversationId` | String | Foreign key → Conversation |
| `role` | String | "user", "assistant", "system", "tool" |
| `content` | String | JSON string for complex (multi-part) content |
| `createdAt` | DateTime | Auto-set |

### AgentTask

Stores the state of an agentic loop run — goal, plan, step progress, results.

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
| `lastPolledAt` | DateTime? | Last time CLI polled for status |
| `pollingInterval` | Int? | Recommended polling interval in seconds |

---

## Development Sessions Log

### v0.1.0 — Conversation History Retrieval

**What was built:** The ability to list, view, and resume past conversations from inside the CLI.

**Approach:** Added two GET endpoints — one to list all conversations for the authenticated user, one to retrieve the full message history of a specific conversation. On the CLI side, added a `history` command and a `View history` option in the main menu. Used Clack's `select` component to display the list and let the user choose a session to resume. When a session is resumed, the message history is injected into the AI context so the model has full recall.

**Problems:** Conversation history was being stored in the database but there was no way to get it back out into the CLI. The CLI had no history command and no menu option.

**Resolution:** Implemented the GET endpoints and CLI UI from scratch.

---

### v0.2.0 — Iterative Agent Reasoning Loop

**What was built:** A multi-step agentic loop that plans before acting and reflects after each step.

**Approach:** Implemented the goal → plan → act → observe → reflect → repeat loop in the orchestrator. The loop has a hard limit of 10 steps to prevent runaway execution. Added the `--iterative` flag to `orbit wakeup` to invoke this mode. Loop state (current step, results so far) is held in memory during execution.

**Problems:** Single-shot generation has no planning or self-correction. If the first output is wrong, there is no mechanism to detect that and try again. Long goals produce incomplete results.

**Resolution:** The iterative loop breaks the goal into a plan at the start, executes one step at a time, feeds each step's result back to the model, and decides whether to continue or conclude.

---

### v0.3.0 — Project Context Reader

**What was built:** A context reader that scans the user's project before the agent acts.

**Approach:** Before starting an agentic or chat session, Orbital traverses the project directory (up to a configurable depth), reads `package.json` to detect the framework and dependencies, and assembles a structured context summary. This summary is injected into the system prompt so the model understands what already exists before generating anything.

**Problems:** Without project context, the agent acted blind. It would generate code that conflicted with existing implementations, use the wrong package names, or recreate things that already existed.

**Resolution:** The context reader at `server/src/cli/contextReader.js` handles filesystem traversal, package.json parsing, and framework detection. The output is appended to the system prompt at the start of each agentic session.

---

### v0.4.0 — Agent System Prompt Overhaul

**What was built:** A completely rewritten system prompt for the agent, exported from a dedicated config file.

**Approach:** The original system prompt was a generic "you are a helpful coding assistant" instruction. It was replaced with `ORBITAL_SYSTEM_PROMPT` in `server/src/config/agent.config.js`. The new prompt gives the agent:
- A clear professional identity (autonomous developer agent)
- Reasoning directives (plan before acting, think step by step)
- Tool usage directives (prefer tools over generating code that runs manually)
- Output quality directives (complete files, no placeholders)
- Context integration directives (use the project context provided)

The system prompt is applied via `AIService.sendMessage({ system })` and `AIService.generateStructured()` across all modes.

**Problems:** The basic generation prompt produced inconsistent, low-quality output. The model had no instructions for how to behave as an agent vs. a chat assistant.

**Resolution:** Full system prompt rewrite applied consistently across chat mode, tool calling mode, and agentic mode.

---

### v0.5.0 — Global CLI Installation and Output Directory Control

**What was built:** The ability to install `orbit` globally and control where generated files are written.

**Approach:** Added a `bin` field to the root `package.json` pointing to `server/src/cli/main.js`. This allows `npm install -g .` to register the `orbit` binary system-wide. To solve the output directory problem, the CLI captures `process.cwd()` at invocation time (before any directory changes). In agentic mode, the user is prompted to specify an output directory. The input is resolved to an absolute path using `path.resolve()`. All file operations use this resolved path.

**Problems:** Before this, the CLI only worked when run from the source directory. Generated files landed wherever the Node process happened to be running — often inside the Orbital source folder, mixing generated output with project source code.

**Resolution:** `bin` registration for global install. `process.cwd()` capture at startup for reliable working directory. User-facing output directory prompt with `path.resolve()` for absolute path safety.

---

### v0.6.0 — Project Documentation (Initial)

**What was built:** `README.md`, `.env.example`, `CHANGELOG.md`.

**Approach:** Created a beginner-friendly README covering what Orbital is, all prerequisites, step-by-step installation, environment variable reference, usage guide, troubleshooting, and contributing guide. Created `.env.example` with every required variable and plain-English comments. Created `CHANGELOG.md` documenting all sessions from v0.1.0 onward.

---

### v0.7.0 — Prisma 6 Compatibility Fix

**What was built:** A fix for Prisma schema validation errors that broke migrations on Prisma 6.

**Approach:** Prisma 6 requires an explicit `url = env("DATABASE_URL")` field in the datasource block. An earlier change had commented this line out (the URL was being passed programmatically), which caused `P1012` schema validation errors. Restored the `url` field to `schema.prisma`. Simplified `prisma.config.ts` to remove the programmatic URL override. Fixed dotenv load order so `DATABASE_URL` is in the environment before Prisma initializes.

**Problems:** `npx prisma db push` and `npx prisma generate` were failing with `P1012: error in data model: Argument "url" is missing in data source block "db"`.

**Resolution:** `url = env("DATABASE_URL")` restored to the datasource block in `schema.prisma`.

---

### v0.8.0 — CLI Command Registration Fixes

**What was built:** Fixes for the `orbit history` command and history menu option.

**Approach:** Commander.js subcommand registration had an issue where `orbit history` threw "too many arguments" because the command was not correctly defined as a subcommand (was registered as an option instead). Fixed the Commander.js registration. Added the history option to the main Clack menu so it appears as a first-class choice alongside chat and agentic modes.

**Problems:** Running `orbit history` produced an error. The main menu had no history option, forcing users to type the subcommand.

**Resolution:** Corrected Commander.js subcommand definition. Added `View history` to the main menu select options.

---

### v0.9.0 — Dotenv Absolute Path Fix and Task State Memory

**What was built:** A reliable dotenv loading mechanism and the `AgentTask` Prisma model.

**Approach:** The original dotenv load called `dotenv.config()` without a path argument, which defaults to `process.cwd() + '/.env'`. When the CLI is invoked from a different directory (which is the point of a global install), `process.cwd()` is the user's project folder, not the Orbital source folder. This caused zero environment variables to load. Fixed by using `import.meta.url` to derive the absolute path to the `.env` file at the Orbital source location, regardless of where the CLI is invoked from.

The `AgentTask` model was added to the Prisma schema to support task state persistence — storing the goal, plan, current step, step results, and status so that an interrupted agentic session can be resumed.

**Problems:** `injecting env (0)` on every invocation from outside the source directory. No database model for storing agentic task state.

**Resolution:** Absolute path derivation via `import.meta.url`. `AgentTask` model added to schema and migrated.

---

### v0.10.0 — Tool Registry and Core Developer Tools

**What was built:** The tool registry pattern and 21 developer tools.

**Approach:** Previously, tools were hardcoded in the orchestrator. Adding a new tool required modifying orchestrator source. Implemented a registry pattern: `registerTool(name, definition)` stores tools in an in-memory Map. `getToolSchemas(context)` returns all tools formatted for the Vercel AI SDK. Tool files self-register at import time. `server/src/tools/index.js` imports all tool files once at server startup.

Implemented 21 tools across 5 files:
- `filesystem.js` — read file, write file, append to file, delete file
- `shell.js` — execute shell command
- `git.js` — git status, git add, git commit, git diff, git log
- `dependencies.js` — npm install, npm uninstall, list dependencies
- `directory.js` — create directory, list contents, move, copy, delete directory

**Problems:** Hardcoded tool list made the tool layer fragile and hard to extend. Every new tool required orchestrator changes.

**Resolution:** Registry pattern with clean import-time registration. Zero orchestrator changes needed to add a new tool.

---

### v0.11.0 — Tool Invocation Fix

**What was built:** The tool use loop in the orchestrator.

**Approach:** Tools were registered correctly but the model was not calling them — or when it did, results were returning `undefined`. Implemented the tool use loop: after each model call, check whether the response contains a tool call. If it does, execute the tool via the registry, collect the result, and pass it back to the model as a tool result message. Continue until the model returns a text response with no pending tool calls.

**Problems:** The model would request a tool call but the orchestrator was not handling the response type. Tool results were never sent back, so the model could not complete its reasoning.

**Resolution:** Tool call detection in the orchestrator response handler. Execution via registry. Result returned to model in the next message.

---

### v0.12.0 — Windows Path Spaces Fix

**What was built:** A fix for file and shell operations failing when paths contain spaces.

**Approach:** Paths like `C:\Users\name\Stock analysis` broke `child_process.exec` because the space in the path was interpreted as an argument separator. Also broke `fs` calls in some cases. Fixed by adding a `resolvePath` utility using `path.resolve()` to normalize all paths before use. For shell execution, the working directory is passed as a separate `cwd` option to `child_process` rather than being concatenated into the command string.

**Problems:** Any agentic session targeting a directory with spaces in the path would fail immediately.

**Resolution:** `path.resolve()` everywhere. `cwd` as a separate option, never string-concatenated into shell commands.

---

### v0.13.0 — Conversation Deletion and CLI Output Cleanup

**What was built:** Conversation deletion from the history UI and suppression of verbose startup output.

**Approach:** Added a `DELETE /conversations/:id` endpoint with Prisma cascade deletion (messages and agent tasks are removed with the conversation). Added a delete option in the history menu after selecting a conversation. The user must confirm before deletion.

On the output cleanup side: dotenv was printing verbose load output on every startup. Removed debug `console.log` statements added during development. Set `quiet: true` on the dotenv config call to suppress its output.

**Problems:** No way to delete conversations. Startup output was cluttered with dotenv messages and development debug logs, making the CLI feel unpolished.

**Resolution:** DELETE endpoint with cascade. Clack confirmation UI for deletion. `quiet: true` on dotenv. Debug logs removed.

---

### v0.14.0 — Navigation and UX Fixes

**What was built:** Persistent main menu loop, back navigation in every submenu, and fixed arrow key selection.

**Approach:** The main menu was implemented as a recursive function call. Each mode invoked the menu again when it finished. This caused previous call stacks to resume when returning from nested menus, leading to the menu appearing to cycle automatically without user input. Replaced recursion with a `while` loop.

Back navigation was added to every submenu. When the user selects Back, control returns to the top of the while loop and the main menu is re-displayed cleanly.

Arrow key navigation in the history select menu was broken because conversation titles were used as both labels and values. If two conversations had the same title, Clack's select component would navigate to the wrong one. Fixed by using the unique conversation `id` as the value and the title as the label.

**Problems:** CLI exited after each mode. No back button. History navigation broke with duplicate titles.

**Resolution:** `while` loop for persistent menu. Back options in every submenu. Unique conversation IDs as select values.

---

### Session 8 — Tool Execution Fix

**What was built:** A registry-backed tool configuration that exposes all 21 tools in Tool Calling mode.

**Approach:** Rewrote `server/src/config/tool.config.js` to source `availableTools` from `getAllTools()` and to call `getToolSchemas(context)` inside `getEnabledTools()`. Updated `server/src/cli/chat/chat-with-ai-tool.js` to pass `{ outputDirectory: process.cwd() }` into `getEnabledTools`. Files touched: `server/src/config/tool.config.js`, `server/src/cli/chat/chat-with-ai-tool.js`.

**Problems:** `tool.config.js` was disconnected from the tool registry and only knew about three Google-native tools, which disabled most tool calls.

**Resolution:** Tool Calling mode now exposes and executes all 21 registered tools correctly.

---

### Session 9 — Web Search Integration

**What was built:** Two new web tools (`web_search`, `fetch_url`) were added and the registered tool count increased from 21 to 23.

**Approach:** Created `server/src/tools/web.js` and registered both tools there. Updated `server/src/tools/index.js` to import `web.js` so registration runs at startup. Added `@tavily/core` to `server/package.json`. Updated `ORBITAL_SYSTEM_PROMPT` to mention both web tools.

`web_search` uses the `@tavily/core` package to query the Tavily search API and returns result titles, URLs, and content snippets, with a maximum of 10 results.

`fetch_url` uses native `fetch`, strips HTML tags, returns plain text, applies a 10-second timeout, and defaults to a maximum of 3000 characters.

**Problems:** The agent lacked native web retrieval capability for current information and page content extraction.

**Resolution:** Web search and URL fetching are now first-class registered tools available to the agent, and the tool layer now exposes 23 total tools.

---

### Session 10 — Multi-Language Runtime Support

**What was built:** Four new language runtime tools were added in `server/src/tools/package-manager.js` and the registered tool count increased from 23 to 27.

**Approach:** Added `run_python`, `run_cargo`, `run_go`, and `run_ruby` to execute language-native workflows directly from the agent. Extended the context reader to detect Python, Rust, Go, and Ruby projects from common project files so the agent can pick the correct runtime tool automatically.

Detection sources:
- Python: `requirements.txt`, `pyproject.toml`, `setup.py`, `Pipfile`, `poetry.lock`
- Rust: `Cargo.toml`
- Go: `go.mod`
- Ruby: `Gemfile`

**Problems:** npm-only execution paths limited agent workflows in non-Node repositories.

**Resolution:** Orbit now supports multi-language execution workflows with language-aware tool selection in Agentic mode.

---

### Session 10.5 — PinchTab Browser Integration

**What was built:** Five new browser automation tools were added in `server/src/tools/browser.js` and the registered tool count increased from 27 to 32.

**Approach:** Integrated PinchTab as a Chrome automation backend over HTTP and added:
- `browser_navigate`
- `browser_snapshot`
- `browser_click`
- `browser_fill`
- `browser_extract_text`

Added environment variable support for:
- `PINCHTAB_URL` (default `http://localhost:9867`)
- `PINCHTAB_TOKEN` (Bearer auth token)

**Problems:** `fetch_url` could not handle JavaScript-rendered or interactive browser workflows.

**Resolution:** Orbit now supports token-efficient browser automation for dynamic pages through PinchTab, with explicit error handling when PinchTab is not running.

---

### Bug Fixes Applied During Sessions 10 and 10.5

1. **Vercel AI SDK v5 compatibility (`gemini-provider.js`)**
   - Migrated from the v4-style `result.textStream + result.steps` pattern to `result.fullStream`.
   - `fullStream` chunk handling now covers: `text-delta`, `tool-call`, `tool-result`, `step-finish`.
   - Fixed tool results becoming `undefined` after execution.

2. **Zod v4 args destructuring fix (`web.js`, `browser.js`, `package-manager.js`)**
   - Replaced `execute({ ... })` parameter destructuring with `execute(args)` plus field extraction inside the function.
   - This avoids dropped fields under Zod v4 + AI SDK v5 schema parsing behavior.

3. **Tool call/result rendering fix (`chat-with-ai-tool.js`)**
   - Updated tool call rendering from `tc.args` to `tc.input ?? tc.args`.
   - Updated tool result rendering from `tr.result` to `tr.output ?? tr.result ?? tr`.
   - Added spinner stop handling when no text chunks arrive after a tool call.
   - Added tool result synthesis when the model returns no text.

---

### Sessions A–D — Agent Loop Hardening

**What was built:** A hardened agent loop with typed exit reasons, bounded retries, context compression, and orphaned tool result handling.

**Approach:** Added new modules under `server/src/cli/agent/` (`terminal-reason.js`, `circuit-breaker.js`, `context-compressor.js`, `orphan-guard.js`) and integrated them into `server/src/cli/chat/chat-with-ai-iterative.js` for turn limits, retry backoff, message compaction, and tool result repair. Files touched: `server/src/cli/agent/terminal-reason.js`, `server/src/cli/agent/circuit-breaker.js`, `server/src/cli/agent/context-compressor.js`, `server/src/cli/agent/orphan-guard.js`, `server/src/cli/chat/chat-with-ai-iterative.js`.

**Problems:** The agent loop could run unbounded, grow context indefinitely, and crash on orphaned tool executions.

**Resolution:** The loop now exits cleanly with typed terminal reasons, respects circuit breaker limits, compresses long histories, and repairs missing tool results.

---

### Phase 1 — Provider Abstraction

**What was built:** A provider abstraction layer with a validated interface and a factory entry point.

**Approach:** Added `server/src/cli/ai/provider-interface.js` to define the provider contract, moved Gemini logic into `server/src/cli/ai/providers/gemini-provider.js`, added `server/src/cli/ai/provider-factory.js` for lookup and registration, and converted `server/src/cli/ai/google-service.js` into a backwards-compatible re-export shim. Files touched: `server/src/cli/ai/provider-interface.js`, `server/src/cli/ai/provider-factory.js`, `server/src/cli/ai/providers/gemini-provider.js`, `server/src/cli/ai/google-service.js`.

**Problems:** Model access was hard-wired to Gemini, making additional providers difficult to integrate without orchestrator changes.

**Resolution:** All model access now flows through a single validated provider interface and factory.

---

### Phase 2 — Multi-Model Support

**What was built:** Multi-model provider support with a startup selection menu and API key availability checks.

**Approach:** Added `server/src/cli/ai/providers/claude-provider.js` and `server/src/cli/ai/providers/openai-provider.js`, registered all providers in `server/src/cli/ai/provider-factory.js` with display info, and updated `server/src/cli/commands/ai/wakeUp.js` to prompt for provider selection, set `ORBITAL_MODEL_PROVIDER`, and fall back to Gemini when keys are missing. Files touched: `server/src/cli/ai/providers/claude-provider.js`, `server/src/cli/ai/providers/openai-provider.js`, `server/src/cli/ai/provider-factory.js`, `server/src/cli/commands/ai/wakeUp.js`.

**Problems:** Users could not choose between models or see which providers were configured.

**Resolution:** Gemini, Claude Sonnet 3.5, and GPT-4o are now selectable at startup with safe fallback behavior.

---

### Session 13 — TUI Redesign

**What was built:** A complete redesign of all four mode displays and the main menu using a unified chalk-based design language. Replaced all boxen borders, emoji headers, and Clack intro/outro wrappers with clean terminal output.

**Approach:** Applied a unified hex color system across all files: cyan (#22d3ee) for orbit branding, blue (#38bdf8) for user messages, purple (#a78bfa) for AI responses, green (#4ade80) for success, yellow (#facc15) for warnings/thinking, red (#f87171) for errors, gray (#6b7280) for secondary text.

Files modified:
- `server/src/cli/chat/chat-with-ai.js` — Status bar on entry, "you"/"orbit" role labels, left accent border on messages, live streaming with thinking spinner, divider lines
- `server/src/cli/chat/chat-with-ai-tool.js` — Tool activity section with arrow prefix, tool results with checkmarks and timing, structured response display
- `server/src/cli/chat/chat-with-ai-agent.js` — Compact generation progress display, structured file/command output list
- `server/src/cli/chat/chat-with-ai-iterative.js` — Block character progress bar (█░), phase labels (planning/acting/reflecting), reflection decision display with decision and reason
- `server/src/cli/commands/ai/wakeUp.js` — Unified hex colors, clean feedback messages, no emoji
- `server/src/cli/commands/history/history.js` — Mode badges color-coded by type (cyan=chat, green=tool, purple=agent), conversation list with dates and previews, red warning block for delete confirmation

**Why chalk over Ink:** Ink was attempted across three separate sub-sessions (12-A through 12-B). JSX transpilation via esbuild broke Prisma's native binary resolution because the bundled dist file resolved paths from AppData/npm rather than the project directory. tsx as a loader could not be found from the global install context. Chalk renders natively in Node.js ESM with no build step, no path resolution issues, and no bundling required.

**Problems:** Ink JSX files require either a build step (esbuild) or a loader (tsx). Both approaches broke the global install path resolution. esbuild bundles everything into dist/main.js which runs from AppData/npm — Prisma cannot find its query engine binary from there. tsx requires global install but cannot be resolved from the npm global wrapper script.

**Resolution:** Full chalk-based redesign with no build step. Visually consistent across all modes. Works in any terminal on Windows, Mac, and Linux.

---

### Session 14 — MCP Implementation

**What was built:** Full Model Context Protocol (MCP) support. Orbit can now connect to any MCP-compatible tool server and use its tools alongside the 32 built-in tools.

**Approach:** Three new files in `server/src/mcp/`:

- `client.js` — Connects to a single MCP server via stdio transport using @modelcontextprotocol/sdk. Calls tools/list to discover available tools. Wraps callTool responses (arrays of content blocks) into plain strings. Suppresses server stderr noise via pipe and discard.
- `loader.js` — Reads .orbit-mcp.json with walk-up directory search (mirrors git's .gitignore discovery). Falls back to ~/.orbit/mcp.json for global tools. Connects to all configured servers sequentially and returns all wrapped tools.
- `wrapper.js` — Converts MCP JSON Schema tool definitions to Zod schemas via recursive jsonSchemaToZod conversion. Handles nested object arrays (required for memory server entities). Normalizes tool names to mcp__{serverName}__{toolName} pattern (max 64 chars). Appends schema hints to tool descriptions so the model knows exact field names.

Config locations:
- Project-level: `.orbit-mcp.json` in project root or any parent directory (walk-up search, max 10 levels)
- Global: `~/.orbit/mcp.json` — always loaded as fallback

Integration point: `server/src/cli/commands/ai/wakeUp.js` calls `loadMcpTools(invocationDir)` at startup, then `injectMcpTools()` and `refreshAvailableTools()` to make MCP tools available in all modes including the iterative agent.

MCP servers integrated and tested:
| Server | Tools | Purpose |
|--------|-------|---------|
| @modelcontextprotocol/server-filesystem | 14 | File operations via MCP protocol |
| @modelcontextprotocol/server-memory | 9 | Persistent cross-session knowledge graph |
| @modelcontextprotocol/server-sequential-thinking | 1 | Structured multi-step reasoning scratchpad |
| @modelcontextprotocol/server-github | 26 | Repository, issues, PRs, code search |

**Problems:**
1. JSON Schema to Zod conversion — MCP tools use nested object arrays (entities array containing objects with name/entityType/observations). Initial passthrough schema caused model to send wrong field names. Fixed with recursive jsonSchemaPropertyToZod that handles arrays of objects.
2. Model field name hallucination — Gemini ignored Zod schema and used "type" instead of "entityType". Fixed by appending explicit field name examples to tool descriptions and adding MCP tool instructions to ORBITAL_SYSTEM_PROMPT.
3. @modelcontextprotocol/server-postgres deprecated — removed from config.
4. @modelcontextprotocol/server-puppeteer times out on connection — removed in favor of existing PinchTab tools.
5. MCP server stderr noise — server startup messages printed to terminal making startup look messy. Fixed by adding stderr: 'pipe' to StdioClientTransport and discarding all stderr data.

**Resolution:** 50 MCP tools available alongside 32 built-in tools. Total 82+ tools accessible in all modes.

---

### Session 15 — System Prompt Rewrite and Tool Path Fix

**What was built:** A complete rewrite of ORBITAL_SYSTEM_PROMPT based on analysis of Claude Code's production system prompt source. Fixed critical path resolution bug in all file and directory tools.

**System prompt restructure:**

Old prompt: flat paragraph-style instructions with no clear hierarchy.

New prompt: named sections matching production agent architecture:
- `# Identity` — Agent name, role, environment, primary function
- `# System` — How output reaches the user, tool result handling
- `# Doing Tasks` — Planning before acting, step-by-step execution, failure recovery, verification before claiming completion
- `# Executing Actions With Care` — Reversibility guidance. Explicit list of free actions (read files, run tests, write files) vs actions requiring confirmation (delete, force push, drop database, send messages to external services)
- `# Using Your Tools` — Built-in tool preference hierarchy (read_file over shell cat, write_file over shell echo), MCP tool field names with exact JSON examples, parallel tool call instruction
- `# Output Efficiency` — Concise output, no narration, no step-by-step commentary
- `# Output Quality` — Production-ready code, no placeholders, security awareness
- `# Context Integration` — Use detected stack, verify dependencies before importing
- `# Large Codebase Strategy` — Check memory first, use directory_tree before reading files, search before reading, store findings in memory progressively, never hold full codebase in context
- `# Termination and Communication` — Final summary format, never silently fail, verify before reporting completion

Key additions inspired by Claude Code:
- Reversibility and blast radius categorization
- Security awareness (command injection, XSS, SQL injection)
- Parallel tool calls
- Memory-first workflow for large codebases
- Sequential thinking guidance

**Tool path resolution fix:**

Problem: Built-in file tools (read_file, write_file, delete_file, move_file, search_files) and directory tools (create_directory, list_directory, directory_tree) resolved all paths using process.cwd() as base. When the iterative agent operated on a project in a different directory (the output directory the user specifies), all file reads returned empty results or "file not found" errors.

Root cause: `resolvePath(file_path)` in filesystem.js called `path.resolve(file_path)` with only one argument, making `file_path` itself the base. This resolves relative to process.cwd() not the output directory.

Fix: Added `resolveWithContext(filePath, context)` helper to both `filesystem.js` and `directory.js`:
- If filePath is absolute: use it directly
- If filePath is relative: resolve against `context.outputDirectory`
- Fallback: resolve against `process.cwd()`

Impact: Agent can now correctly read, write, and search files in any project directory regardless of where `orbit wakeup` was launched from. The iterative agent pointed at `C:\\Projects\\myapp` can now read `requirements.txt` as a relative path without needing the full absolute path.

---

### Session 16 — MCP Startup Noise Suppression

**What was built:** Suppression of MCP server process stdout/stderr from appearing in the terminal during startup.

**Problem:** MCP servers print their own startup messages to stderr when launched (e.g. "Secure MCP Filesystem Server running on stdio", "Knowledge Graph MCP Server running on stdio", "Client does not support MCP Roots"). These messages appeared in the terminal interleaved with Orbit's own MCP status lines, making startup look noisy and unprofessional.

**Fix:** Added `stderr: 'pipe'` to the `StdioClientTransport` configuration in `server/src/mcp/client.js`. Added an empty data handler on `transport.stderr` to consume and discard all server stderr output. Orbit's own connection status lines (mcp · connecting to X... / mcp · X connected · N tools loaded) remain visible.

**Result:** Clean startup output showing only Orbit's own status lines.

---

### Architecture Note — Server Independence Discovery

**What was built:** Documentation clarification that the Express server is only required for initial OAuth login.

**Approach:** Confirmed the CLI calls provider APIs directly and writes to the database via Prisma without the Express server once authenticated, then updated docs to reflect the standalone flow. Files touched: `README.md`, `TECHNICAL_JOURNAL.md`.

**Problems:** Documentation previously stated that the server must always be running for CLI usage.

**Resolution:** The docs now state that the server is only needed for initial GitHub OAuth authentication.

---

## Problems Encountered — Master List

### 1. Gemini Free Tier Rate Limits

**Root cause:** The Google Gemini free tier allows 5 requests per minute. The agentic loop makes multiple model calls per step — one for planning, one per action, one for reflection. A task with 3 steps can easily trigger 9+ model calls, all within a minute.

**Status:** Partially resolved. The provider abstraction layer (Phase 1 and 2) added multi-model support with automatic fallback to Gemini. Users can switch to Claude Sonnet 3.5 or GPT-4o at startup to avoid free tier limits. Exponential backoff exists in the circuit breaker module. Full token budget management is planned for a future session.

---

### 2. Tool Results Returning Undefined

**Root cause:** The provider stream handling used a v4-style pattern (`textStream` + `steps`) that did not reliably propagate tool result chunks in AI SDK v5 flows. Additional schema argument destructuring issues under Zod v4 caused fields to be dropped in some tools.

**Status:** Resolved in Sessions 10 and 10.5 by migrating to `fullStream` chunk handling and applying `execute(args)` patterns in affected tools.

---

### 3. npm Global Install EEXIST Error

**Root cause:** A previous global install left binary stub files (`orbit.cmd`, `orbit.ps1`, `orbit`) in the npm global bin directory. A fresh `npm install -g .` attempts to create these files but finds they already exist with different content, causing an `EEXIST` error.

**Solution:** Delete the stuck files manually from `%AppData%\Roaming\npm` on Windows (or the equivalent global bin directory on Mac/Linux), then run `npm install -g .` again.

---

### 4. Dotenv Loading Zero Variables

**Root cause:** `dotenv.config()` without an explicit `path` argument defaults to `process.cwd() + '/.env'`. When the CLI is invoked from the user's project directory, `process.cwd()` points to that directory, not the Orbital source directory where `.env` lives.

**Solution:** Derive the absolute path to `.env` using `import.meta.url` and `fileURLToPath` from the `url` module. This resolves relative to the source file's location, which is always the Orbital install directory regardless of where the CLI is invoked from.

---

### 5. Prisma 6 Schema Validation Error P1012

**Root cause:** Prisma 6 made the `url` argument in the datasource block mandatory at schema validation time. An earlier refactor had commented out `url = env("DATABASE_URL")` because the URL was being passed programmatically in `prisma.config.ts`. Prisma 6 no longer accepts this pattern.

**Solution:** Restore `url = env("DATABASE_URL")` to the datasource block in `schema.prisma`. Remove the programmatic URL override from `prisma.config.ts`.

---

### 6. Windows Path Spaces

**Root cause:** `child_process.exec()` interprets spaces in command strings as argument separators. A command like `cd Stock analysis && npm install` is parsed as `cd Stock` with arguments `analysis && npm install`. `fs` operations also require correctly escaped or resolved paths.

**Solution:** Use `path.resolve()` to normalize all paths before use. Pass the working directory as a separate `cwd` option to `child_process` rather than embedding it in the command string.

---

### 7. AgentTask Persistence Empty

**Root cause:** The agentic loop writes `AgentTask` records to the database at the start of execution. However, the Gemini rate limit error crashes the process before the first `createTask` database write completes on longer tasks.

**Status:** Partially resolved. The iterative agent now completes multi-step tasks when using paid API tiers. AgentTask records are written and the resume flow works via conversation message history. Full task state resume (restoring exact step position) requires further validation.

---

### 8. Arrow Key Navigation in Clack Select

**Root cause:** Clack's `select` component uses the `value` field to track which option is selected. When multiple conversations had the same title, the `value` was duplicated (titles were being used as values). Navigation would jump to the first option matching that value, not the intended one.

**Solution:** Use the unique conversation `id` as the `value` and the human-readable title as the `label`. Navigation is now based on unique identifiers.

---

### 9. Auto-Cycling Main Menu

**Root cause:** The main menu was a recursive function. When the user selected a mode, the function called itself after the mode completed. On return from nested menus, all the intermediate stack frames resumed, causing the menu to appear to cycle automatically without user input.

**Solution:** Replace the recursive function with a `while (true)` loop. Each iteration shows the menu, awaits a selection, handles it, and loops back to the top. Clean stack, no phantom menu cycles.

---

## Current Known Issues

- **Gemini free tier rate limits** — The free tier quota (5 requests/minute) is frequently hit during iterative agent sessions with multiple steps. Each step makes 2-3 model calls (execution + reflection). Use a paid Gemini key or switch to Claude/GPT-4o at the model selection menu for sustained agentic work.
- **MCP memory field names** — Gemini occasionally uses incorrect field names (e.g. "type" instead of "entityType") despite schema hints and system prompt guidance. Mitigated via explicit examples in ORBITAL_SYSTEM_PROMPT but not fully resolved.
- **Puppeteer MCP incompatible** — The @modelcontextprotocol/server-puppeteer package times out on connection. Use the existing PinchTab browser tools instead.
- **One dotenv verbose line on startup** — A single [dotenv] status line still appears on first CLI invocation. Source not yet identified.

---

## Planned Future Sessions

- **Token Management** — Tool result truncation before API calls to prevent large file reads from consuming the full context window. Per-session token budget setting via --budget flag. Step result compression in the iterative agent keeping only the last N steps in full. Token usage display in the status bar so users can monitor consumption in real time.
- **Test Suite** — Unit tests for the tool registry (registration, retrieval, schema generation). Unit tests for the MCP client, loader, and wrapper. Integration tests for the iterative agent tool call loop. End-to-end tests for all four CLI modes (chat, tool calling, agent, iterative).
- **RAG / Vector Memory** — pgvector extension on Neon for semantic search over large codebases. Store file embeddings at project analysis time. Retrieve semantically relevant files rather than reading blindly. Complement the MCP memory server (knowledge graph) with vector-based similarity search for code.
- **Multi-Agent Orchestration** — Spawn sub-agents for independent parallel tasks. One planning agent, multiple execution agents. Results merged by orchestrator. Reduces total session time for large goals.
- **Production Hardening** — Environment validation on startup with clear error messages for missing keys. Structured logging with log levels. Graceful shutdown handling. Public npm package release preparation.

---

## Design Decisions and Rationale

### Client-Server Architecture Over Pure CLI

Keeping all intelligence and secrets on the server rather than in the CLI binary was a deliberate choice. A pure CLI approach would require each user to have their own API keys embedded locally or passed as flags. A server centralizes:

- Secret storage (API keys never touch the client machine)
- Model switching (change the model in one place)
- Authentication (Better Auth session management)
- Orchestration (the tool loop runs server-side)

The tradeoff is that users must run a server locally. For a hosted deployment, this architecture becomes a clear advantage.

### Prisma Over Raw SQL

Prisma was chosen over writing raw SQL for three reasons: type safety (the generated client catches schema mismatches at compile time), migration management (`prisma db push` and `prisma migrate` handle schema changes), and relation handling (Prisma's include syntax for loading related models is significantly cleaner than manual JOIN queries).

### Clack Over Inquirer.js

Clack provides a better visual output (structured prompts with clear grouping), a modern async/await API, and built-in components for spinners, select menus, text inputs, and confirmation prompts. Inquirer.js has a callback-oriented API that does not compose cleanly with the async-first codebase. Clack also produces more polished terminal UI with less boilerplate.

### Registry Pattern for Tools

The registry pattern was chosen over a hardcoded tool list because extensibility was the primary goal. Adding a new tool should require zero changes to the orchestrator or any existing code — only creating a new file and importing it in `index.js`. The registry enforces this contract. Any file that calls `registerTool` at import time is automatically included in the tool set available to the model.

### Better Auth Over Custom Auth

Building a custom GitHub OAuth implementation would require handling the OAuth callback, token exchange, session creation, session validation, refresh logic, and device code flow manually. Better Auth provides all of this with a single configuration. The session management and device code flow in particular involve enough edge cases (token expiry, polling intervals, device code expiry) that reinventing them was not worth the time.

### Vercel AI SDK

The Vercel AI SDK (`ai` package) was chosen because it provides a unified interface across multiple model providers. Switching from Gemini to OpenAI or Groq requires changing a provider import, not rewriting the orchestrator. The SDK also provides built-in abstractions for streaming responses and tool calling that map cleanly onto the Orbital orchestrator design. This decision directly enables the model abstraction layer planned for Session 11.

### MCP Registry Integration Pattern

MCP tools are injected into the same central registry as built-in tools rather than maintaining a separate MCP tool list. This decision was deliberate: the orchestrator, tool calling mode, and iterative agent all call `getToolSchemas(context)` to get available tools. By injecting MCP tools into the registry at startup, zero changes were needed to any of the three consumers. MCP tools are indistinguishable from built-in tools at the orchestrator level — they have the same name, description, parameters, and execute function shape. The only difference is their name prefix (`mcp__serverName__toolName`) which the model uses to understand their source.

### Walk-Up Directory Search for MCP Config

The `.orbit-mcp.json` config file is discovered by walking up the directory tree from the current working directory, checking each level for the config file. This mirrors how git discovers `.gitignore` and `.git` directories. The benefit is that users can run `orbit wakeup` from any subdirectory of their project and still have their project-level MCP config loaded automatically. A global fallback at `~/.orbit/mcp.json` ensures tools are always available when running from directories with no project config.

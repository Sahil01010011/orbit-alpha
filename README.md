
![Orbit Alpha TUI](./assets/orbit-banner.png)

# Orbit Alpha

> An autonomous AI developer agent that lives in your terminal

![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Mac%20%7C%20Linux-lightgrey) ![MCP](https://img.shields.io/badge/MCP-enabled-purple) ![Tools](https://img.shields.io/badge/tools-82%2B-cyan)

---

## What is Orbit?

Orbit is an autonomous AI developer agent that runs entirely inside your terminal. Give it a high-level goal — like "analyze this codebase and add authentication" — and it plans the work, reads your existing files, writes code that fits your project structure, executes shell commands, commits to Git, and explains every decision as it goes.

Orbit is not a chatbot with a terminal wrapper. It is a working agent that takes real actions inside your project. It reads your codebase before acting. It plans before it writes. After each step it reflects on whether the goal was actually advanced before deciding what to do next.

The core loop is: **goal → plan → act → observe → reflect → repeat**

---

## What makes Orbit different

- **MCP-powered** — Connect any MCP-compatible tool server. Orbit ships with filesystem, memory, sequential thinking, and GitHub integrations out of the box. Add any community MCP server with two lines of config.
- **Persistent memory** — Orbit remembers facts, architectural decisions, and project knowledge across sessions via the MCP memory server. Ask it about a project it analyzed last week — it knows.
- **Multi-model** — Switch between Gemini 2.5 Flash, Claude Sonnet 3.5, and GPT-4o at startup. Automatic fallback to Gemini if a provider key is missing.
- **82+ tools** — 32 built-in developer tools plus 50+ MCP tools available in every mode.
- **True autonomy** — The iterative agent runs up to 10 steps automatically. It retries failed steps, compresses context when the window fills, and guards against orphaned tool calls.
- **Project-aware** — Reads your stack before acting. Detects Node.js, Python, Rust, Go, and Ruby projects. Never generates code that clashes with your existing dependencies.

---

## Capabilities

### Built-in Tools (32)

| Category | Tools |
|----------|-------|
| File system | read_file, write_file, delete_file, move_file, search_files |
| Directory | create_directory, list_directory, directory_tree |
| Shell | execute_shell |
| Git | git_init, git_status, git_add, git_commit, git_diff, git_log |
| Package manager | detect_package_manager, install_dependencies, add_dependency, remove_dependency, read_package_json, update_package_json |
| Web | web_search (Tavily), fetch_url |
| Multi-language | run_python, run_cargo, run_go, run_ruby |
| Browser | browser_navigate, browser_snapshot, browser_click, browser_fill, browser_extract_text (PinchTab) |

### MCP Tools (50+)

| Server | Tools | Capabilities |
|--------|-------|-------------|
| filesystem | 14 | Read, write, search, tree via MCP protocol |
| memory | 9 | Persistent cross-session knowledge graph |
| sequential-thinking | 1 | Structured multi-step reasoning scratchpad |
| github | 26 | Repos, issues, PRs, code search, releases |

### Modes

- **Chat** — Multi-turn conversation with full project context
- **Tool Calling** — Direct tool invocation with activity display
- **Agent** — One-shot application generator with structured output
- **Iterative Agent** — Goal → plan → act → reflect loop, up to 10 steps, with all 82+ tools available automatically

---

## Prerequisites

- Node.js 18 or higher — [nodejs.org](https://nodejs.org)
- PostgreSQL database — free hosted option at [neon.tech](https://neon.tech)
- GitHub account — used for OAuth login
- Google Gemini API key — free tier at [aistudio.google.com](https://aistudio.google.com/apikey)
- Git installed and available in your terminal

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/Sahil01010011/orbit-alpha
cd orbit-alpha
```

### 2. Install dependencies

```bash
cd server && npm install && cd ..
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in all values:

```env
PORT=3005
DATABASE_URL="postgresql://user:password@host/dbname"
BETTER_AUTH_SECRET="your-long-random-secret"
BETTER_AUTH_URL="http://localhost:3005"
GITHUB_CLIENT_ID="your-github-oauth-client-id"
GITHUB_CLIENT_SECRET="your-github-oauth-client-secret"
GOOGLE_GENERATIVE_AI_API_KEY="your-gemini-api-key"
ANTHROPIC_API_KEY="your-anthropic-api-key"
OPENAI_API_KEY="your-openai-api-key"
TAVILY_API_KEY="your-tavily-api-key"
PINCHTAB_URL=http://localhost:9867
PINCHTAB_TOKEN=your_pinchtab_token
```

### 4. Set up the database

```bash
cd server
npx prisma db push
npx prisma generate
cd ..
```

### 5. Start the server (first login only)

```bash
cd server && npm run dev
```

Keep this running for the initial GitHub OAuth login. After authenticating once the CLI runs standalone.

### 6. Install the CLI globally

```bash
npm install -g .
```

### 7. Run

```bash
orbit wakeup
```

---

## MCP Configuration

Orbit supports the Model Context Protocol for connecting external tool servers.

### Project-level config

Create `.orbit-mcp.json` in your project root:

```json
{
  "servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  ]
}
```

### Global config

Create `~/.orbit/mcp.json` for tools available in every project:

```json
{
  "servers": [
    {
      "name": "memory",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    {
      "name": "sequential-thinking",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    },
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_token_here"
      }
    }
  ]
}
```

Orbit searches for `.orbit-mcp.json` by walking up from the current directory — the same pattern git uses for `.gitignore`. MCP tools are injected into the tool registry at startup and available in all modes automatically. Tool names follow the pattern `mcp__{serverName}__{toolName}`.

---

## Usage

### Chat mode
orbit wakeup → Chat → New conversation
orbit α │ Gemini 2.5 Flash │ chat │ session-id
────────────────────────────────────────────────────────────
you
│ what does the auth middleware do in this project?
orbit
│ The auth middleware in server/src/middleware/auth.js validates
│ the Bearer token on every protected route...

### Tool Calling mode

Select tools from the menu, then ask Orbit to use them:
orbit α │ Gemini 2.5 Flash │ tool calling │ 3 tools │ session-id
────────────────────────────────────────────────────────────
── tool activity ───────────────────────────────────────────
▸ mcp__github__search_repositories  {"query":"Sahil01010011"}
── tool results ────────────────────────────────────────────
✓ mcp__github__search_repositories
orbit-alpha · aesthetic_corner · webx...

### Iterative Agent mode

```bash
orbit wakeup --iterative
```
orbit α │ Gemini 2.5 Flash │ iterative agent │ session-id │ ~/projects/myapp
────────────────────────────────────────────────────────────
› analyze this codebase and add JWT authentication to all API routes
orbit · plan generated
goal  analyze this codebase and add JWT authentication
why   Read existing routes, understand auth pattern, implement middleware
── steps ───────────────────────────────────────────────────
1  Check memory for existing project knowledge
2  Read directory tree to understand structure
3  Read existing route files
4  Implement JWT middleware
5  Apply middleware to all protected routes
6  Write tests
────────────────────────────────────────────────────────────
██░░░░  step 2/6  ·  acting
Read directory tree to understand structure
▸ directory_tree
✓ src/ routes/ middleware/ models/ ...
── reflect step 2 ──────────────────────────────────────────
decision  proceed to next step
reason    Directory structure understood. Express app with 4 route files.

---

## Architecture
orbit-alpha/
├── server/
│   └── src/
│       ├── cli/
│       │   ├── main.js              — Entry point, banner, Commander setup
│       │   ├── agent/               — Loop hardening (circuit breaker, compressor, orphan guard)
│       │   ├── ai/
│       │   │   ├── provider-factory.js   — Provider selection and fallback
│       │   │   └── providers/            — Gemini, Claude, OpenAI implementations
│       │   ├── chat/                — Four mode implementations
│       │   └── commands/            — CLI commands (wakeup, login, history)
│       ├── mcp/
│       │   ├── client.js            — MCP stdio transport client
│       │   ├── loader.js            — Config loading with walk-up search
│       │   └── wrapper.js           — JSON Schema to Zod, name normalization
│       ├── tools/                   — 32 built-in tools across 7 files
│       ├── config/                  — System prompt, tool config, provider config
│       └── service/                 — Chat and agent task persistence
├── .orbit-mcp.json                  — Project-level MCP server config
└── assets/                          — Static assets

---

## Browser Automation (Optional)

Orbit includes browser tools powered by PinchTab — a lightweight Chrome automation server.

```bash
npm install -g pinchtab
pinchtab          # Select Guard DOWN → Start server
pinchtab config token   # Copy token to .env as PINCHTAB_TOKEN
```

Keep PinchTab running in a separate terminal when using browser tools.

---

## Troubleshooting

**`orbit` command not found**
```bash
npm install -g .
```

**Credentials not loading (`injecting env (0)`)**
Make sure `.env` exists in the `orbit-alpha/` root directory with all required values filled in.

**Database connection error**
Verify `DATABASE_URL` in `.env`. If using Neon, copy the full connection string including password.

**Gemini rate limit errors**
The free tier allows 5 requests per minute. For sustained agentic work, use a paid Gemini key or switch to Claude/GPT-4o at the model selection menu.

**Global install fails with `EEXIST`**
Delete stuck files from your npm global bin directory, then reinstall:
```bash
# Windows — delete from %AppData%\Roaming\npm:
# orbit.cmd, orbit.ps1, orbit
npm install -g .
```

---

## Roadmap

- Token management — per-session budget, tool result truncation, token usage display
- RAG / vector memory — pgvector on Neon for semantic codebase search
- Test suite — unit, integration, and end-to-end tests
- Production hardening — environment validation, structured logging, public release

---

## Contributing

1. Fork the repository
2. Create a branch: `git checkout -b my-feature`
3. Make changes and test locally
4. Commit: `git commit -m "Add my feature"`
5. Push: `git push origin my-feature`
6. Open a Pull Request

Keep pull requests focused on a single change.

---

## License

MIT License — see [LICENSE](LICENSE) for details.
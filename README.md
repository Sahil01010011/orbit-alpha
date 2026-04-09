# Orbital CLI

> An autonomous AI developer agent that lives in your terminal

![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Mac%20%7C%20Linux-lightgrey)

---

## What is Orbital CLI?

Orbital CLI is an AI-powered developer agent that runs entirely inside your terminal. You can have a multi-turn conversation with it, ask it to write code, or give it a larger goal — like "build me a REST API" — and watch it plan the work, create the files, and explain every step as it goes.

Orbital is for developers who want AI help without leaving the command line. You do not need a browser tab, a chat box, or copy-pasting. When you run `orbit wakeup`, Orbital reads your existing project files so it already knows what you have built. It then generates or modifies code that fits naturally into your project — not generic snippets that clash with your structure.

The key difference from using ChatGPT or Claude in a browser is that Orbital takes real actions. It can create files, run shell commands, install packages, commit to Git, and inspect your directory — all from inside your terminal, using your own project as context. It is not a conversation partner; it is a working agent.

---

## What is working

- **GitHub OAuth authentication** — Secure login with your GitHub account. No passwords or API tokens to manage on the client side.
- **AI Chat mode** — Multi-turn conversation with an AI that knows your project. Ask questions, get explanations, request code snippets, and keep the context going across multiple messages.
- **Tool Calling mode** — Explicitly invoke any of the 21 registered developer tools. Useful when you want direct, predictable tool execution rather than a full conversation.
- **All 21 tools working in Tool Calling mode** — Full tool set is available and executes correctly.
- **Agent loop hardening** — Circuit breakers, context compression, orphan guard, and typed terminal exits.
- **Multi-model support** — Gemini, Claude Sonnet 3.5, and GPT-4o selectable at startup.
- **Model selection menu** — Choose the active provider at `orbit wakeup` startup.
- **Automatic Gemini fallback** — Missing provider API keys fall back to Gemini with a warning.
- **Iterative Agentic mode** — Give the agent a goal. It creates a plan, works through each step, observes the result, and adjusts before continuing. The loop runs up to 10 steps automatically.
- **Conversation history** — Every session is saved to the database and can be resumed at any time. Your context is never lost.
- **Conversation deletion** — Remove old or unwanted sessions cleanly from the history menu.
- **Project context awareness** — Before acting, Orbital scans your project directory, reads `package.json`, detects your framework, and injects that context into the agent's working memory.
- **Global CLI** — Install once with `npm install -g .` and run `orbit` from any directory on your machine.
- **Output directory control** — When generating files, Orbital asks you where to write them. Generated files always land where you tell them to — never mixed into the Orbital source code.
- **21 registered developer tools** — Covering filesystem operations, shell execution, Git commands, dependency management, and directory operations.
- **Persistent loop** — The CLI stays open and returns you to the main menu after each session. You choose when to exit.
- **Back navigation** — Every submenu has a back option so you are never stuck.

---

## Prerequisites

Before you start, make sure you have the following installed and ready:

- **Node.js 18 or higher** — [nodejs.org](https://nodejs.org)
- **PostgreSQL database** — Install locally, or use a free hosted database at [neon.tech](https://neon.tech) (no local install required)
- **GitHub account** — Used for OAuth login
- **Google Gemini API key** — Free tier available at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- **Git** — Must be installed and available in your terminal

---

## How to run locally

Follow these steps in order. Each step builds on the previous one.

### Step 1 — Clone the repository

```bash
git clone https://github.com/Sahil01010011/orbit-alpha
cd orbit-alpha
```

### Step 2 — Install server dependencies

```bash
cd server
npm install
cd ..
```

This downloads all the packages the backend needs. It may take a minute.

### Step 3 — Install client dependencies

The client handles the GitHub OAuth login flow. It must be running alongside the server.

```bash
cd client
npm install
cd ..
```

### Step 4 — Configure environment variables

Environment variables are settings the app reads at startup — database addresses, API keys, and secrets. They live in a `.env` file that you create locally and never commit to Git.

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in every value:

```
# The port number the Express backend listens on.
# Leave as 3000 unless something else is already using that port.
PORT=3000

# Your PostgreSQL connection string.
# Get a free database at https://neon.tech — no local install needed.
# Format: postgresql://USER:PASSWORD@HOST/DATABASE
DATABASE_URL="postgresql://user:password@host/dbname"

# A long random secret used to sign authentication tokens.
# Keep this value private — treat it like a password.
# Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
BETTER_AUTH_SECRET="replace-this-with-a-long-random-string"

# The full URL where your backend server is running.
# Use http://localhost:3000 for local development.
BETTER_AUTH_URL="http://localhost:3000"

# Your GitHub OAuth App credentials.
# Create an OAuth App at https://github.com/settings/developers
#   Homepage URL: http://localhost:3000
#   Authorization callback URL: http://localhost:3000/api/auth/callback/github
GITHUB_CLIENT_ID="your-github-oauth-app-client-id"
GITHUB_CLIENT_SECRET="your-github-oauth-app-client-secret"

# Your Google Gemini API key.
# Get a free key at https://aistudio.google.com
GOOGLE_GENERATIVE_AI_API_KEY="your-google-gemini-api-key"

# Your Anthropic API key (Claude Sonnet 3.5).
ANTHROPIC_API_KEY="your-anthropic-api-key"

# Your OpenAI API key (GPT-4o).
OPENAI_API_KEY="your-openai-api-key"

# (Optional) Select the model provider: gemini, claude, openai.
# Leave blank to use the default: gemini
ORBITAL_MODEL_PROVIDER=""

# (Optional) The Gemini model to use.
# Leave blank to use the default: gemini-2.5-flash
ORBITAI_MODEL=""
```

### Step 5 — Set up the database

This creates the tables Orbital needs to store users, conversations, and messages.

```bash
cd server
npx prisma db push
npx prisma generate
cd ..
```

### Step 6 — Start the server

```bash
cd server
npm run dev
```

Keep this terminal open for the initial GitHub OAuth login. After you authenticate once, the CLI can run without the server.

### Step 7 — Install the CLI globally

Open a **new terminal window** and navigate to the `orbit-alpha` root directory:

```bash
cd path/to/orbit-alpha
npm install -g .
```

This makes the `orbit` command available everywhere on your machine.

### Step 8 — Run from anywhere

```bash
orbit wakeup
```

You should see the Orbital welcome screen. You are ready to go.

---

## Usage Guide

### Starting the CLI

```bash
orbit wakeup
```

You will see a menu like this:

```
◆  What would you like to do?
│  ○ Chat mode
│  ○ Tool Calling mode
│  ○ Agentic mode
│  ○ View history
│  ○ Exit
└
```

Use the arrow keys to select a mode and press Enter.

---

### Chat mode

Select **Chat mode** to have a back-and-forth conversation with the AI. The AI knows your project context from the start.

```
You: What is the difference between async/await and promises?

Orbital: Promises are objects that represent the eventual result of an
asynchronous operation. async/await is syntax built on top of Promises
that makes asynchronous code look and behave more like synchronous code...
```

The conversation continues until you type `exit` or select **Back** to return to the main menu.

---

### Tool Calling mode

Select **Tool Calling mode** to tell the AI to use a specific developer tool. This is useful when you want a precise, predictable action rather than a full conversation.

```
You: List all JavaScript files in the src directory

Orbital: [calling list_directory_contents]
→ src/index.js
→ src/routes/users.js
→ src/routes/posts.js
→ src/middleware/auth.js
```

---

### Agentic mode

Select **Agentic mode** and give the agent a goal. It will create a plan, work through each step, and report back.

```
◆  Describe your goal:
│  Build a simple Express REST API with a /users endpoint

◆  Where should output be created? (press Enter for current directory)
│  ~/projects/my-api

◆  Planning...
│  Step 1: Create project structure
│  Step 2: Initialize package.json
│  Step 3: Install express
│  Step 4: Create server.js with /users endpoint
│  Step 5: Add README

◆  Executing step 1...
◆  Executing step 2...
...
◆  Done. Files written to ~/projects/my-api
```

The agent runs up to 10 steps automatically. Generated files are written to the directory you specify — never into the Orbital source folder.

---

### History — view, resume, delete

Select **View history** from the main menu to see all your past conversations.

```
◆  Select a conversation to resume (or go back)
│  ○ Build a REST API  (chat · 2 days ago)
│  ○ Explain React hooks  (chat · 5 days ago)
│  ○ [Back]
└
```

Select any conversation to resume it. The AI remembers everything that was said. To delete a conversation, select it and choose **Delete** from the options.

You can also open history directly from the terminal:

```bash
orbit history
```

---

### Navigation

- Every screen has a **Back** option that returns you to the main menu.
- The CLI stays open after each session — you choose when to exit.
- Select **Exit** from the main menu or press `Ctrl+C` at any time to quit.

---

### Other commands

```bash
# Authenticate with your GitHub account
orbit login

# See which account is logged in
orbit whoami

# Log out
orbit logout

# Start with the iterative reasoning loop (plan → act → observe → reflect)
orbit wakeup --iterative
```

---

## Architecture

- `server/src/cli/agent/` — Agent loop hardening modules (terminal reason, circuit breaker, context compressor, orphan guard).
- `server/src/cli/ai/providers/` — Provider implementations for Gemini, Claude Sonnet 3.5, and GPT-4o.
- `server/src/cli/ai/provider-factory.js` — Single entry point for model access and provider selection.

---

## Troubleshooting

### `orbit` command not found

**Symptom:** Running `orbit wakeup` shows "command not found".

**Fix:** Reinstall the global CLI from the `orbit-alpha` root directory:

```bash
npm install -g .
```

---

### `injecting env (0)` — credentials not loading

**Symptom:** The CLI prints `injecting env (0)` and fails to authenticate or connect.

**Fix:** Orbital is not finding your `.env` file. Make sure `.env` exists in the `server/` directory (not the project root) and contains all required values. The file must be at `server/.env`.

---

### Database connection error

**Symptom:** The server crashes on startup with a Prisma or database connection error.

**Fix:** Double-check your `DATABASE_URL` in `.env`. If you are using Neon, make sure you copied the full connection string including the password. If you are using a local PostgreSQL instance, verify it is running with `pg_ctl status`.

---

### Gemini rate limit errors

**Symptom:** The AI returns an error about quota or rate limits during an agentic session.

**Fix:** The free tier of the Google Gemini API allows 5 requests per minute. The agentic loop makes multiple requests per step, so longer tasks will hit this limit. Wait 60 seconds and try again, or upgrade to a paid Gemini tier at [aistudio.google.com](https://aistudio.google.com).

---

### `npm install -g` fails with `EEXIST`

**Symptom:** Global install fails because binary files from a previous install are stuck.

**Fix:** Manually delete the stuck files from your npm global bin directory. On Windows, delete these files from `%AppData%\Roaming\npm`:

```
orbit.cmd
orbit.ps1
orbit
```

Then run `npm install -g .` again.

---

### Port already in use

**Symptom:** `Error: listen EADDRINUSE :::3000`

**Fix:** Change `PORT=3000` in your `.env` to an unused port number (for example `PORT=3001`). Also update `BETTER_AUTH_URL` to match the new port.

---

### `npm install -g` permission error on Mac/Linux

**Symptom:** `EACCES: permission denied` when running `npm install -g .`

**Fix (recommended):** Use [nvm](https://github.com/nvm-sh/nvm) to manage Node.js. When Node is installed via nvm, global installs work without elevated permissions.

**Fix (alternative):**

```bash
sudo npm install -g .
```

---

## What is broken or incomplete

- **Gemini free tier rate limits** — The free Gemini API tier allows 5 requests per minute. The agentic loop makes multiple requests per step, which causes rate limit errors on tasks with more than a few steps. Workaround: use short, focused goals, or upgrade to a paid Gemini tier.
- **Task state persistence** — `AgentTask` records are written to the database but the resume flow relies primarily on conversation message history. Full task state persistence is partially implemented.

---

## Remaining sessions plan

- [x] Session 8 — Tool Execution Fix
- [x] Sessions A–D — Agent Loop Hardening
- [x] Phase 1 — Provider Abstraction
- [x] Phase 2 — Multi-Model Support
- [ ] Session 9 — Web Search Tool
- [ ] Session 10 — Multi-Language Runtime Support
- [ ] Session 12 — Test Suite
- [ ] Final — Test suite

---

## Roadmap

- Web search integration in chat mode
- Multi-language support — Python, Rust, Go
- Model abstraction layer — switch between Gemini, OpenAI, Groq
- Rate limit handling with automatic retry and provider fallback
- Full task state persistence and resume
- Test suite

---

## Contributing

Contributions are welcome. Here is how to get started:

1. Fork the repository on GitHub.
2. Create a new branch: `git checkout -b my-feature`
3. Make your changes and test them locally.
4. Commit with a clear message: `git commit -m "Add my feature"`
5. Push to your fork: `git push origin my-feature`
6. Open a Pull Request on GitHub describing what you changed and why.

Please keep pull requests focused on a single change. If you are fixing a bug and adding a feature, open two separate PRs.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

# Orbital CLI

> An autonomous AI developer agent that lives in your terminal

---

## What is Orbital?

Orbital CLI is a tool that lets you have a conversation with an AI directly inside your terminal. You can ask it questions, have it write code for you, or give it a big goal (like "build me a to-do app") and watch it plan and execute the work step by step.

It is designed for developers who want AI assistance without leaving the command line. You do not need to open a browser, copy-paste code snippets, or switch between tools. Orbital reads your existing project files so it understands what you are already working on, then generates or modifies code that fits right in.

Orbital exists because AI-assisted development should feel natural. Instead of a chat box on a website, you get an agent that lives where your code lives — in the terminal, alongside your editor and version control.

---

## Features

- **AI chat mode** — Have a multi-turn conversation with an AI. Ask questions, get explanations, request code snippets.
- **Conversation history and session resume** — Every conversation is saved. Pick up exactly where you left off.
- **Iterative agent reasoning loop** — Give the agent a goal and it will plan what to do, take action, observe the result, and reflect before continuing. (plan → act → observe → reflect)
- **Project context awareness** — Before acting, the agent reads your existing project files so it understands what you have already built.
- **Agentic code generation with output directory control** — Tell the agent to build something. Choose exactly which folder the generated files land in — never mixed up with the Orbital source code.
- **GitHub OAuth authentication** — Log in securely with your GitHub account. No passwords to manage.
- **Multi-tool support** — The agent can search the web, extract content from URLs, and execute code as part of solving your problem.
- **Global CLI installation** — Install once and run `orbit` from any folder on your machine.

---

## Prerequisites

Before you start, make sure you have the following:

| Requirement | Minimum version | Notes |
|---|---|---|
| **Node.js** | 18 or higher | [nodejs.org](https://nodejs.org) |
| **PostgreSQL** | any recent version | OR use a free hosted database at [neon.tech](https://neon.tech) — no local install needed |
| **GitHub account** | — | Used for OAuth login |
| **Google Gemini API key** | — | Free tier available at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

---

## Installation

Follow these steps in order. Each step builds on the previous one.

### Step 1 — Clone the repository

```bash
git clone https://github.com/Sahil01010011/orbit-alpha.git
```

### Step 2 — Navigate into the project folder

```bash
cd orbit-alpha
```

### Step 3 — Install dependencies

```bash
cd server && npm install && cd ..
```

This downloads all the packages the project needs. It may take a minute.

### Step 4 — Set up your environment variables

Environment variables are settings that the app reads at startup — things like your database address and API keys. They are stored in a file called `.env` that you create locally and never commit to Git.

Copy the example file to get started:

```bash
cp .env.example .env
```

Now open `.env` in any text editor and fill in the values. See the [Environment Variables](#environment-variables) section below for a plain-English explanation of each one.

### Step 5 — Run database migrations

This creates the tables in your database that Orbital needs to store conversations and users.

```bash
cd server && npx prisma migrate deploy && cd ..
```

### Step 6 — Start the backend server

The backend is an Express server that handles authentication and talks to the AI on behalf of the CLI.

```bash
cd server && npm run dev
```

Leave this terminal window open. The server needs to be running whenever you use the CLI.

### Step 7 — Install the CLI globally

Open a **new terminal window** (keep the server running in the first one), then run:

```bash
npm install -g .
```

This makes the `orbit` command available everywhere on your machine.

### Step 8 — Run Orbital

```bash
orbit wakeup
```

That's it! You should see the Orbital welcome screen.

---

## Environment Variables

Open your `.env` file and fill in each value:

| Variable | What it is | Where to get it |
|---|---|---|
| `PORT` | The port number the backend server listens on | Leave as `3000` unless something else is already using that port |
| `DATABASE_URL` | The connection string for your PostgreSQL database | Copy it from [neon.tech](https://neon.tech) after creating a free project, or use your local PostgreSQL URL |
| `BETTER_AUTH_SECRET` | A long random string used to sign authentication tokens — keep this private | Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BETTER_AUTH_URL` | The full URL where your backend server is running | `http://localhost:3000` when developing locally |
| `GITHUB_CLIENT_ID` | The Client ID from your GitHub OAuth App | Create one at [github.com/settings/developers](https://github.com/settings/developers) |
| `GITHUB_CLIENT_SECRET` | The Client Secret from your GitHub OAuth App | Same page as above — keep this private |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Your Google Gemini API key | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free tier is available |
| `ORBITAI_MODEL` | The Gemini model to use | Optional. Defaults to `gemini-2.5-flash` if you leave this blank |

---

## Usage Guide

### Starting the CLI

```bash
orbit wakeup
```

You will see a menu asking which mode you want:

```
? What would you like to do?
  Chat mode
  Agentic mode
  View history
```

### Chat mode

Select **Chat mode** to have a back-and-forth conversation with the AI.

```
You: What is the difference between async/await and promises?
Orbital: Great question! Promises are objects that represent...
```

Type your message and press Enter. Type `exit` to quit the chat.

### Viewing conversation history and resuming a session

Select **View history** from the main menu to see your past conversations. Choose one to resume it — the AI will remember everything that was said before.

You can also run:

```bash
orbit history
```

### Agentic mode — generate a project

Select **Agentic mode** to give the AI a larger goal. It will plan its approach, create files, and show you its reasoning at each step.

```
? Describe your goal: Build a simple REST API with two endpoints
```

### Selecting an output directory

When you enter agentic mode, Orbital asks where to write the generated files:

```
Where should the output be created? (press Enter for current directory)
```

- Press **Enter** to use the folder you are currently in.
- Type a path like `~/projects/my-api` to write files there.
- If the folder does not exist, Orbital will offer to create it.

Generated files are always written to the folder you choose — never mixed into the Orbital source code.

### Other commands

```bash
# Authenticate with GitHub
orbit login

# See who is logged in
orbit whoami

# Log out
orbit logout

# Use the iterative reasoning loop (plan → act → observe → reflect)
orbit wakeup --iterative
```

---

## Troubleshooting

### Database connection error

**Symptom:** The server crashes on startup with a message about the database.

**Fix:** Double-check your `DATABASE_URL` in `.env`. If you are using Neon, make sure you copied the full connection string including the password. If you are using a local PostgreSQL, make sure the server is running with `pg_ctl status`.

---

### Missing environment variable

**Symptom:** Error message like `GITHUB_CLIENT_ID is not set` or similar.

**Fix:** Open your `.env` file and make sure every variable listed in `.env.example` has a value. Do not leave any line blank.

---

### Port already in use

**Symptom:** `Error: listen EADDRINUSE :::3000`

**Fix:** Something else is already using port 3000. Either stop the other process, or change `PORT=3000` in your `.env` file to another number like `PORT=3001`. If you change the port, also update `BETTER_AUTH_URL` to match.

---

### npm install -g permission error (Mac/Linux)

**Symptom:** `EACCES: permission denied` when running `npm install -g .`

**Fix (recommended — use nvm):** If you installed Node.js with [nvm](https://github.com/nvm-sh/nvm), global installs work without sudo. Switch to an nvm-managed Node version.

**Fix (alternative — use sudo):**

```bash
sudo npm install -g .
```

---

### Gemini rate limit error

**Symptom:** The AI returns an error about quota or rate limits.

**Fix:** The free tier of the Google Gemini API has per-minute and per-day limits. Wait a minute and try again. If you hit the daily limit, consider upgrading your Google AI Studio plan or waiting until the limit resets at midnight Pacific Time.

---

## Contributing

Contributions are welcome! Here is how to get started:

1. Fork the repository on GitHub.
2. Create a new branch: `git checkout -b my-feature`
3. Make your changes and test them locally.
4. Commit with a clear message: `git commit -m "Add my feature"`
5. Push to your fork: `git push origin my-feature`
6. Open a Pull Request on GitHub describing what you changed and why.

Please keep pull requests focused on a single change. If you are fixing a bug and adding a feature, open two separate PRs.

---

## License

This project is licensed under the ISC License.

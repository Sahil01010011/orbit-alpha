# Orbital CLI

A CLI-based AI Agent for autonomous code generation and interactive AI-assisted development.

## Prerequisites

- Node.js 18 or higher
- npm
- A PostgreSQL database (used by the server)

## Global Installation (one-time setup)

Run the following from the **orbit-alpha** project root to register the `orbit` command globally:

```bash
# 1. Install server-side dependencies (only needs to be done once)
cd server && npm install && cd ..

# 2. Register the `orbit` binary globally
npm install -g .
```

After this, the `orbit` command is available from **any directory** on your system:

```bash
orbit wakeup
```

## Usage

```bash
# Authenticate
orbit login

# Start a new session (chat, tool-calling, or agentic mode)
orbit wakeup

# Use the iterative reasoning loop (goal → plan → act → reflect)
orbit wakeup --iterative

# View conversation history
orbit history

# Show currently logged-in user
orbit whoami

# Log out
orbit logout
```

### Agentic Mode — Output Directory

When you choose **Agentic Mode**, the CLI prompts:

```
Where should the output be created?
```

- The default is the **current working directory** where you ran `orbit wakeup`.
- Type an absolute or relative path to override.
- If the directory does not exist you will be offered to create it.
- All generated files are written to the directory you specify — never inside the orbit-alpha source folder.

## Development

```bash
# Run the Express backend (from server/)
cd server
npm run dev
```

## Configuration

Copy `.env.example` (if present) to `.env` in the project root and fill in the required values:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key |
| `BETTER_AUTH_SECRET` | Secret key for better-auth sessions |
| `BETTER_AUTH_URL` | Base URL of the running server |

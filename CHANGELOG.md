# Changelog

All notable changes to this project are documented here.
Each version corresponds to one development session.

---

## [v0.6.0] — Project Documentation

- Created `README.md` with full beginner-friendly setup and usage guide
- Created `.env.example` listing every required environment variable with plain-English comments
- Created `CHANGELOG.md` documenting all sessions from v0.1.0 onward
- Added troubleshooting section covering the most common setup failures
- Added contributing guide for new contributors

---

## [v0.5.0] — Global CLI Installation and Output Directory Control

- Registered the `orbit` binary so it can be installed globally with `npm install -g .`
- Added prompt in agentic mode asking where generated files should be written
- Made output directory default to the current working directory
- Added option to create the output directory if it does not exist
- Ensured generated files are always written outside the Orbital source folder

---

## [v0.4.0] — Agent System Prompt Overhaul

- Rewrote the AI system prompt to give the agent a clear professional identity
- Exported `ORBITAL_SYSTEM_PROMPT` from a dedicated config file (`agent.config.js`)
- Applied the system prompt consistently across chat mode, tool mode, and agentic mode
- Improved response quality and tone

---

## [v0.3.0] — Project Context Reader

- Added a context reader that scans the user's project directory before the agent acts
- Agent now reads existing source files so it understands what has already been built
- Context is injected into the agent's working memory at the start of each agentic session

---

## [v0.2.0] — Iterative Agent Reasoning Loop

- Implemented a multi-step reasoning loop: plan → act → observe → reflect
- Agent breaks large goals into steps and works through them one at a time
- Each step's result is fed back into the agent before it continues
- Added `orbit wakeup --iterative` flag to invoke this mode

---

## [v0.1.0] — Conversation History Retrieval

- Saved every conversation to the database with a unique session ID
- Added `orbit history` command to list past sessions
- Added ability to select a past session and resume the conversation
- AI receives the full message history when resuming so context is preserved

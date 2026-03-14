import { z } from "zod";
import { registerTool } from "./registry.js";
import { runCommand } from "./utils.js";

// Helper: run a git command in the output directory
async function git(args, outputDirectory) {
  const { stdout, stderr, exitCode } = await runCommand("git", args, outputDirectory);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ─── git_init ─────────────────────────────────────────────────────────────────

registerTool("git_init", {
  description: "Initialize a git repository in the agent output directory.",
  parameters: z.object({}),
  execute: async (_args, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const { stdout, stderr, exitCode } = await git(["init"], dir);
      if (exitCode !== 0) {
        return { success: false, error: stderr || "git init failed" };
      }
      return { success: true, result: stdout || stderr || "Initialized empty git repository" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

// ─── git_status ───────────────────────────────────────────────────────────────

registerTool("git_status", {
  description: "Return the current git repository status as text.",
  parameters: z.object({}),
  execute: async (_args, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const { stdout, stderr, exitCode } = await git(["status"], dir);
      if (exitCode !== 0) {
        return { success: false, error: stderr || "git status failed" };
      }
      return { success: true, result: stdout };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

// ─── git_add ──────────────────────────────────────────────────────────────────

registerTool("git_add", {
  description: "Stage files for the next commit. Use '.' to stage all changes.",
  parameters: z.object({
    path: z
      .string()
      .describe("File path or '.' to stage all files"),
  }),
  execute: async ({ path: filePath }, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const { stdout, stderr, exitCode } = await git(["add", filePath], dir);
      if (exitCode !== 0) {
        return { success: false, error: stderr || "git add failed" };
      }
      return { success: true, result: `Staged: ${filePath}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

// ─── git_commit ───────────────────────────────────────────────────────────────

registerTool("git_commit", {
  description: "Commit staged files with the provided message.",
  parameters: z.object({
    message: z.string().describe("Commit message"),
  }),
  execute: async ({ message }, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const { stdout, stderr, exitCode } = await git(["commit", "-m", message], dir);
      if (exitCode !== 0) {
        return { success: false, error: stderr || "git commit failed" };
      }
      return { success: true, result: stdout || "Commit created" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

// ─── git_diff ─────────────────────────────────────────────────────────────────

registerTool("git_diff", {
  description: "Return unstaged changes as a diff.",
  parameters: z.object({}),
  execute: async (_args, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const { stdout, stderr, exitCode } = await git(["diff"], dir);
      if (exitCode !== 0) {
        return { success: false, error: stderr || "git diff failed" };
      }
      return { success: true, result: stdout || "(no unstaged changes)" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

// ─── git_log ──────────────────────────────────────────────────────────────────

registerTool("git_log", {
  description: "Return the last 10 commits as formatted text.",
  parameters: z.object({}),
  execute: async (_args, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const { stdout, stderr, exitCode } = await git(
        ["log", "--oneline", "-10"],
        dir
      );
      if (exitCode !== 0) {
        return { success: false, error: stderr || "git log failed" };
      }
      return { success: true, result: stdout || "(no commits yet)" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

import { z } from "zod";
import { registerTool } from "./registry.js";
import { runCommand } from "./utils.js";

// Commands that must never be executed regardless of context
const BLOCKLIST = [
  "rm -rf /",
  "format c:",
  "del /f /s /q c:",
  "shutdown",
  "reboot",
  "mkfs",
];

const SHELL_TIMEOUT_MS = 30_000;

// ─── execute_shell ────────────────────────────────────────────────────────────

registerTool("execute_shell", {
  description:
    "Execute a shell command string. Returns stdout, stderr, and exit code. " +
    "The working directory defaults to the agent output directory. " +
    "Dangerous commands (rm -rf /, format c:, shutdown, reboot, mkfs, etc.) are blocked.",
  parameters: z.object({
    command: z.string().describe("The shell command string to execute"),
    working_directory: z
      .string()
      .optional()
      .describe(
        "Absolute path to use as the working directory. Defaults to the agent output directory."
      ),
  }),
  execute: async ({ command, working_directory }, context = {}) => {
    // ── Blocklist check ─────────────────────────────────────────────────────
    const lowerCmd = command.toLowerCase().trim();
    for (const blocked of BLOCKLIST) {
      if (lowerCmd.includes(blocked.toLowerCase())) {
        return {
          success: false,
          error: `Command blocked for safety reasons: contains "${blocked}"`,
        };
      }
    }

    // ── Working directory ───────────────────────────────────────────────────
    const cwd =
      working_directory ||
      context.outputDirectory ||
      process.cwd();

    // ── Execute ─────────────────────────────────────────────────────────────
    try {
      const { stdout, stderr, exitCode } = await runCommand(
        command,
        [],
        cwd,
        SHELL_TIMEOUT_MS,
        { shell: true }
      );
      return { success: true, stdout, stderr, exitCode };
    } catch (err) {
      if (err.message.includes("timed out")) {
        return {
          success: false,
          error: `Command timed out after ${SHELL_TIMEOUT_MS / 1000} seconds`,
        };
      }
      return { success: false, error: err.message };
    }
  },
});

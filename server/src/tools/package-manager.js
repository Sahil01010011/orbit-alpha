import { z } from "zod";
import { registerTool } from "./registry.js";

registerTool("run_python", {
  description:
    "Execute a Python script or command. Use for Python projects to run scripts, tests, or pip commands.",
  parameters: z.object({
    command: z.string().describe(
      "Python command to run e.g. 'python main.py' or " +
        "'pip install requests' or 'pytest tests/'"
    ),
    cwd: z.string().optional().describe("Working directory. Defaults to outputDirectory."),
  }),
  execute: async (args, context) => {
    const command = args?.command;
    const cwd = args?.cwd || context?.outputDirectory || process.cwd();
    if (!command) return { success: false, error: "command is required" };
    try {
      const { execSync } = await import("child_process");
      const output = execSync(command, {
        cwd,
        encoding: "utf8",
        timeout: 30000,
        stdio: "pipe",
      });
      return { success: true, result: output };
    } catch (err) {
      return {
        success: false,
        error: err.stderr || err.message,
      };
    }
  },
});

registerTool("run_cargo", {
  description: "Execute a Cargo command for Rust projects.",
  parameters: z.object({
    command: z.string().describe(
      "Cargo command e.g. 'cargo build' or 'cargo test' or " + "'cargo add serde'"
    ),
    cwd: z.string().optional(),
  }),
  execute: async (args, context) => {
    const command = args?.command;
    const cwd = args?.cwd || context?.outputDirectory || process.cwd();
    if (!command) return { success: false, error: "command is required" };
    try {
      const { execSync } = await import("child_process");
      const output = execSync(command, {
        cwd,
        encoding: "utf8",
        timeout: 60000,
        stdio: "pipe",
      });
      return { success: true, result: output };
    } catch (err) {
      return { success: false, error: err.stderr || err.message };
    }
  },
});

registerTool("run_go", {
  description: "Execute a Go command for Go projects.",
  parameters: z.object({
    command: z.string().describe(
      "Go command e.g. 'go build ./...' or 'go test ./...' or " +
        "'go get github.com/gin-gonic/gin'"
    ),
    cwd: z.string().optional(),
  }),
  execute: async (args, context) => {
    const command = args?.command;
    const cwd = args?.cwd || context?.outputDirectory || process.cwd();
    if (!command) return { success: false, error: "command is required" };
    try {
      const { execSync } = await import("child_process");
      const output = execSync(command, {
        cwd,
        encoding: "utf8",
        timeout: 60000,
        stdio: "pipe",
      });
      return { success: true, result: output };
    } catch (err) {
      return { success: false, error: err.stderr || err.message };
    }
  },
});

registerTool("run_ruby", {
  description: "Execute a Ruby or Gem command for Ruby projects.",
  parameters: z.object({
    command: z.string().describe(
      "Ruby command e.g. 'ruby main.rb' or 'gem install rails' " + "or 'bundle install'"
    ),
    cwd: z.string().optional(),
  }),
  execute: async (args, context) => {
    const command = args?.command;
    const cwd = args?.cwd || context?.outputDirectory || process.cwd();
    if (!command) return { success: false, error: "command is required" };
    try {
      const { execSync } = await import("child_process");
      const output = execSync(command, {
        cwd,
        encoding: "utf8",
        timeout: 30000,
        stdio: "pipe",
      });
      return { success: true, result: output };
    } catch (err) {
      return { success: false, error: err.stderr || err.message };
    }
  },
});

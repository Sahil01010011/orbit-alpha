import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { registerTool } from "./registry.js";
import { resolvePath } from "./utils.js";

function resolveWithContext(filePath, context) {
  const base = context?.outputDirectory || process.cwd();
  return path.isAbsolute(filePath) ? filePath : resolvePath(base, filePath);
}

// ─── read_file ────────────────────────────────────────────────────────────────

registerTool("read_file", {
  description: "Read and return the text content of a file. Accepts absolute or relative paths.",
  parameters: z.object({
    file_path: z.string().describe("Absolute or relative path to the file to read"),
  }),
  execute: async ({ file_path }, context) => {
    try {
      const resolved = resolveWithContext(file_path, context);
      const content = await fs.readFile(resolved, "utf-8");
      return { success: true, result: content };
    } catch (err) {
      return { success: false, error: `Failed to read file: ${err.message}` };
    }
  },
});

// ─── write_file ───────────────────────────────────────────────────────────────

registerTool("write_file", {
  description:
    "Write string content to a file. Accepts absolute or relative paths. " +
    "Parent directories are created automatically if they do not exist.",
  parameters: z.object({
    file_path: z.string().describe("Absolute or relative path to the file to write"),
    content: z.string().describe("Text content to write to the file"),
  }),
  execute: async ({ file_path, content }, context) => {
    try {
      const resolved = resolveWithContext(file_path, context);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, "utf-8");
      return { success: true, result: `File written successfully: ${resolved}` };
    } catch (err) {
      return { success: false, error: `Failed to write file: ${err.message}` };
    }
  },
});

// ─── delete_file ──────────────────────────────────────────────────────────────

registerTool("delete_file", {
  description: "Delete a file. Accepts absolute or relative paths.",
  parameters: z.object({
    file_path: z.string().describe("Absolute or relative path to the file to delete"),
  }),
  execute: async ({ file_path }, context) => {
    try {
      const resolved = resolveWithContext(file_path, context);
      await fs.unlink(resolved);
      return { success: true, result: `File deleted: ${resolved}` };
    } catch (err) {
      return { success: false, error: `Failed to delete file: ${err.message}` };
    }
  },
});

// ─── move_file ────────────────────────────────────────────────────────────────

registerTool("move_file", {
  description: "Move or rename a file. Accepts absolute or relative paths.",
  parameters: z.object({
    source_path: z.string().describe("Absolute or relative path to the source file"),
    destination_path: z.string().describe("Absolute or relative path to the destination"),
  }),
  execute: async ({ source_path, destination_path }, context) => {
    try {
      const resolvedSrc = resolveWithContext(source_path, context);
      const resolvedDst = resolveWithContext(destination_path, context);
      await fs.mkdir(path.dirname(resolvedDst), { recursive: true });
      await fs.rename(resolvedSrc, resolvedDst);
      return {
        success: true,
        result: `File moved from ${resolvedSrc} to ${resolvedDst}`,
      };
    } catch (err) {
      return { success: false, error: `Failed to move file: ${err.message}` };
    }
  },
});

// ─── search_files ─────────────────────────────────────────────────────────────

registerTool("search_files", {
  description:
    "Search within a directory for files matching a name pattern or containing a specific string. " +
    "Returns matching file paths. Accepts absolute or relative paths.",
  parameters: z.object({
    directory: z.string().describe("Absolute or relative path to the directory to search in"),
    name_pattern: z
      .string()
      .optional()
      .describe("Glob-style filename pattern to match (e.g. '*.js')"),
    content_search: z
      .string()
      .optional()
      .describe("String to search for inside file contents"),
  }),
  execute: async ({ directory, name_pattern, content_search }, context) => {
    try {
      const matches = [];
      const resolvedDir = resolveWithContext(directory, context);

      async function walk(dir) {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (_) {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!["node_modules", ".git", "dist", "build", "__pycache__"].includes(entry.name)) {
              await walk(fullPath);
            }
          } else {
            const nameMatches = name_pattern
              ? matchGlob(entry.name, name_pattern)
              : true;

            if (nameMatches) {
              if (content_search) {
                try {
                  const text = await fs.readFile(fullPath, "utf-8");
                  if (text.includes(content_search)) {
                    matches.push(fullPath);
                  }
                } catch (_) {
                  // skip unreadable files
                }
              } else {
                matches.push(fullPath);
              }
            }
          }
        }
      }

      await walk(resolvedDir);

      return {
        success: true,
        result: matches.length > 0 ? matches.join("\n") : "No files found",
      };
    } catch (err) {
      return { success: false, error: `Search failed: ${err.message}` };
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchGlob(filename, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(filename);
}
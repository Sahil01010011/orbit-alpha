import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { registerTool } from "./registry.js";

// ─── read_file ────────────────────────────────────────────────────────────────

registerTool("read_file", {
  description: "Read and return the text content of a file at a given absolute path.",
  parameters: z.object({
    file_path: z.string().describe("Absolute path to the file to read"),
  }),
  execute: async ({ file_path }) => {
    try {
      const content = await fs.readFile(file_path, "utf-8");
      return { success: true, result: content };
    } catch (err) {
      return { success: false, error: `Failed to read file: ${err.message}` };
    }
  },
});

// ─── write_file ───────────────────────────────────────────────────────────────

registerTool("write_file", {
  description:
    "Write string content to a file at a given absolute path. " +
    "Parent directories are created automatically if they do not exist.",
  parameters: z.object({
    file_path: z.string().describe("Absolute path to the file to write"),
    content: z.string().describe("Text content to write to the file"),
  }),
  execute: async ({ file_path, content }) => {
    try {
      await fs.mkdir(path.dirname(file_path), { recursive: true });
      await fs.writeFile(file_path, content, "utf-8");
      return { success: true, result: `File written successfully: ${file_path}` };
    } catch (err) {
      return { success: false, error: `Failed to write file: ${err.message}` };
    }
  },
});

// ─── delete_file ──────────────────────────────────────────────────────────────

registerTool("delete_file", {
  description: "Delete a file at a given absolute path.",
  parameters: z.object({
    file_path: z.string().describe("Absolute path to the file to delete"),
  }),
  execute: async ({ file_path }) => {
    try {
      await fs.unlink(file_path);
      return { success: true, result: `File deleted: ${file_path}` };
    } catch (err) {
      return { success: false, error: `Failed to delete file: ${err.message}` };
    }
  },
});

// ─── move_file ────────────────────────────────────────────────────────────────

registerTool("move_file", {
  description: "Move or rename a file from a source path to a destination path.",
  parameters: z.object({
    source_path: z.string().describe("Absolute path to the source file"),
    destination_path: z.string().describe("Absolute path to the destination"),
  }),
  execute: async ({ source_path, destination_path }) => {
    try {
      await fs.mkdir(path.dirname(destination_path), { recursive: true });
      await fs.rename(source_path, destination_path);
      return {
        success: true,
        result: `File moved from ${source_path} to ${destination_path}`,
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
    "Returns matching file paths.",
  parameters: z.object({
    directory: z.string().describe("Absolute path to the directory to search in"),
    name_pattern: z
      .string()
      .optional()
      .describe("Glob-style filename pattern to match (e.g. '*.js')"),
    content_search: z
      .string()
      .optional()
      .describe("String to search for inside file contents"),
  }),
  execute: async ({ directory, name_pattern, content_search }) => {
    try {
      const matches = [];

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
            if (!["node_modules", ".git", "dist", "build"].includes(entry.name)) {
              await walk(fullPath);
            }
          } else {
            // Name pattern match
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

      await walk(directory);

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

/**
 * Minimal glob pattern matcher (supports * and ? wildcards).
 * @param {string} filename
 * @param {string} pattern
 * @returns {boolean}
 */
function matchGlob(filename, pattern) {
  // Escape regex special chars except * and ?
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(filename);
}

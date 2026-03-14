import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { registerTool } from "./registry.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);
const TREE_MAX_DEPTH = 4;

// ─── create_directory ─────────────────────────────────────────────────────────

registerTool("create_directory", {
  description:
    "Create a directory at the given absolute path. " +
    "All necessary parent directories are created automatically.",
  parameters: z.object({
    dir_path: z.string().describe("Absolute path of the directory to create"),
  }),
  execute: async ({ dir_path }) => {
    try {
      await fs.mkdir(dir_path, { recursive: true });
      return { success: true, result: `Directory created: ${dir_path}` };
    } catch (err) {
      return { success: false, error: `Failed to create directory: ${err.message}` };
    }
  },
});

// ─── list_directory ───────────────────────────────────────────────────────────

registerTool("list_directory", {
  description:
    "List the contents of a directory. Returns each entry with name, type (file or directory), and size in bytes.",
  parameters: z.object({
    dir_path: z.string().describe("Absolute path of the directory to list"),
  }),
  execute: async ({ dir_path }) => {
    try {
      const entries = await fs.readdir(dir_path, { withFileTypes: true });

      const result = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(dir_path, entry.name);
          let size = 0;
          if (entry.isFile()) {
            try {
              const stat = await fs.stat(fullPath);
              size = stat.size;
            } catch (_) {}
          }
          return {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size,
          };
        })
      );

      return { success: true, result };
    } catch (err) {
      return { success: false, error: `Failed to list directory: ${err.message}` };
    }
  },
});

// ─── directory_tree ───────────────────────────────────────────────────────────

registerTool("directory_tree", {
  description:
    "Return a recursive tree of a directory up to 4 levels deep as a formatted string. " +
    "Skips node_modules, .git, dist, and build directories.",
  parameters: z.object({
    dir_path: z.string().describe("Absolute path of the root directory"),
  }),
  execute: async ({ dir_path }) => {
    try {
      const lines = [dir_path];
      await buildTree(dir_path, "", 0, lines);
      return { success: true, result: lines.join("\n") };
    } catch (err) {
      return { success: false, error: `Failed to build directory tree: ${err.message}` };
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildTree(dirPath, prefix, depth, lines) {
  if (depth >= TREE_MAX_DEPTH) return;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (_) {
    return;
  }

  // Sort: directories first, then files, both alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        lines.push(`${prefix}${connector}${entry.name}/ (skipped)`);
        continue;
      }
      lines.push(`${prefix}${connector}${entry.name}/`);
      await buildTree(
        path.join(dirPath, entry.name),
        prefix + childPrefix,
        depth + 1,
        lines
      );
    } else {
      lines.push(`${prefix}${connector}${entry.name}`);
    }
  }
}

import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { registerTool } from "./registry.js";
import { runCommand } from "./utils.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect the package manager in use by checking for lock files.
 * Returns 'yarn' | 'pnpm' | 'npm'.
 */
async function detectPM(outputDirectory) {
  const checks = [
    { file: "yarn.lock", pm: "yarn" },
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "package-lock.json", pm: "npm" },
  ];
  for (const { file, pm } of checks) {
    try {
      await fs.access(path.join(outputDirectory, file));
      return pm;
    } catch (_) {
      // file doesn't exist, try next
    }
  }
  return "npm"; // default
}

// ─── detect_package_manager ───────────────────────────────────────────────────

registerTool("detect_package_manager", {
  description:
    "Inspect the output directory for package-lock.json, yarn.lock, or pnpm-lock.yaml " +
    "and return which package manager is in use. Defaults to npm if none found.",
  parameters: z.object({}),
  execute: async (_args, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const pm = await detectPM(dir);
      return { success: true, result: pm };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

// ─── install_dependencies ─────────────────────────────────────────────────────

registerTool("install_dependencies", {
  description:
    "Run the correct install command for the detected package manager in the output directory.",
  parameters: z.object({}),
  execute: async (_args, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const pm = await detectPM(dir);

      const installVerbs = { npm: "install", yarn: "install", pnpm: "install" };
      const { stdout, stderr, exitCode } = await runCommand(pm, [installVerbs[pm]], dir, 120_000);

      if (exitCode !== 0) {
        return { success: false, error: stderr || `${pm} install failed` };
      }
      return { success: true, stdout, stderr, exitCode };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

// ─── add_dependency ───────────────────────────────────────────────────────────

registerTool("add_dependency", {
  description: "Add a specific package using the detected package manager.",
  parameters: z.object({
    package_name: z.string().describe("Package name (optionally with version, e.g. 'lodash@4')"),
    dev: z
      .boolean()
      .optional()
      .describe("Install as a dev dependency (default: false)"),
  }),
  execute: async ({ package_name, dev = false }, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const pm = await detectPM(dir);

      const addVerbs = { npm: "install", yarn: "add", pnpm: "add" };
      const devFlags = { npm: "--save-dev", yarn: "--dev", pnpm: "--save-dev" };

      const args = [addVerbs[pm], package_name, ...(dev ? [devFlags[pm]] : [])];
      const { stdout, stderr, exitCode } = await runCommand(pm, args, dir, 120_000);

      if (exitCode !== 0) {
        return { success: false, error: stderr || `${pm} add failed` };
      }
      return { success: true, stdout, stderr, exitCode };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

// ─── remove_dependency ────────────────────────────────────────────────────────

registerTool("remove_dependency", {
  description: "Remove a specific package using the detected package manager.",
  parameters: z.object({
    package_name: z.string().describe("Package name to remove"),
  }),
  execute: async ({ package_name }, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const pm = await detectPM(dir);

      const removeVerbs = { npm: "uninstall", yarn: "remove", pnpm: "remove" };

      const { stdout, stderr, exitCode } = await runCommand(
        pm,
        [removeVerbs[pm], package_name],
        dir,
        120_000
      );

      if (exitCode !== 0) {
        return { success: false, error: stderr || `${pm} remove failed` };
      }
      return { success: true, stdout, stderr, exitCode };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
});

// ─── read_package_json ────────────────────────────────────────────────────────

registerTool("read_package_json", {
  description: "Parse and return the contents of package.json from the output directory.",
  parameters: z.object({}),
  execute: async (_args, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const pkgPath = path.join(dir, "package.json");
      const raw = await fs.readFile(pkgPath, "utf-8");
      return { success: true, result: JSON.parse(raw) };
    } catch (err) {
      return { success: false, error: `Failed to read package.json: ${err.message}` };
    }
  },
});

// ─── update_package_json ─────────────────────────────────────────────────────

registerTool("update_package_json", {
  description:
    "Accept a partial object and merge it into the existing package.json, then write the result back to disk.",
  parameters: z.object({
    updates: z
      .record(z.unknown())
      .describe("Partial package.json fields to merge in (e.g. { scripts: { start: 'node index.js' } })"),
  }),
  execute: async ({ updates }, context = {}) => {
    try {
      const dir = context.outputDirectory || process.cwd();
      const pkgPath = path.join(dir, "package.json");

      let existing = {};
      try {
        const raw = await fs.readFile(pkgPath, "utf-8");
        existing = JSON.parse(raw);
      } catch (_) {
        // file may not exist yet; start fresh
      }

      const merged = deepMerge(existing, updates);
      await fs.writeFile(pkgPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");

      return { success: true, result: "package.json updated successfully" };
    } catch (err) {
      return { success: false, error: `Failed to update package.json: ${err.message}` };
    }
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deep-merge two plain objects. Arrays from `source` overwrite those in `target`.
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

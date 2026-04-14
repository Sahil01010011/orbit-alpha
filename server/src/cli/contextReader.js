import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Directories to skip during folder traversal */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".turbo",
  "out",
  ".cache",
]);

/** Common config files to detect */
const CONFIG_FILES_TO_CHECK = [
  ".env",
  ".env.local",
  ".env.example",
  "docker-compose.yml",
  "docker-compose.yaml",
  "prisma/schema.prisma",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  ".eslintrc.mjs",
  "tsconfig.json",
  ".prettierrc",
  ".prettierrc.json",
  "Dockerfile",
];

/** Framework detection: ordered by specificity (most specific first) */
const FRAMEWORK_PATTERNS = [
  { name: "Next.js", deps: ["next"] },
  { name: "NestJS", deps: ["@nestjs/core"] },
  { name: "Nuxt", deps: ["nuxt", "@nuxt/core"] },
  { name: "Svelte/SvelteKit", deps: ["svelte", "@sveltejs/kit"] },
  { name: "Angular", deps: ["@angular/core"] },
  { name: "Vue", deps: ["vue"] },
  { name: "React", deps: ["react"] },
  { name: "Fastify", deps: ["fastify"] },
  { name: "Express", deps: ["express"] },
  { name: "Hono", deps: ["hono"] },
  { name: "Koa", deps: ["koa"] },
];

/** Maximum number of dependencies to list in the prompt summary */
const MAX_DEPS_IN_PREVIEW = 12;

// ─── Folder traversal ─────────────────────────────────────────────────────────

/**
 * Recursively traverse a directory and return a tree object.
 * Hidden dot-directories (other than the ones checked explicitly) are skipped.
 * @param {string} dirPath - Absolute path to traverse
 * @param {number} depth   - Current recursion depth (starts at 0)
 * @param {number} maxDepth - Maximum depth to traverse
 * @returns {Promise<object|null>}
 */
async function traverseDir(dirPath, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return null;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const result = {};

    for (const entry of entries) {
      // Skip known heavy / non-project directories
      if (SKIP_DIRS.has(entry.name)) continue;
      // Skip hidden directories (e.g. .idea, .vscode) but not hidden files at root
      if (entry.isDirectory() && entry.name.startsWith(".")) continue;

      if (entry.isDirectory()) {
        if (depth < maxDepth) {
          const subtree = await traverseDir(
            join(dirPath, entry.name),
            depth + 1,
            maxDepth
          );
          result[entry.name + "/"] = subtree ?? {};
        } else {
          result[entry.name + "/"] = "...";
        }
      } else {
        result[entry.name] = "file";
      }
    }

    return result;
  } catch {
    return null;
  }
}

// ─── package.json parsing ─────────────────────────────────────────────────────

/**
 * Read and parse package.json from the given directory.
 * Returns null if not present or unreadable.
 * @param {string} dir
 * @returns {Promise<object|null>}
 */
async function readPackageJson(dir) {
  const pkgPath = join(dir, "package.json");
  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    return {
      name: pkg.name ?? null,
      version: pkg.version ?? null,
      description: pkg.description ?? null,
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
      scripts: pkg.scripts ?? {},
    };
  } catch {
    return null;
  }
}

// ─── Detection helpers ────────────────────────────────────────────────────────

/**
 * Detect the primary framework from package.json dependency lists.
 * @param {object|null} packageJson
 * @returns {string|null}
 */
function detectFramework(packageJson) {
  if (!packageJson) return null;

  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  for (const { name, deps } of FRAMEWORK_PATTERNS) {
    if (deps.some((dep) => dep in allDeps)) {
      return name;
    }
  }

  return null;
}

/**
 * Detect whether the project uses TypeScript or JavaScript.
 * Checks for tsconfig.json first, then scans folder structure for .ts/.tsx files.
 * @param {string} dir
 * @param {object|null} folderStructure
 * @returns {string}
 */
function detectLanguage(dir, folderStructure) {
  if (existsSync(join(dir, "tsconfig.json"))) {
    return "TypeScript";
  }

  function hasTsFiles(tree) {
    if (!tree || typeof tree !== "object") return false;
    for (const key of Object.keys(tree)) {
      if (key.endsWith(".ts") || key.endsWith(".tsx")) return true;
      if (typeof tree[key] === "object" && hasTsFiles(tree[key])) return true;
    }
    return false;
  }

  if (hasTsFiles(folderStructure)) {
    return "TypeScript";
  }

  return "JavaScript";
}

/**
 * Detect primary language/runtime and package manager from well-known project markers.
 * @param {string} dir
 * @param {object|null} folderStructure
 * @param {object|null} packageJson
 * @returns {{ language: string, packageManager: string|null }}
 */
function detectStack(dir, folderStructure, packageJson) {
  const hasFile = (name) => existsSync(join(dir, name));

  // Python
  const hasRequirements = hasFile("requirements.txt");
  const hasPyProject = hasFile("pyproject.toml");
  const hasSetupPy = hasFile("setup.py");
  const hasPipfile = hasFile("Pipfile");
  const hasPoetryLock = hasFile("poetry.lock");
  if (hasRequirements || hasPyProject || hasSetupPy || hasPipfile || hasPoetryLock) {
    let packageManager = null;
    if (hasRequirements) packageManager = "pip";
    else if (hasPoetryLock) packageManager = "poetry";
    else if (hasPipfile) packageManager = "pipenv";
    return { language: "python", packageManager };
  }

  // Rust
  if (hasFile("Cargo.toml")) {
    return { language: "rust", packageManager: "cargo" };
  }

  // Go
  if (hasFile("go.mod")) {
    return { language: "go", packageManager: "go mod" };
  }

  // Ruby
  if (hasFile("Gemfile")) {
    return { language: "ruby", packageManager: "gem" };
  }

  // Node.js / JS / TS
  const language = detectLanguage(dir, folderStructure);
  let packageManager = null;
  if (hasFile("yarn.lock")) packageManager = "yarn";
  else if (hasFile("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (hasFile("package-lock.json")) packageManager = "npm";
  else if (packageJson) packageManager = "npm";

  return { language, packageManager };
}

/**
 * Check which known config files are present in the working directory.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function detectConfigFiles(dir) {
  const found = [];
  for (const configFile of CONFIG_FILES_TO_CHECK) {
    if (existsSync(join(dir, configFile))) {
      found.push(configFile);
    }
  }
  return found;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read and return a structured context object for the given working directory.
 * This operation is read-only — it never writes to disk.
 *
 * @param {string} workingDirectory - Path to read context from (usually process.cwd())
 * @returns {Promise<{
 *   workingDirectory: string,
 *   folderStructure: object|null,
 *   packageJson: object|null,
 *   detectedFramework: string|null,
 *   detectedLanguage: string,
 *   detectedPackageManager: string|null,
 *   configFiles: string[]
 * }>}
 */
export async function readProjectContext(workingDirectory) {
  const resolvedDir = resolve(workingDirectory);

  const folderStructure = await traverseDir(resolvedDir, 0, 4);
  const packageJson = await readPackageJson(resolvedDir);
  const detectedFramework = detectFramework(packageJson);
  const stack = detectStack(resolvedDir, folderStructure, packageJson);
  const configFiles = await detectConfigFiles(resolvedDir);

  return {
    workingDirectory: resolvedDir,
    folderStructure,
    packageJson,
    detectedFramework,
    detectedLanguage: stack.language,
    detectedPackageManager: stack.packageManager,
    configFiles,
  };
}

/**
 * Format a project context object into a concise string suitable for injection
 * into an LLM system prompt.  Summarises — does not dump raw file contents.
 *
 * @param {object} context - Result of readProjectContext()
 * @returns {string}
 */
export function formatContextForPrompt(context) {
  const lines = [];

  lines.push("=== PROJECT CONTEXT ===");
  lines.push(`Working Directory: ${context.workingDirectory}`);
  lines.push(`Language: ${context.detectedLanguage}`);
  if (context.detectedPackageManager) {
    lines.push(`Package Manager: ${context.detectedPackageManager}`);
  }

  if (context.detectedFramework) {
    lines.push(`Framework: ${context.detectedFramework}`);
  }

  if (context.packageJson) {
    const { name, version, dependencies, devDependencies, scripts } =
      context.packageJson;

    if (name) lines.push(`Project Name: ${name}${version ? ` v${version}` : ""}`);

    const allDeps = [
      ...Object.keys(dependencies),
      ...Object.keys(devDependencies),
    ];
    if (allDeps.length > 0) {
      const preview = allDeps.slice(0, MAX_DEPS_IN_PREVIEW);
      lines.push(
        `Key Dependencies: ${preview.join(", ")}` +
          (allDeps.length > MAX_DEPS_IN_PREVIEW
            ? ` (+${allDeps.length - MAX_DEPS_IN_PREVIEW} more)`
            : "")
      );
    }

    const scriptNames = Object.keys(scripts);
    if (scriptNames.length > 0) {
      lines.push(`Available Scripts: ${scriptNames.join(", ")}`);
    }
  } else {
    lines.push(
      "⚠️  No package.json found — proceeding with minimal context"
    );
  }

  if (context.configFiles.length > 0) {
    lines.push(`Config Files: ${context.configFiles.join(", ")}`);
  }

  if (context.folderStructure) {
    const topLevel = Object.keys(context.folderStructure);
    if (topLevel.length > 0) {
      lines.push(`Top-level Structure: ${topLevel.join("  ")}`);
    }
  }

  lines.push("=== END CONTEXT ===");

  return lines.join("\n");
}

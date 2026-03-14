import { spawn } from "child_process";

/**
 * Run a shell command and return { stdout, stderr, exitCode }.
 * This is the shared primitive used by shell.js and git.js — no tool file
 * should import from another tool file; import this helper instead.
 *
 * @param {string} cmd - Executable name (or shell command string when options.shell is true)
 * @param {string[]} args - Arguments array (use [] when options.shell is true)
 * @param {string} cwd - Working directory
 * @param {number} [timeout=30000] - Timeout in milliseconds
 * @param {{ shell?: boolean }} [options] - Spawn options
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
export function runCommand(cmd, args, cwd, timeout = 30000, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: options.shell || false });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch (_) { /* ignore */ }
      }, 2000);
    }, timeout);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command timed out after ${timeout}ms`));
      } else {
        resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

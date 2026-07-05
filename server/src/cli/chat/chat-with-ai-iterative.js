import chalk from "chalk";
import { text, select, isCancel, cancel, intro, outro } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { appendFile } from "node:fs/promises";
// import { AIService } from "../ai/google-service.js";
import {
  getActiveProviderInfo,
  getProvider,
  sendMessageWithFallback,
} from "../ai/provider-factory.js";
import { ChatService } from "../../service/chat.service.js";
import { AgentTaskService } from "../../service/agentTask.service.js";
import { getStoredToken } from "../commands/auth/login.js";
import prisma from "../../lib/db.js";
import { z } from "zod";
import {
  readProjectContext,
  formatContextForPrompt,
} from "../contextReader.js";
import { ORBITAL_SYSTEM_PROMPT } from "../../config/agent.config.js";
import { getToolSchemas } from "../../tools/index.js";
import { TerminalReason } from "../agent/terminal-reason.js";
import { CIRCUIT_BREAKER, backoffDelay } from "../agent/circuit-breaker.js";
import { compressIfNeeded } from "../agent/context-compressor.js";
import { fillOrphanedToolResults } from "../agent/orphan-guard.js";
import { preparePayload } from "../ai/token-manager.js"; // ← token manager

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_PLAN_STEPS = 10; // upper bound on plan length
const MAX_TOTAL_EXECUTIONS = 25; // act-calls incl. retries (prevents infinite loops)
const MAX_RETRIES_PER_STEP = 2; // true retries: step runs up to 1 + this
const TOOL_RESULT_SUMMARY_MAX_LENGTH = 120;
const RECENT_RESULTS_FULL = 3; // keep last N step results verbatim
const ACTIVE_MODEL = process.env.ORBITAL_MODEL || "gemini-2.5-flash";

// ─── Marked terminal renderer ──────────────────────────────────────────────────

marked.use(
  markedTerminal({
    code: chalk.hex("#22d3ee"),
    blockquote: chalk.hex("#6b7280").italic,
    heading: chalk.hex("#a78bfa").bold,
    firstHeading: chalk.hex("#c084fc").bold,
    hr: chalk.hex("#374151"),
    listitem: chalk.hex("#f9fafb"),
    list: chalk.hex("#f9fafb"),
    paragraph: chalk.hex("#e2e8f0"),
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.hex("#22d3ee"),
    del: chalk.dim,
    link: chalk.hex("#38bdf8").underline,
    href: chalk.hex("#38bdf8").underline,
  }),
);

// ─── Services ─────────────────────────────────────────────────────────────────

// const aiService = getProvider();
const chatService = new ChatService();
const agentTaskService = new AgentTaskService();

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const PlanSchema = z.object({
  steps: z
    .array(z.string())
    .min(1)
    .max(MAX_PLAN_STEPS)
    .describe(
      "Ordered list of specific, concrete, executable steps to accomplish the goal",
    ),
  rationale: z
    .string()
    .describe(
      "Brief explanation of the overall approach and why these steps achieve the goal",
    ),
});

const ReflectionSchema = z.object({
  assessment: z
    .string()
    .describe(
      "Detailed assessment of what was accomplished in this step and whether it was successful",
    ),
  nextAction: z
    .enum(["proceed", "retry", "terminate"])
    .describe(
      "proceed = move to next step; retry = repeat this step (max 2 retries); terminate = goal fully accomplished OR unrecoverable error",
    ),
  reason: z
    .string()
    .describe("Explanation for why this next action was chosen"),
  finalOutput: z
    .string()
    .optional()
    .describe(
      'Assembled final answer for the user — required when nextAction is "terminate" with successful completion',
    ),
});

// ─── Loop state ───────────────────────────────────────────────────────────────

function createLoopState(
  goal,
  projectContext = null,
  taskId = null,
  resume = {},
  outputDirectory = null,
) {
  return {
    goal,
    projectContext,
    outputDirectory:
      outputDirectory || projectContext?.workingDirectory || process.cwd(),
    plan: resume.plan || [],
    rationale: resume.rationale || "",
    currentStep: resume.currentStep || 0,
    stepResults: resume.stepResults || [],
    retryCount: 0,
    // Never resume mid-act/mid-reflect; restart the turn cleanly. (Fix 6)
    status: resume.plan && resume.plan.length > 0 ? "acting" : "planning",
    finalOutput: null,
    taskId,
  };
}

// ─── Logging helpers (Fix 9: real append-only JSONL log) ───────────────────────

function logLoop(loopState, message) {
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      taskId: loopState?.taskId ?? null,
      step: loopState?.currentStep ?? null,
      status: loopState?.status ?? null,
      message,
    }) + "\n";
  // fire-and-forget; never block or crash the loop on logging
  appendFile(".orbit/agent.log", line).catch(() => {});
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getUserFromToken() {
  const token = await getStoredToken();
  if (!token?.access_token) {
    throw new Error("Not authenticated. Please run 'orbit login' first.");
  }
  const user = await prisma.user.findFirst({
    where: { sessions: { some: { token: token.access_token } } },
  });
  if (!user) {
    throw new Error("User not found. Please login again.");
  }
  return user;
}

// ─── Phase 1: Planning ────────────────────────────────────────────────────────

async function generatePlan(loopState) {
  const aiService = getProvider();
  const spinner = yoctoSpinner({
    text: "Generating execution plan...",
  }).start();

  try {
    const contextBlock = loopState.projectContext
      ? `\n${formatContextForPrompt(loopState.projectContext)}\n`
      : "";

    const plan = await aiService.generateStructured(
      PlanSchema,
      `You are an AI reasoning agent. Break down the following goal into specific, concrete, executable steps.
${contextBlock}
Goal: ${loopState.goal}

Requirements:
- Generate between 2 and ${MAX_PLAN_STEPS} steps
- Each step must be specific and actionable on its own
- Steps should build on each other logically
- Focus entirely on achieving the stated goal
- Take the project context above into account when planning — use the correct language, framework, and existing structure

Provide a clear rationale explaining your overall approach.`,
      ORBITAL_SYSTEM_PROMPT,
    );

    loopState.plan = plan.steps;
    loopState.rationale = plan.rationale;
    loopState.status = "acting";

    spinner.success(`Plan generated: ${plan.steps.length} steps`);
    logLoop(loopState, `Plan created with ${plan.steps.length} steps`);
    return plan;
  } catch (error) {
    spinner.error("Planning failed");
    logLoop(loopState, `Planning error: ${error.message}`);
    throw error;
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function displayPlan(loopState) {
  console.log("");
  console.log(
    chalk.hex("#22d3ee").bold("orbit") +
      chalk.hex("#374151")(" · ") +
      chalk.hex("#a78bfa")("plan generated"),
  );
  console.log("");
  console.log(
    chalk.hex("#6b7280")("goal  ") + chalk.hex("#f9fafb")(loopState.goal),
  );
  console.log(
    chalk.hex("#6b7280")("why   ") + chalk.hex("#6b7280")(loopState.rationale),
  );
  console.log("");
  console.log(chalk.hex("#374151")("── steps " + "─".repeat(51)));
  loopState.plan.forEach((step, i) => {
    console.log(
      chalk.hex("#374151")(`  ${String(i + 1).padStart(2, " ")}  `) +
        chalk.hex("#e2e8f0")(step),
    );
  });
  console.log(chalk.hex("#374151")("─".repeat(60)));
  console.log("");
}

function displayStepHeader(loopState) {
  const stepNum = loopState.currentStep + 1;
  const total = loopState.plan.length;
  const filled = "█".repeat(stepNum);
  const empty = "░".repeat(Math.max(0, total - stepNum));
  console.log("");
  console.log(
    chalk.hex("#facc15")(filled) +
      chalk.hex("#374151")(empty) +
      chalk.hex("#6b7280")(`  ${stepNum}/${total}  `) +
      chalk.hex("#e2e8f0")(
        loopState.plan[loopState.currentStep].slice(0, 60) +
          (loopState.plan[loopState.currentStep].length > 60 ? "…" : ""),
      ),
  );
}

// Render the token-budget stats as a dim, non-intrusive one-liner. (token-manager UI)
function displayTokenStats(stats) {
  const pct = stats.utilizationPercent ?? 0;
  if (pct < 70 && !stats.overBudget) return;
  const pctColor = pct >= 90 ? chalk.hex("#f87171") : chalk.hex("#facc15");
  console.log(
    chalk.hex("#374151")("  ⊙ ") +
      pctColor(`${pct}% context used`) +
      (stats.overBudget ? chalk.hex("#f87171")("  OVER BUDGET") : ""),
  );
}

function displayReflection(reflection, stepNum) {
  const actionColor =
    reflection.nextAction === "proceed"
      ? chalk.hex("#4ade80")
      : reflection.nextAction === "retry"
        ? chalk.hex("#facc15")
        : chalk.hex("#c084fc");
  const actionLabel =
    reflection.nextAction === "proceed"
      ? "↓ proceed"
      : reflection.nextAction === "retry"
        ? "↺ retry"
        : "✓ done";
  console.log(chalk.hex("#374151")("  ") + actionColor(actionLabel));
}
function displayFinalOutput(loopState) {
  const content = loopState.finalOutput || "No output available.";
  const isComplete = loopState.status === "complete";
  console.log("");
  console.log(
    chalk.hex("#22d3ee").bold("orbit") +
      chalk.hex("#374151")(" · ") +
      (isComplete
        ? chalk.hex("#4ade80")("complete")
        : chalk.hex("#f87171")("failed")),
  );
  console.log("");
  const rendered = marked.parse(content).trim();
  rendered.split("\n").forEach((line) => {
    console.log(chalk.hex("#374151")("│ ") + line);
  });
  console.log("");
}

function displayContextSummary(context) {
  console.log("");
  console.log(chalk.hex("#374151")("── project context " + "─".repeat(41)));
  console.log(
    chalk.hex("#6b7280")("  dir        ") +
      chalk.hex("#f9fafb")(context.workingDirectory),
  );
  console.log(
    chalk.hex("#6b7280")("  language   ") +
      chalk.hex("#22d3ee")(context.detectedLanguage),
  );
  if (context.detectedFramework) {
    console.log(
      chalk.hex("#6b7280")("  framework  ") +
        chalk.hex("#22d3ee")(context.detectedFramework),
    );
  }
  if (context.packageJson?.name) {
    console.log(
      chalk.hex("#6b7280")("  project    ") +
        chalk.hex("#f9fafb")(context.packageJson.name) +
        (context.packageJson.version
          ? chalk.hex("#6b7280")(" v" + context.packageJson.version)
          : ""),
    );
  }
  if (context.configFiles.length > 0) {
    console.log(
      chalk.hex("#6b7280")("  configs    ") +
        chalk.hex("#6b7280")(context.configFiles.join(", ")),
    );
  }
  console.log("");
}

// ─── Phase 2: Act ─────────────────────────────────────────────────────────────

export function formatToolResult(raw) {
  if (raw === undefined || raw === null) return "(no result)";

  const CAP = 8_000; // hard ceiling so a tool dump can't blow the context (Fix 8)
  const clamp = (s) =>
    s.length > CAP ? s.slice(0, CAP) + "\n…[truncated]" : s;

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      const inner = parsed?.result ?? parsed?.error ?? parsed;
      return clamp(
        typeof inner === "string" ? inner : JSON.stringify(inner, null, 2),
      );
    } catch {
      return clamp(raw); // not JSON, return as-is
    }
  }
  if (typeof raw === "object") {
    const inner = raw?.result ?? raw?.error ?? raw;
    return clamp(
      typeof inner === "string" ? inner : JSON.stringify(inner, null, 2),
    );
  }
  return clamp(String(raw));
}

// Windowed + summarized memory (Fix 4): older results collapse to one line.
function buildPreviousContext(stepResults) {
  if (stepResults.length === 0) return "";
  const cut = Math.max(0, stepResults.length - RECENT_RESULTS_FULL);
  const summarized = stepResults
    .slice(0, cut)
    .map(
      (r, i) =>
        `Step ${i + 1} (summary): ${String(r).slice(0, TOOL_RESULT_SUMMARY_MAX_LENGTH).replace(/\s+/g, " ")}...`,
    );
  const full = stepResults
    .slice(cut)
    .map((r, i) => `Step ${cut + i + 1} result:\n${r}`);
  return `\nPrevious step results:\n${[...summarized, ...full].join("\n\n")}\n`;
}

async function executeStep(loopState, rateLimitState) {
  const stepIndex = loopState.currentStep;
  const step = loopState.plan[stepIndex];
  const stepNum = stepIndex + 1;
  const total = loopState.plan.length;

  loopState.status = "acting";
  displayStepHeader(loopState);

  const previousContext = buildPreviousContext(loopState.stepResults);

  const retryNote =
    loopState.retryCount > 0
      ? `\nNote: This is retry attempt ${loopState.retryCount} for this step. The previous attempt was deemed insufficient — please improve your response.\n`
      : "";

  const contextBlock = loopState.projectContext
    ? `\n${formatContextForPrompt(loopState.projectContext)}\n`
    : "";

  let messages = [
    {
      role: "user",
      content: `You are an AI reasoning agent executing a step as part of a larger plan.\n${contextBlock}
Goal: ${loopState.goal}

Full plan:
${loopState.plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}${previousContext}${retryNote}
Now execute step ${stepNum}/${total}: ${step}

Provide a thorough, complete, and specific result for this step. Be precise and actionable.`,
    },
  ];

  const spinner = yoctoSpinner({
    text: `Executing step ${stepNum}/${total}...`,
    color: "yellow",
  }).start();

  let stepResult = "";
  let isFirstChunk = true;
  let spinnerStopped = false;

  const stopSpinnerOnce = () => {
    if (!spinnerStopped) {
      spinner.stop();
      spinnerStopped = true;
    }
  };

  const toolSchemas = getToolSchemas({
    outputDirectory: loopState.outputDirectory,
  });
  const tools = Object.keys(toolSchemas).length > 0 ? toolSchemas : undefined;

  while (true) {
    messages = await compressIfNeeded(messages, getProvider());

    // ── Token management: final budget gate before dispatch ────────────────
    // Trims/truncates messages to fit the active model's context window.
    // ragChunks is empty until RAG is implemented; the returned chunks are
    // reserved for injection once retrieval is wired in.
    const {
      messages: trimmedMessages,
      ragChunks: trimmedRag, // eslint-disable-line no-unused-vars
      stats,
    } = preparePayload(messages, ORBITAL_SYSTEM_PROMPT, ACTIVE_MODEL, []);

    messages = trimmedMessages;

    if (!spinnerStopped) {
      // Show budget usage before the model starts streaming.
      stopSpinnerOnce();
      displayTokenStats(stats);
    } else {
      displayTokenStats(stats);
    }
    logLoop(
      loopState,
      `token stats: ${stats.totalEstimatedTokens}/${stats.budget} (${stats.utilizationPercent}%) dropped=${stats.messagesDropped} truncated=${stats.toolResultsTruncated} overBudget=${stats.overBudget}`,
    );

    try {
      const result = await sendMessageWithFallback(
        messages,
        (chunk) => {
          if (isFirstChunk) {
            stopSpinnerOnce();
            console.log(
              chalk.hex("#374151")(
                "── step " + stepNum + " output " + "─".repeat(46),
              ),
            );
            isFirstChunk = false;
          }
          stepResult += chunk;
          process.stdout.write(chalk.hex("#e2e8f0")(chunk));
        },
        {
          system: ORBITAL_SYSTEM_PROMPT,
          ...(tools && { tools }),
          onToolCall: (toolCall, toolResult) => {
            stopSpinnerOnce();
            const status =
              toolResult !== undefined
                ? chalk.hex("#4ade80")("✓")
                : chalk.hex("#374151")("▸");
            console.log(
              chalk.hex("#374151")("  ") +
                status +
                " " +
                chalk.hex("#22d3ee")(toolCall.toolName),
            );
          },
        },
        null,
      );

      if (rateLimitState) {
        rateLimitState.count = 0;
      }

      stopSpinnerOnce();
      console.log("\n" + chalk.hex("#374151")("─".repeat(60)) + "\n");

      let content = result.content || stepResult;

      if (!content && result.toolResults && result.toolResults.length > 0) {
        content = result.toolResults
          .map((tr) => `Tool ${tr.toolName}: ${formatToolResult(tr.result)}`)
          .join("\n");
      }

      logLoop(loopState, `Step ${stepNum} executed (${content.length} chars)`);
      return content;
    } catch (error) {
      messages = fillOrphanedToolResults(messages);

      const errorMessage = String(error?.message ?? "");
      const isRateLimited =
        error?.status === 429 ||
        errorMessage.includes("429") ||
        errorMessage.toLowerCase().includes("rate limit");

      if (isRateLimited && rateLimitState) {
        if (rateLimitState.count < CIRCUIT_BREAKER.MAX_RETRY_ATTEMPTS) {
          rateLimitState.count += 1;
          const delay = backoffDelay(rateLimitState.count);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        stopSpinnerOnce();
        console.log(chalk.yellow(TerminalReason.RATE_LIMITED));
        return null;
      }

      spinner.error(`Step ${stepNum} execution failed`);
      logLoop(loopState, `Step ${stepNum} error: ${error.message}`);
      throw error;
    }
  }
}

// ─── Phase 3: Reflect ─────────────────────────────────────────────────────────

async function reflectOnStep(loopState, stepResult) {
  const aiService = getProvider();
  const stepIndex = loopState.currentStep;
  const step = loopState.plan[stepIndex];
  const stepNum = stepIndex + 1;
  const total = loopState.plan.length;
  const isLastStep = stepIndex >= total - 1;

  loopState.status = "reflecting";

  // ── Heuristic short-circuit (Fix 5): skip the LLM when unambiguous ─────────
  const looksFailed =
    !stepResult ||
    stepResult.trim().length < 20 ||
    /\b(error|failed|exception|cannot|unable)\b/i.test(
      stepResult.slice(0, 200),
    );

  if (!isLastStep && !looksFailed && loopState.retryCount === 0) {
    return {
      assessment: "Step produced substantive output with no error markers.",
      nextAction: "proceed",
      reason: "Heuristic auto-proceed (non-empty, no error signals).",
    };
  }

  const spinner = yoctoSpinner({
    text: `Reflecting on step ${stepNum}/${total}...`,
    color: "cyan",
  }).start();

  try {
    // Token-budget the reflection input so a huge step result can't overflow.
    const boundedResult =
      stepResult.length > 6000
        ? stepResult.slice(0, 6000) + "\n…[truncated for reflection]"
        : stepResult;

    const reflection = await aiService.generateStructured(
      ReflectionSchema,
      `You are an AI reasoning agent reviewing the result of an execution step.

Goal: ${loopState.goal}

Full plan:
${loopState.plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Current step (${stepNum}/${total}): ${step}

Step result:
${boundedResult}

Steps completed so far: ${stepNum} of ${total}
${
  isLastStep
    ? "NOTE: This was the LAST step in the plan."
    : `Next step would be: ${loopState.plan[stepIndex + 1]}`
}

Evaluate the step result and decide:
- "proceed": Step was successful, move to the next step.
- "retry": Step result was incomplete or unsatisfactory (max ${MAX_RETRIES_PER_STEP} retries allowed per step).
- "terminate": The goal is fully accomplished — include the assembled final answer in finalOutput. OR there is an unrecoverable error.
${
  isLastStep
    ? 'Since this was the LAST planned step, use "terminate" and include the complete finalOutput assembling all step results.'
    : ""
}

Provide a detailed assessment, a clear decision, and your reasoning.`,
      ORBITAL_SYSTEM_PROMPT,
    );

    spinner.success(`Reflection: ${reflection.nextAction}`);
    logLoop(
      loopState,
      `Reflection decision: ${reflection.nextAction} — ${reflection.reason}`,
    );
    return reflection;
  } catch (error) {
    spinner.error("Reflection failed");
    logLoop(loopState, `Reflection error: ${error.message}`);

    const fallbackAction = isLastStep ? "terminate" : "proceed";
    return {
      assessment: "Reflection could not be completed due to an error.",
      nextAction: fallbackAction,
      reason: "Reflection error; using default fallback action.",
      finalOutput: isLastStep ? stepResult : undefined,
    };
  }
}

// ─── Main reasoning loop ──────────────────────────────────────────────────────

async function runReasoningLoop(loopState, conversationId) {
  // ── Phase 1: Planning ─────────────────────────────────────────────────────
  if (!Array.isArray(loopState.plan) || loopState.plan.length === 0) {
    // Fix 6
    logLoop(loopState, "Starting planning phase");
    await generatePlan(loopState);
    displayPlan(loopState);

    if (loopState.taskId) {
      await agentTaskService
        .updateTaskStep(
          loopState.taskId,
          loopState.currentStep,
          loopState.stepResults,
          "acting",
          loopState.plan,
        )
        .catch((e) =>
          logLoop(loopState, `WARN persist plan failed: ${e?.message ?? e}`),
        );
    }

    await chatService.addMessage(
      conversationId,
      "assistant",
      `[Plan Generated]\nGoal: ${loopState.goal}\nRationale: ${loopState.rationale}\n\nSteps:\n${loopState.plan
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n")}`,
    );
  } else {
    logLoop(
      loopState,
      `Resuming from step ${loopState.currentStep + 1}/${loopState.plan.length}`,
    );
    displayPlan(loopState);
  }

  // ── Phase 2: Act → Observe → Reflect loop ─────────────────────────────────
  let totalStepsExecuted = 0;
  let turnCount = 0;
  const rateLimitState = { count: 0 }; // Fix 3: plain, distinct from step retries

  while (loopState.status !== "complete" && loopState.status !== "failed") {
    turnCount++;
    if (turnCount > CIRCUIT_BREAKER.MAX_TURNS) {
      console.log(
        chalk.yellow("Agent reached max turns limit. Exiting cleanly."),
      );
      break;
    }

    const stepIndex = loopState.currentStep;

    // Guard: maximum total executions incl. retries (Fix 1)
    if (totalStepsExecuted >= MAX_TOTAL_EXECUTIONS) {
      loopState.status = "failed";
      loopState.finalOutput =
        `Maximum step limit (${MAX_TOTAL_EXECUTIONS}) reached.\n\n` +
        `Work completed so far:\n\n` +
        loopState.stepResults
          .map((r, i) => `**Step ${i + 1}:**\n${r}`)
          .join("\n\n");
      logLoop(
        loopState,
        `Terminating: max executions (${MAX_TOTAL_EXECUTIONS}) reached`,
      );
      break;
    }

    // Guard: all planned steps processed
    if (stepIndex >= loopState.plan.length) {
      loopState.status = "complete";
      loopState.finalOutput =
        loopState.stepResults[loopState.stepResults.length - 1] ||
        "All planned steps completed.";
      logLoop(loopState, "All planned steps completed");
      break;
    }

    totalStepsExecuted++;

    // ── Act ──────────────────────────────────────────────────────────────
    let stepResult;
    try {
      stepResult = await executeStep(loopState, rateLimitState);
    } catch (error) {
      loopState.status = "failed";
      loopState.finalOutput = `Unrecoverable error at step ${stepIndex + 1}: ${error.message}`;
      logLoop(loopState, `Fatal step error: ${error.message}`);

      await chatService.addMessage(
        conversationId,
        "assistant",
        `[Step ${stepIndex + 1} Failed — Unrecoverable]\n${error.message}`,
      );

      if (loopState.taskId) {
        await agentTaskService
          .failTask(loopState.taskId, loopState.finalOutput)
          .catch((e) =>
            logLoop(loopState, `WARN failTask failed: ${e?.message ?? e}`),
          );
      }
      break;
    }

    if (stepResult === null) {
      loopState.status = "failed";
      loopState.finalOutput = TerminalReason.RATE_LIMITED;
      logLoop(loopState, "Terminating: rate limit exceeded");
      break;
    }

    loopState.stepResults.push(stepResult);

    // ── Reflect ────────────────────────────────────────────────────────────
    const reflection = await reflectOnStep(loopState, stepResult);
    displayReflection(reflection, stepIndex + 1);

    await chatService.addMessage(
      conversationId,
      "assistant",
      `[Step ${stepIndex + 1}/${loopState.plan.length}]\n` +
        `Action: ${loopState.plan[stepIndex]}\n` +
        `Result: ${stepResult}\n\n` +
        `Reflection:\n` +
        `  Assessment: ${reflection.assessment}\n` +
        `  Decision: ${reflection.nextAction}\n` +
        `  Reason: ${reflection.reason}`,
    );

    // ── Apply decision ─────────────────────────────────────────────────────
    if (reflection.nextAction === "terminate") {
      loopState.status = "complete";
      loopState.finalOutput =
        reflection.finalOutput ||
        stepResult ||
        loopState.stepResults.join("\n\n");
      logLoop(loopState, "Model signalled termination — goal complete");
    } else if (reflection.nextAction === "retry") {
      // Fix 2: check BEFORE incrementing so MAX_RETRIES_PER_STEP is honored.
      if (loopState.retryCount >= MAX_RETRIES_PER_STEP) {
        logLoop(
          loopState,
          `Max retries (${MAX_RETRIES_PER_STEP}) reached for step ${stepIndex + 1}, proceeding`,
        );
        loopState.retryCount = 0;
        loopState.currentStep++;
      } else {
        loopState.retryCount++;
        logLoop(
          loopState,
          `Retrying step ${stepIndex + 1} (retry ${loopState.retryCount}/${MAX_RETRIES_PER_STEP})`,
        );
        loopState.stepResults.pop(); // keep context clean
      }
    } else {
      // proceed
      loopState.retryCount = 0;
      loopState.currentStep++;
      logLoop(loopState, `Proceeding to step ${loopState.currentStep + 1}`);
    }

    // Persist progress (Fix 7: surface failures, run independent writes together)
    if (loopState.taskId) {
      const [taskWrite] = await Promise.allSettled([
        agentTaskService.updateTaskStep(
          loopState.taskId,
          loopState.currentStep,
          loopState.stepResults,
          loopState.status,
          loopState.plan,
        ),
      ]);
      if (taskWrite.status === "rejected") {
        logLoop(
          loopState,
          `WARN persist failed: ${taskWrite.reason?.message ?? taskWrite.reason}`,
        );
      }
    }
  }

  // Persist terminal state
  if (loopState.taskId) {
    if (loopState.status === "complete") {
      await agentTaskService
        .completeTask(loopState.taskId, loopState.finalOutput)
        .catch((e) =>
          logLoop(loopState, `WARN completeTask failed: ${e?.message ?? e}`),
        );
    } else if (loopState.status === "failed") {
      await agentTaskService
        .failTask(loopState.taskId, loopState.finalOutput)
        .catch((e) =>
          logLoop(loopState, `WARN failTask failed: ${e?.message ?? e}`),
        );
    }
  }

  return loopState;
}

// ─── Interactive goal loop ────────────────────────────────────────────────────

async function iterativeAgentLoop(conversation, workingDirectory) {
  console.log(
    chalk.hex("#6b7280")(
      "provide a goal  ·  agent will plan and execute up to " +
        MAX_PLAN_STEPS +
        ' steps  ·  "exit" to quit',
    ),
  );
  console.log("");

  const contextSpinner = yoctoSpinner({
    text: "Reading project context...",
  }).start();

  let projectContext = null;
  try {
    projectContext = await readProjectContext(workingDirectory);
    contextSpinner.success("Project context loaded");
    displayContextSummary(projectContext);
  } catch (err) {
    contextSpinner.warning(
      `Could not read project context: ${err.message} — proceeding without context`,
    );
  }

  let isFirstGoal = true;

  while (true) {
    let loopState;

    const incompleteTasks = await agentTaskService
      .getIncompleteTasksForConversation(conversation.id)
      .catch(() => []);

    if (incompleteTasks.length > 0) {
      const task = incompleteTasks[0];
      const lastResult =
        Array.isArray(task.stepResults) && task.stepResults.length > 0
          ? String(task.stepResults[task.stepResults.length - 1]).slice(0, 120)
          : "No steps completed yet";

      console.log("");
      console.log(
        chalk.hex("#374151")("── interrupted task " + "─".repeat(40)),
      );
      console.log(
        chalk.hex("#6b7280")("  goal   ") + chalk.hex("#f9fafb")(task.goal),
      );
      console.log(
        chalk.hex("#6b7280")("  steps  ") +
          chalk.hex("#22d3ee")(String(task.currentStep)) +
          chalk.hex("#6b7280")(" / ") +
          chalk.hex("#22d3ee")(
            String(Array.isArray(task.plan) ? task.plan.length : "?"),
          ),
      );
      console.log(
        chalk.hex("#6b7280")("  last   ") +
          chalk.hex("#6b7280")(
            lastResult + (lastResult.length >= 120 ? "..." : ""),
          ),
      );
      console.log("");

      const resumeChoice = await select({
        message: `Resume from step ${task.currentStep + 1} or start a new goal?`,
        options: [
          {
            value: "resume",
            label: `Resume from step ${task.currentStep + 1}`,
            hint: "Continue from where it left off",
          },
          {
            value: "new",
            label: "Start a new goal",
            hint: "Discard the interrupted task",
          },
        ],
      });

      if (isCancel(resumeChoice)) {
        console.log(chalk.yellow("\nAgent session cancelled\n"));
        return; // Fix 10: unwind, let entry point clean up
      }

      if (resumeChoice === "resume") {
        loopState = createLoopState(
          task.goal,
          projectContext,
          task.id,
          {
            plan: Array.isArray(task.plan) ? task.plan : [],
            currentStep: task.currentStep,
            stepResults: Array.isArray(task.stepResults)
              ? task.stepResults
              : [],
            status: task.status,
          },
          workingDirectory,
        );

        console.log(
          chalk.hex("#4ade80")("resuming from step " + (task.currentStep + 1)),
        );
        console.log("");

        try {
          await runReasoningLoop(loopState, conversation.id);
          displayFinalOutput(loopState);

          if (loopState.finalOutput) {
            await chatService.addMessage(
              conversation.id,
              "assistant",
              `[Final Output]\n${loopState.finalOutput}`,
            );
          }

          if (loopState.status === "complete") {
            console.log(
              chalk.hex("#4ade80")("goal accomplished  ·  ready for next goal"),
            );
            console.log("");
          } else {
            console.log(
              chalk.hex("#facc15")("loop ended  ·  goal not fully completed"),
            );
            console.log("");
          }
        } catch (error) {
          console.log(chalk.hex("#f87171")("error: " + error.message));
          console.log("");
          await chatService.addMessage(
            conversation.id,
            "assistant",
            `[Error] ${error.message}`,
          );
        }

        continue;
      }
      // "new" falls through
    }

    const userInput = await text({
      message: chalk.cyan("Enter your goal"),
      placeholder: "Describe what you want to achieve in detail...",
      validate(value) {
        if (!value || value.trim().length === 0) return "Goal cannot be empty";
        if (value.trim().length < 5)
          return "Please describe your goal in more detail";
      },
    });

    if (isCancel(userInput)) {
      console.log(chalk.yellow("\nAgent session cancelled\n"));
      return; // Fix 10
    }

    if (userInput.trim().toLowerCase() === "exit") {
      console.log(chalk.yellow("\nIterative agent session ended\n"));
      break;
    }

    const goal = userInput.trim();

    console.log("");
    console.log(chalk.hex("#38bdf8").bold("you"));
    console.log(chalk.hex("#38bdf8")("│ ") + chalk.hex("#e2e8f0")(goal));
    console.log("");

    await chatService.addMessage(conversation.id, "user", goal);

    if (isFirstGoal) {
      const title = goal.slice(0, 50) + (goal.length > 50 ? "..." : "");
      await chatService.updateTitle(conversation.id, title);
      isFirstGoal = false;
    }

    const task = await agentTaskService
      .createTask(conversation.id, goal)
      .catch(() => null);
    loopState = createLoopState(
      goal,
      projectContext,
      task?.id ?? null,
      {},
      workingDirectory,
    );

    try {
      await runReasoningLoop(loopState, conversation.id);
      displayFinalOutput(loopState);

      if (loopState.finalOutput) {
        await chatService.addMessage(
          conversation.id,
          "assistant",
          `[Final Output]\n${loopState.finalOutput}`,
        );
      }

      if (loopState.status === "complete") {
        console.log(
          chalk.hex("#4ade80")("goal accomplished  ·  ready for next goal"),
        );
        console.log("");
      } else {
        console.log(
          chalk.hex("#facc15")("loop ended  ·  goal not fully completed"),
        );
        console.log("");
      }
    } catch (error) {
      console.log(chalk.hex("#f87171")("error: " + error.message));
      console.log("");
      if (loopState?.taskId) {
        await agentTaskService
          .failTask(loopState.taskId, error.message)
          .catch(() => {});
      }
      await chatService.addMessage(
        conversation.id,
        "assistant",
        `[Error] ${error.message}`,
      );
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function startIterativeAgentChat(
  conversationId = null,
  workingDirectory = process.cwd(),
) {
  try {
    const user = await getUserFromToken();

    const conversation = await chatService.getOrCreateConversation(
      user.id,
      conversationId,
      "agent",
    );

    const { activeName, requestedName, isFallback } = getActiveProviderInfo();
    const modelDisplay = isFallback
      ? chalk.hex("#facc15")(activeName + " (fallback)")
      : chalk.hex("#a78bfa")(activeName);

    console.log(
      chalk.hex("#22d3ee").bold("orbit α") +
        chalk.hex("#374151")(" │ ") +
        modelDisplay +
        chalk.hex("#374151")(" │ ") +
        chalk.hex("#c084fc")("iterative agent") +
        chalk.hex("#374151")(" │ ") +
        chalk.hex("#6b7280")(conversation.id.slice(0, 8)) +
        chalk.hex("#374151")(" │ ") +
        chalk.hex("#4ade80")(workingDirectory),
    );
    console.log(chalk.hex("#1e2230")("─".repeat(60)));
    console.log("");

    await iterativeAgentLoop(conversation, workingDirectory);
  } catch (error) {
    console.log("");
    console.log(chalk.hex("#f87171")("error: " + error.message));
  } finally {
    await prisma.$disconnect().catch(() => {}); // Fix 10
  }
}

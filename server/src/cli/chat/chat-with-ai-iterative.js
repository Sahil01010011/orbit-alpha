import chalk from "chalk";
import boxen from "boxen";
import { text, select, isCancel, cancel, intro, outro } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { AIService } from "../ai/google-service.js";
import { ChatService } from "../../service/chat.service.js";
import { AgentTaskService } from "../../service/agentTask.service.js";
import { getStoredToken } from "../commands/auth/login.js";
import prisma from "../../lib/db.js";
import { z } from "zod";
import { readProjectContext, formatContextForPrompt } from "../contextReader.js";
import { ORBITAL_SYSTEM_PROMPT } from "../../config/agent.config.js";
import { getToolSchemas } from "../../tools/index.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_STEPS = 10;
const MAX_RETRIES_PER_STEP = 2;
const TOOL_RESULT_SUMMARY_MAX_LENGTH = 120;

// ─── Marked terminal renderer (same options as other chat files) ───────────────

marked.use(
  markedTerminal({
    code: chalk.cyan,
    blockquote: chalk.gray.italic,
    heading: chalk.green.bold,
    firstHeading: chalk.magenta.underline.bold,
    hr: chalk.reset,
    listitem: chalk.reset,
    list: chalk.reset,
    paragraph: chalk.reset,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.yellow.bgBlack,
    del: chalk.dim.gray.strikethrough,
    link: chalk.blue.underline,
    href: chalk.blue.underline,
  })
);

// ─── Services ─────────────────────────────────────────────────────────────────

const aiService = new AIService();
const chatService = new ChatService();
const agentTaskService = new AgentTaskService();

// ─── Zod schemas for structured AI outputs ────────────────────────────────────

const PlanSchema = z.object({
  steps: z
    .array(z.string())
    .min(1)
    .max(MAX_STEPS)
    .describe(
      "Ordered list of specific, concrete, executable steps to accomplish the goal"
    ),
  rationale: z
    .string()
    .describe(
      "Brief explanation of the overall approach and why these steps achieve the goal"
    ),
});

const ReflectionSchema = z.object({
  assessment: z
    .string()
    .describe(
      "Detailed assessment of what was accomplished in this step and whether it was successful"
    ),
  nextAction: z
    .enum(["proceed", "retry", "terminate"])
    .describe(
      'proceed = move to next step; retry = repeat this step (max 2 retries); terminate = goal fully accomplished OR unrecoverable error'
    ),
  reason: z
    .string()
    .describe("Explanation for why this next action was chosen"),
  finalOutput: z
    .string()
    .optional()
    .describe(
      'Assembled final answer for the user — required when nextAction is "terminate" with successful completion'
    ),
});

// ─── Loop state ───────────────────────────────────────────────────────────────

/**
 * Create an in-memory loop state structure for a single goal execution.
 * @param {string} goal - The original user prompt / goal
 * @param {object|null} projectContext - Structured context from readProjectContext()
 * @param {string|null} taskId - Existing AgentTask ID for resume (null for new tasks)
 * @param {object} [resume] - Partial state to restore when resuming (plan, currentStep, stepResults)
 */
function createLoopState(goal, projectContext = null, taskId = null, resume = {}, outputDirectory = null) {
  return {
    goal,
    projectContext,
    outputDirectory: outputDirectory || projectContext?.workingDirectory || process.cwd(),
    plan: resume.plan || [],
    rationale: resume.rationale || "",
    currentStep: resume.currentStep || 0,
    stepResults: resume.stepResults || [],
    retryCount: 0,
    status: resume.status || "planning", // planning | acting | reflecting | complete | failed
    finalOutput: null,
    taskId,
  };
}

// ─── Logging helpers ──────────────────────────────────────────────────────────

function logLoop(loopState, message) {
  const tag =
    loopState.plan.length > 0
      ? `[${loopState.status}:${loopState.currentStep + 1}/${loopState.plan.length}]`
      : `[${loopState.status}]`;
  console.log(chalk.dim(`  ${tag} ${message}`));
}

// ─── Auth helper (matches pattern from other chat files) ──────────────────────

async function getUserFromToken() {
  const token = await getStoredToken();

  if (!token?.access_token) {
    throw new Error("Not authenticated. Please run 'orbit login' first.");
  }

  const spinner = yoctoSpinner({ text: "Authenticating..." }).start();

  const user = await prisma.user.findFirst({
    where: {
      sessions: {
        some: { token: token.access_token },
      },
    },
  });

  if (!user) {
    spinner.error("User not found");
    throw new Error("User not found. Please login again.");
  }

  spinner.success(`Welcome back, ${user.name}!`);
  return user;
}

// ─── Phase 1: Planning ────────────────────────────────────────────────────────

async function generatePlan(loopState) {
  const spinner = yoctoSpinner({
    text: "🧠 Generating execution plan...",
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
- Generate between 2 and ${MAX_STEPS} steps
- Each step must be specific and actionable on its own
- Steps should build on each other logically
- Focus entirely on achieving the stated goal
- Take the project context above into account when planning — use the correct language, framework, and existing structure

Provide a clear rationale explaining your overall approach.`,
      ORBITAL_SYSTEM_PROMPT
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
  const stepLines = loopState.plan
    .map((step, i) => `  ${chalk.cyan(`Step ${i + 1}:`)} ${step}`)
    .join("\n");

  console.log(
    boxen(
      `${chalk.bold("Goal:")} ${chalk.white(loopState.goal)}\n\n` +
        `${chalk.bold("Approach:")} ${chalk.gray(loopState.rationale)}\n\n` +
        `${chalk.bold("Steps:")}\n${stepLines}`,
      {
        padding: 1,
        margin: { top: 1, bottom: 1 },
        borderStyle: "round",
        borderColor: "cyan",
        title: `📋 Execution Plan (${loopState.plan.length} steps)`,
        titleAlignment: "center",
      }
    )
  );
}

function displayStepHeader(loopState) {
  const stepIndex = loopState.currentStep;
  const step = loopState.plan[stepIndex];
  const stepNum = stepIndex + 1;
  const total = loopState.plan.length;
  const filled = "█".repeat(stepNum);
  const empty = "░".repeat(Math.max(0, total - stepNum));
  const progressBar = chalk.green(filled) + chalk.gray(empty);

  console.log(
    "\n" +
      boxen(
        `${progressBar} ${chalk.bold(`${stepNum} / ${total}`)}\n\n` +
          `${chalk.bold("Executing:")} ${chalk.white(step)}`,
        {
          padding: 1,
          borderStyle: "round",
          borderColor: "yellow",
          title: `⚡ Step ${stepNum} of ${total}`,
          titleAlignment: "center",
        }
      )
  );
}

function displayReflection(reflection, stepNum) {
  const actionConfig = {
    proceed: {
      color: chalk.green,
      emoji: "➡️ ",
      label: "Proceed to next step",
      border: "green",
    },
    retry: {
      color: chalk.yellow,
      emoji: "🔄 ",
      label: "Retry this step",
      border: "yellow",
    },
    terminate: {
      color: chalk.magenta,
      emoji: "🏁",
      label: "Terminate — goal complete",
      border: "magenta",
    },
  };

  const cfg = actionConfig[reflection.nextAction] || actionConfig.proceed;

  console.log(
    boxen(
      `${chalk.bold("Assessment:")} ${reflection.assessment}\n\n` +
        `${chalk.bold("Decision:")} ${cfg.color(
          `${cfg.emoji}  ${cfg.label}`
        )}\n` +
        `${chalk.bold("Reason:")} ${chalk.gray(reflection.reason)}`,
      {
        padding: 1,
        margin: { top: 1, bottom: 1 },
        borderStyle: "round",
        borderColor: cfg.border,
        title: `🔍 Reflection — Step ${stepNum}`,
        titleAlignment: "center",
      }
    )
  );
}

function displayFinalOutput(loopState) {
  const content = loopState.finalOutput || "No output available.";
  const rendered = marked.parse(content);
  const statusLabel =
    loopState.status === "complete"
      ? chalk.green("✅ COMPLETE")
      : chalk.red("❌ FAILED");

  console.log(
    boxen(rendered.trim(), {
      padding: 1,
      margin: { top: 1, bottom: 1 },
      borderStyle: "double",
      borderColor: loopState.status === "complete" ? "green" : "red",
      title: `${statusLabel}  Final Output`,
      titleAlignment: "center",
    })
  );
}

function displayContextSummary(context) {
  const lines = [];

  lines.push(
    `${chalk.bold("Directory:")} ${chalk.white(context.workingDirectory)}`
  );
  lines.push(
    `${chalk.bold("Language:")}  ${chalk.cyan(context.detectedLanguage)}`
  );

  if (context.detectedFramework) {
    lines.push(
      `${chalk.bold("Framework:")} ${chalk.cyan(context.detectedFramework)}`
    );
  }

  if (context.packageJson?.name) {
    lines.push(
      `${chalk.bold("Project:")}   ${chalk.white(context.packageJson.name)}` +
        (context.packageJson.version
          ? chalk.gray(` v${context.packageJson.version}`)
          : "")
    );
  }

  if (context.configFiles.length > 0) {
    lines.push(
      `${chalk.bold("Configs:")}   ${chalk.gray(context.configFiles.join(", "))}`
    );
  }

  if (!context.packageJson) {
    lines.push(
      chalk.yellow("⚠️  No package.json found — proceeding with minimal context")
    );
  }

  console.log(
    boxen(lines.join("\n"), {
      padding: 1,
      margin: { top: 1, bottom: 1 },
      borderStyle: "round",
      borderColor: "magenta",
      title: "🗂️  Project Context",
      titleAlignment: "center",
    })
  );
}

// ─── Phase 2: Act ─────────────────────────────────────────────────────────────

/**
 * Format a raw tool execute() return value into a short human-readable string.
 * Tool results are now always strings (JSON-stringified objects when necessary).
 * @param {*} raw - The value returned by the tool's execute function
 * @returns {string}
 */
function formatToolResult(raw) {
  let msg;
  if (typeof raw === "string") {
    // Tool results are JSON-stringified; try to extract the meaningful field for display.
    try {
      const parsed = JSON.parse(raw);
      const inner = parsed?.result ?? parsed?.error ?? raw;
      msg = typeof inner === "string" ? inner : JSON.stringify(inner);
    } catch (_) {
      msg = raw;
    }
  } else {
    // Legacy/fallback path for plain objects
    msg = raw?.result ?? raw?.error ?? JSON.stringify(raw);
  }
  return String(msg).slice(0, TOOL_RESULT_SUMMARY_MAX_LENGTH);
}

async function executeStep(loopState) {
  const stepIndex = loopState.currentStep;
  const step = loopState.plan[stepIndex];
  const stepNum = stepIndex + 1;
  const total = loopState.plan.length;

  loopState.status = "acting";
  displayStepHeader(loopState);

  const previousContext =
    loopState.stepResults.length > 0
      ? `\nPrevious step results:\n${loopState.stepResults
          .map((r, i) => `Step ${i + 1} result:\n${r}`)
          .join("\n\n")}\n`
      : "";

  const retryNote =
    loopState.retryCount > 0
      ? `\nNote: This is retry attempt ${loopState.retryCount} for this step. The previous attempt was deemed insufficient — please improve your response.\n`
      : "";

  const contextBlock = loopState.projectContext
    ? `\n${formatContextForPrompt(loopState.projectContext)}\n`
    : "";

  const messages = [
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

  // Load tools from registry, scoped to the agent's output directory
  const toolSchemas = getToolSchemas({ outputDirectory: loopState.outputDirectory });
  const tools = Object.keys(toolSchemas).length > 0 ? toolSchemas : undefined;

  try {
    // Uses the existing sendMessage / tool-calling infrastructure
    const result = await aiService.sendMessage(messages, (chunk) => {
      if (isFirstChunk) {
        stopSpinnerOnce();
        console.log(
          "\n" + chalk.bold(`  📝 Step ${stepNum} output:`)
        );
        console.log(chalk.gray("  " + "─".repeat(55)));
        isFirstChunk = false;
      }
      stepResult += chunk;
      process.stdout.write(chalk.white(chunk));
    }, {
      system: ORBITAL_SYSTEM_PROMPT,
      ...(tools && { tools }),
      onToolCall: (toolCall, toolResult) => {
        stopSpinnerOnce();
        console.log(chalk.cyan(`\n  🔧 Invoking tool: ${toolCall.toolName}`));
        if (toolResult !== undefined) {
          console.log(chalk.green(`  ✔ Tool result: ${formatToolResult(toolResult.result)}`));
        }
      },
    });

    stopSpinnerOnce();

    console.log("\n" + chalk.gray("  " + "─".repeat(55)) + "\n");

    let content = result.content || stepResult;

    // When the model only invokes tools without generating follow-up text,
    // synthesise the step output from the tool results so the step is non-empty.
    if (!content && result.toolResults && result.toolResults.length > 0) {
      content = result.toolResults
        .map((tr) => `Tool ${tr.toolName}: ${formatToolResult(tr.result)}`)
        .join("\n");
    }

    logLoop(loopState, `Step ${stepNum} executed (${content.length} chars)`);
    return content;
  } catch (error) {
    spinner.error(`Step ${stepNum} execution failed`);
    logLoop(loopState, `Step ${stepNum} error: ${error.message}`);
    throw error;
  }
}

// ─── Phase 3: Reflect ─────────────────────────────────────────────────────────

async function reflectOnStep(loopState, stepResult) {
  const stepIndex = loopState.currentStep;
  const step = loopState.plan[stepIndex];
  const stepNum = stepIndex + 1;
  const total = loopState.plan.length;
  const isLastStep = stepIndex >= total - 1;

  loopState.status = "reflecting";

  const spinner = yoctoSpinner({
    text: `Reflecting on step ${stepNum}/${total}...`,
    color: "cyan",
  }).start();

  try {
    const reflection = await aiService.generateStructured(
      ReflectionSchema,
      `You are an AI reasoning agent reviewing the result of an execution step.

Goal: ${loopState.goal}

Full plan:
${loopState.plan.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Current step (${stepNum}/${total}): ${step}

Step result:
${stepResult}

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
      ORBITAL_SYSTEM_PROMPT
    );

    spinner.success(`Reflection: ${reflection.nextAction}`);
    logLoop(
      loopState,
      `Reflection decision: ${reflection.nextAction} — ${reflection.reason}`
    );
    return reflection;
  } catch (error) {
    spinner.error("Reflection failed");
    logLoop(loopState, `Reflection error: ${error.message}`);

    // Graceful fallback so the loop can continue
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

/**
 * Run the full goal → plan → act → observe → reflect → repeat loop.
 * @param {Object} loopState - In-memory loop state for this goal
 * @param {string} conversationId - DB conversation ID for persistence
 */
async function runReasoningLoop(loopState, conversationId) {
  // ── Phase 1: Planning (skip if resuming with an existing plan) ────────────
  if (loopState.plan.length === 0) {
    logLoop(loopState, "Starting planning phase");
    await generatePlan(loopState);
    displayPlan(loopState);

    // Persist the plan in the AgentTask record
    if (loopState.taskId) {
      await agentTaskService.updateTaskStep(
        loopState.taskId,
        loopState.currentStep,
        loopState.stepResults,
        "acting",
        loopState.plan
      ).catch((e) => console.error(chalk.dim(`[task-persist] ${e.message}`))); // non-fatal
    }

    // Persist the plan as an assistant message
    await chatService.addMessage(
      conversationId,
      "assistant",
      `[Plan Generated]\nGoal: ${loopState.goal}\nRationale: ${loopState.rationale}\n\nSteps:\n${loopState.plan
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n")}`
    );
  } else {
    logLoop(loopState, `Resuming from step ${loopState.currentStep + 1}/${loopState.plan.length}`);
    displayPlan(loopState);
  }

  // ── Phase 2: Act → Observe → Reflect loop ─────────────────────────────────
  let totalStepsExecuted = 0;

  while (loopState.status !== "complete" && loopState.status !== "failed") {
    const stepIndex = loopState.currentStep;

    // Guard: maximum total steps executed (includes retries, preventing infinite loops)
    if (totalStepsExecuted >= MAX_STEPS) {
      loopState.status = "failed";
      loopState.finalOutput =
        `Maximum step limit (${MAX_STEPS}) reached.\n\n` +
        `Work completed so far:\n\n` +
        loopState.stepResults
          .map((r, i) => `**Step ${i + 1}:**\n${r}`)
          .join("\n\n");
      logLoop(loopState, `Terminating: max steps (${MAX_STEPS}) reached`);
      break;
    }

    // Guard: all planned steps have been processed
    if (stepIndex >= loopState.plan.length) {
      loopState.status = "complete";
      loopState.finalOutput =
        loopState.stepResults[loopState.stepResults.length - 1] ||
        "All planned steps completed.";
      logLoop(loopState, "All planned steps completed");
      break;
    }

    totalStepsExecuted++;

    // ── Act ────────────────────────────────────────────────────────────────
    let stepResult;
    try {
      stepResult = await executeStep(loopState);
    } catch (error) {
      loopState.status = "failed";
      loopState.finalOutput = `Unrecoverable error at step ${
        stepIndex + 1
      }: ${error.message}`;
      logLoop(loopState, `Fatal step error: ${error.message}`);

      await chatService.addMessage(
        conversationId,
        "assistant",
        `[Step ${stepIndex + 1} Failed — Unrecoverable]\n${error.message}`
      );

      // Persist failure state
      if (loopState.taskId) {
        await agentTaskService.failTask(loopState.taskId, loopState.finalOutput).catch((e) => console.error(chalk.dim(`[task-persist] ${e.message}`)));
      }
      break;
    }

    // Record observation
    loopState.stepResults.push(stepResult);

    // ── Reflect ────────────────────────────────────────────────────────────
    const reflection = await reflectOnStep(loopState, stepResult);
    displayReflection(reflection, stepIndex + 1);

    // Persist step + reflection as a conversation message
    await chatService.addMessage(
      conversationId,
      "assistant",
      `[Step ${stepIndex + 1}/${loopState.plan.length}]\n` +
        `Action: ${loopState.plan[stepIndex]}\n` +
        `Result: ${stepResult}\n\n` +
        `Reflection:\n` +
        `  Assessment: ${reflection.assessment}\n` +
        `  Decision: ${reflection.nextAction}\n` +
        `  Reason: ${reflection.reason}`
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
      loopState.retryCount++;

      if (loopState.retryCount >= MAX_RETRIES_PER_STEP) {
        logLoop(
          loopState,
          `Max retries (${MAX_RETRIES_PER_STEP}) reached for step ${
            stepIndex + 1
          }, proceeding`
        );
        loopState.retryCount = 0;
        loopState.currentStep++;
      } else {
        logLoop(
          loopState,
          `Retrying step ${stepIndex + 1} (retry ${loopState.retryCount}/${MAX_RETRIES_PER_STEP})`
        );
        // Remove the unsatisfactory result so context stays clean
        loopState.stepResults.pop();
      }
    } else {
      // proceed
      loopState.retryCount = 0;
      loopState.currentStep++;
      logLoop(loopState, `Proceeding to step ${loopState.currentStep + 1}`);
    }

    // Persist step progress to database after each decision
    if (loopState.taskId) {
      await agentTaskService.updateTaskStep(
        loopState.taskId,
        loopState.currentStep,
        loopState.stepResults,
        loopState.status,
        loopState.plan
      ).catch((e) => console.error(chalk.dim(`[task-persist] ${e.message}`))); // non-fatal
    }
  }

  // Persist terminal state
  if (loopState.taskId) {
    if (loopState.status === "complete") {
      await agentTaskService.completeTask(loopState.taskId, loopState.finalOutput).catch((e) => console.error(chalk.dim(`[task-persist] ${e.message}`)));
    } else if (loopState.status === "failed") {
      await agentTaskService.failTask(loopState.taskId, loopState.finalOutput).catch((e) => console.error(chalk.dim(`[task-persist] ${e.message}`)));
    }
  }

  return loopState;
}

// ─── Interactive goal loop ────────────────────────────────────────────────────

async function iterativeAgentLoop(conversation, workingDirectory) {
  console.log(
    boxen(
      `${chalk.cyan.bold("How it works:")}\n\n` +
        `  ${chalk.gray("1.")} ${chalk.white("You provide a goal")}\n` +
        `  ${chalk.gray("2.")} ${chalk.white(
          "The agent generates a step-by-step plan"
        )}\n` +
        `  ${chalk.gray("3.")} ${chalk.white(
          "Each step is executed and observed"
        )}\n` +
        `  ${chalk.gray("4.")} ${chalk.white(
          "The agent reflects and decides: proceed / retry / terminate"
        )}\n` +
        `  ${chalk.gray("5.")} ${chalk.white(
          "Final output is presented when the goal is complete"
        )}\n\n` +
        chalk.dim(
          `Maximum ${MAX_STEPS} steps per goal.  Type "exit" to quit.`
        ),
      {
        padding: 1,
        margin: { bottom: 1 },
        borderStyle: "round",
        borderColor: "cyan",
        title: "🔄 Iterative Reasoning Loop",
        titleAlignment: "center",
      }
    )
  );

  // ── Read project context once for the entire session ──────────────────────
  const contextSpinner = yoctoSpinner({
    text: "🗂️  Reading project context...",
  }).start();

  let projectContext = null;
  try {
    projectContext = await readProjectContext(workingDirectory);
    contextSpinner.success("Project context loaded");
    displayContextSummary(projectContext);
  } catch (err) {
    contextSpinner.warning(
      `Could not read project context: ${err.message} — proceeding without context`
    );
  }

  let isFirstGoal = true;

  while (true) {
    // ── Check for incomplete tasks and offer resume ────────────────────────
    let loopState;

    const incompleteTasks = await agentTaskService
      .getIncompleteTasksForConversation(conversation.id)
      .catch((e) => { console.error(chalk.dim(`[task-persist] ${e.message}`)); return []; });

    if (incompleteTasks.length > 0) {
      const task = incompleteTasks[0];
      const lastResult =
        Array.isArray(task.stepResults) && task.stepResults.length > 0
          ? String(task.stepResults[task.stepResults.length - 1]).slice(0, 120)
          : "No steps completed yet";

      console.log(
        boxen(
          `${chalk.bold("Goal:")} ${chalk.white(task.goal)}\n` +
            `${chalk.bold("Steps completed:")} ${chalk.cyan(String(task.currentStep))} / ${chalk.cyan(String(Array.isArray(task.plan) ? task.plan.length : "?"))}\n` +
            `${chalk.bold("Last result:")} ${chalk.gray(lastResult + (lastResult.length >= 120 ? "…" : ""))}`,
          {
            padding: 1,
            margin: { top: 1, bottom: 1 },
            borderStyle: "round",
            borderColor: "yellow",
            title: "⏸️  Interrupted Task Detected",
            titleAlignment: "center",
          }
        )
      );

      const resumeChoice = await select({
        message: `Resume from step ${task.currentStep + 1} or start a new goal?`,
        options: [
          { value: "resume", label: `Resume from step ${task.currentStep + 1}`, hint: "Continue from where it left off" },
          { value: "new", label: "Start a new goal", hint: "Discard the interrupted task" },
        ],
      });

      if (isCancel(resumeChoice)) {
        console.log(chalk.yellow("\n👋 Agent session cancelled\n"));
        process.exit(0);
      }

      if (resumeChoice === "resume") {
        loopState = createLoopState(
          task.goal,
          projectContext,
          task.id,
          {
            plan: Array.isArray(task.plan) ? task.plan : [],
            currentStep: task.currentStep,
            stepResults: Array.isArray(task.stepResults) ? task.stepResults : [],
            status: task.status,
          },
          workingDirectory
        );

        console.log(chalk.green(`\n▶  Resuming task from step ${task.currentStep + 1}...\n`));

        try {
          await runReasoningLoop(loopState, conversation.id);
          displayFinalOutput(loopState);

          if (loopState.finalOutput) {
            await chatService.addMessage(
              conversation.id,
              "assistant",
              `[Final Output]\n${loopState.finalOutput}`
            );
          }

          if (loopState.status === "complete") {
            console.log(chalk.green.bold("\n✅ Goal accomplished! Ready for next goal.\n"));
          } else {
            console.log(chalk.yellow.bold("\n⚠️  Loop ended without fully completing the goal.\n"));
          }
        } catch (error) {
          console.log(chalk.red(`\n❌ Agent error: ${error.message}\n`));
          await chatService.addMessage(conversation.id, "assistant", `[Error] ${error.message}`);
        }

        continue; // back to top of while loop
      }
      // "new" falls through to regular goal input below
    }

    const userInput = await text({
      message: chalk.cyan("🎯 Enter your goal"),
      placeholder: "Describe what you want to achieve in detail...",
      validate(value) {
        if (!value || value.trim().length === 0) {
          return "Goal cannot be empty";
        }
        if (value.trim().length < 5) {
          return "Please describe your goal in more detail";
        }
      },
    });

    if (isCancel(userInput)) {
      console.log(chalk.yellow("\n👋 Agent session cancelled\n"));
      process.exit(0);
    }

    if (userInput.trim().toLowerCase() === "exit") {
      console.log(chalk.yellow("\n👋 Iterative agent session ended\n"));
      break;
    }

    const goal = userInput.trim();

    // Display the goal
    console.log(
      boxen(chalk.white(goal), {
        padding: 1,
        margin: { top: 1, bottom: 1 },
        borderStyle: "round",
        borderColor: "blue",
        title: "🎯 Goal",
        titleAlignment: "left",
      })
    );

    // Persist user message
    await chatService.addMessage(conversation.id, "user", goal);

    // Update conversation title on first goal
    if (isFirstGoal) {
      const title = goal.slice(0, 50) + (goal.length > 50 ? "..." : "");
      await chatService.updateTitle(conversation.id, title);
      isFirstGoal = false;
    }

    // Create a new AgentTask record and build the loop state
    const task = await agentTaskService.createTask(conversation.id, goal)
      .catch((e) => { console.error(chalk.dim(`[task-persist] ${e.message}`)); return null; });
    loopState = createLoopState(goal, projectContext, task?.id ?? null, {}, workingDirectory);

    try {
      await runReasoningLoop(loopState, conversation.id);
      displayFinalOutput(loopState);

      // Persist final output summary
      if (loopState.finalOutput) {
        await chatService.addMessage(
          conversation.id,
          "assistant",
          `[Final Output]\n${loopState.finalOutput}`
        );
      }

      if (loopState.status === "complete") {
        console.log(
          chalk.green.bold("\n✅ Goal accomplished! Ready for next goal.\n")
        );
      } else {
        console.log(
          chalk.yellow.bold(
            "\n⚠️  Loop ended without fully completing the goal.\n"
          )
        );
      }
    } catch (error) {
      console.log(chalk.red(`\n❌ Agent error: ${error.message}\n`));
      if (loopState?.taskId) {
        await agentTaskService.failTask(loopState.taskId, error.message).catch((e) => console.error(chalk.dim(`[task-persist] ${e.message}`)));
      }
      await chatService.addMessage(
        conversation.id,
        "assistant",
        `[Error] ${error.message}`
      );
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function startIterativeAgentChat(conversationId = null, workingDirectory = process.cwd()) {
  try {
    intro(
      boxen(
        chalk.bold.cyan("🔄 Orbit AI — Iterative Agent Mode\n\n") +
          chalk.gray("Goal → Plan → Act → Observe → Reflect → Repeat"),
        {
          padding: 1,
          borderStyle: "double",
          borderColor: "cyan",
        }
      )
    );

    const user = await getUserFromToken();

    const spinner = yoctoSpinner({ text: "Loading conversation..." }).start();
    const conversation = await chatService.getOrCreateConversation(
      user.id,
      conversationId,
      "agent"
    );
    spinner.success("Conversation loaded");

    console.log(
      boxen(
        `${chalk.bold("Conversation:")} ${conversation.title}\n` +
          `${chalk.gray("ID:")} ${conversation.id}\n` +
          `${chalk.gray("Mode:")} ${chalk.cyan("Iterative Agent")}\n` +
          `${chalk.gray("Output Directory:")} ${chalk.white(workingDirectory)}`,
        {
          padding: 1,
          margin: { top: 1, bottom: 1 },
          borderStyle: "round",
          borderColor: "cyan",
          title: "🔄 Session Info",
          titleAlignment: "center",
        }
      )
    );

    await iterativeAgentLoop(conversation, workingDirectory);

    outro(chalk.green.bold("\n✨ Thanks for using Iterative Agent Mode!"));
  } catch (error) {
    console.log(
      boxen(chalk.red(`❌ Error: ${error.message}`), {
        padding: 1,
        margin: 1,
        borderStyle: "round",
        borderColor: "red",
      })
    );
    process.exit(1);
  }
}

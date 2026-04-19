import chalk from "chalk";
import { text, select, isCancel, cancel, intro, outro } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { AIService } from "../ai/google-service.js";
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
import { readProjectContext, formatContextForPrompt } from "../contextReader.js";
import { ORBITAL_SYSTEM_PROMPT } from "../../config/agent.config.js";
import { getToolSchemas } from "../../tools/index.js";
import { TerminalReason } from "../agent/terminal-reason.js";
import { CIRCUIT_BREAKER, backoffDelay } from "../agent/circuit-breaker.js";
import { compressIfNeeded } from "../agent/context-compressor.js";
import { fillOrphanedToolResults } from "../agent/orphan-guard.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_STEPS = 10;
const MAX_RETRIES_PER_STEP = 2;
const TOOL_RESULT_SUMMARY_MAX_LENGTH = 120;

// ─── Marked terminal renderer (same options as other chat files) ───────────────

marked.use(
  markedTerminal({
    code: chalk.hex('#22d3ee'),
    blockquote: chalk.hex('#6b7280').italic,
    heading: chalk.hex('#a78bfa').bold,
    firstHeading: chalk.hex('#c084fc').bold,
    hr: chalk.hex('#374151'),
    listitem: chalk.hex('#f9fafb'),
    list: chalk.hex('#f9fafb'),
    paragraph: chalk.hex('#e2e8f0'),
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.hex('#22d3ee'),
    del: chalk.dim,
    link: chalk.hex('#38bdf8').underline,
    href: chalk.hex('#38bdf8').underline,
  })
);

// ─── Services ─────────────────────────────────────────────────────────────────

const aiService = getProvider();
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

// eslint-disable-next-line no-unused-vars
function logLoop(loopState, message) {
  // Internal loop logs suppressed — UI panels communicate progress visually
}

// ─── Auth helper (matches pattern from other chat files) ──────────────────────

async function getUserFromToken() {
  const token = await getStoredToken();

  if (!token?.access_token) {
    throw new Error("Not authenticated. Please run 'orbit login' first.");
  }

  const user = await prisma.user.findFirst({
    where: {
      sessions: {
        some: { token: token.access_token },
      },
    },
  });

  if (!user) {
    throw new Error('User not found. Please login again.');
  }

  return user;
}

// ─── Phase 1: Planning ────────────────────────────────────────────────────────

async function generatePlan(loopState) {
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
  console.log('');
  console.log(chalk.hex('#22d3ee').bold('orbit') + chalk.hex('#374151')(' · ') + chalk.hex('#a78bfa')('plan generated'));
  console.log('');
  console.log(
    chalk.hex('#6b7280')('goal  ') +
    chalk.hex('#f9fafb')(loopState.goal)
  );
  console.log(
    chalk.hex('#6b7280')('why   ') +
    chalk.hex('#6b7280')(loopState.rationale)
  );
  console.log('');
  console.log(chalk.hex('#374151')('── steps ' + '─'.repeat(51)));
  loopState.plan.forEach((step, i) => {
    console.log(
      chalk.hex('#374151')(`  ${String(i + 1).padStart(2, ' ')}  `) +
      chalk.hex('#e2e8f0')(step)
    );
  });
  console.log(chalk.hex('#374151')('─'.repeat(60)));
  console.log('');
}

function displayStepHeader(loopState) {
  const stepNum = loopState.currentStep + 1;
  const total = loopState.plan.length;
  const step = loopState.plan[loopState.currentStep];
  const filled = '█'.repeat(stepNum);
  const empty = '░'.repeat(Math.max(0, total - stepNum));

  console.log('');
  console.log(
    chalk.hex('#facc15')(filled) +
    chalk.hex('#374151')(empty) +
    chalk.hex('#6b7280')(`  step ${stepNum}/${total}`) +
    chalk.hex('#374151')('  ·  ') +
    chalk.hex('#facc15')('acting')
  );
  console.log(
    chalk.hex('#374151')('  ') +
    chalk.hex('#e2e8f0')(step)
  );
  console.log('');
}

function displayReflection(reflection, stepNum) {
  const actionColor = reflection.nextAction === 'proceed'
    ? chalk.hex('#4ade80')
    : reflection.nextAction === 'retry'
    ? chalk.hex('#facc15')
    : chalk.hex('#c084fc');

  const actionLabel = reflection.nextAction === 'proceed'
    ? 'proceed to next step'
    : reflection.nextAction === 'retry'
    ? 'retry this step'
    : 'terminate — goal complete';

  console.log('');
  console.log(
    chalk.hex('#6b7280')('── reflect step ' + stepNum + ' ' + '─'.repeat(43))
  );
  console.log(
    chalk.hex('#6b7280')('  decision  ') +
    actionColor(actionLabel)
  );
  console.log(
    chalk.hex('#6b7280')('  reason    ') +
    chalk.hex('#6b7280')(reflection.reason)
  );
  console.log('');
}

function displayFinalOutput(loopState) {
  const content = loopState.finalOutput || 'No output available.';
  const isComplete = loopState.status === 'complete';

  console.log('');
  console.log(
    chalk.hex('#374151')('── final output ' + '─'.repeat(44))
  );
  console.log(
    chalk.hex('#22d3ee').bold('orbit') +
    chalk.hex('#374151')(' · ') +
    (isComplete
      ? chalk.hex('#4ade80')('complete')
      : chalk.hex('#f87171')('failed'))
  );
  console.log('');

  const rendered = marked.parse(content).trim();
  rendered.split('\n').forEach(line => {
    console.log(chalk.hex('#374151')('│ ') + line);
  });

  console.log('');
  console.log(chalk.hex('#1e2230')('─'.repeat(60)));
  console.log('');
}

function displayContextSummary(context) {
  console.log('');
  console.log(chalk.hex('#374151')('── project context ' + '─'.repeat(41)));
  console.log(
    chalk.hex('#6b7280')('  dir        ') +
    chalk.hex('#f9fafb')(context.workingDirectory)
  );
  console.log(
    chalk.hex('#6b7280')('  language   ') +
    chalk.hex('#22d3ee')(context.detectedLanguage)
  );
  if (context.detectedFramework) {
    console.log(
      chalk.hex('#6b7280')('  framework  ') +
      chalk.hex('#22d3ee')(context.detectedFramework)
    );
  }
  if (context.packageJson?.name) {
    console.log(
      chalk.hex('#6b7280')('  project    ') +
      chalk.hex('#f9fafb')(context.packageJson.name) +
      (context.packageJson.version
        ? chalk.hex('#6b7280')(' v' + context.packageJson.version)
        : '')
    );
  }
  if (context.configFiles.length > 0) {
    console.log(
      chalk.hex('#6b7280')('  configs    ') +
      chalk.hex('#6b7280')(context.configFiles.join(', '))
    );
  }
  console.log('');
}

// ─── Phase 2: Act ─────────────────────────────────────────────────────────────

/**
 * Format a raw tool execute() return value into a short human-readable string.
 * Tool results are now always strings (JSON-stringified objects when necessary).
 * @param {*} raw - The value returned by the tool's execute function
 * @returns {string}
 */
export function formatToolResult(raw) {
  if (raw === undefined || raw === null) return '(no result)';
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      const inner = parsed?.result ?? parsed?.error ?? raw;
      return typeof inner === 'string'
        ? inner
        : JSON.stringify(inner, null, 2);
    } catch {
      return raw;
    }
  }
  if (typeof raw === 'object') {
    const inner = raw?.result ?? raw?.error ?? raw;
    return typeof inner === 'string'
      ? inner
      : JSON.stringify(inner, null, 2);
  }
  return String(raw);
}

async function executeStep(loopState, rateLimitState) {
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

  // Load tools from registry, scoped to the agent's output directory
  const toolSchemas = getToolSchemas({ outputDirectory: loopState.outputDirectory });
  const tools = Object.keys(toolSchemas).length > 0 ? toolSchemas : undefined;

  while (true) {
    messages = await compressIfNeeded(messages, aiService);

    try {
      // Uses the existing sendMessage / tool-calling infrastructure
      const result = await sendMessageWithFallback(
        messages,
        (chunk) => {
          if (isFirstChunk) {
            stopSpinnerOnce();
            console.log(
              chalk.hex('#374151')('── step ' + stepNum + ' output ' + '─'.repeat(46))
            );
            isFirstChunk = false;
          }
          stepResult += chunk;
          process.stdout.write(chalk.hex('#e2e8f0')(chunk));
        },
        {
          system: ORBITAL_SYSTEM_PROMPT,
          ...(tools && { tools }),
          onToolCall: (toolCall, toolResult) => {
            stopSpinnerOnce();
            console.log('');
            console.log(
              chalk.hex('#374151')('  ▸ ') +
              chalk.hex('#22d3ee')(toolCall.toolName)
            );
            if (toolResult !== undefined) {
              const resultText = formatToolResult(toolResult.result);
              console.log(
                chalk.hex('#4ade80')('  ✓ ') +
                chalk.hex('#6b7280')(resultText.slice(0, 80) + (resultText.length > 80 ? '...' : ''))
              );
            }
          },
        },
        null
      );

      if (rateLimitState) {
        rateLimitState.count = 0;
      }

      stopSpinnerOnce();

      console.log('\n' + chalk.hex('#374151')('─'.repeat(60)) + '\n');

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
      ).catch(() => {}); // non-fatal
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
  let turnCount = 0;
  let retryCount = 0;
  const rateLimitState = {
    get count() {
      return retryCount;
    },
    set count(value) {
      retryCount = value;
    },
  };

  while (loopState.status !== "complete" && loopState.status !== "failed") {
    turnCount++;
    if (turnCount > CIRCUIT_BREAKER.MAX_TURNS) {
      console.log(chalk.yellow("Agent reached max turns limit. Exiting cleanly."));
      break;
    }

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
      stepResult = await executeStep(loopState, rateLimitState);
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
        await agentTaskService.failTask(loopState.taskId, loopState.finalOutput).catch(() => {});
      }
      break;
    }

    if (stepResult === null) {
      loopState.status = "failed";
      loopState.finalOutput = TerminalReason.RATE_LIMITED;
      logLoop(loopState, "Terminating: rate limit exceeded");
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
      ).catch(() => {}); // non-fatal
    }
  }

  // Persist terminal state
  if (loopState.taskId) {
    if (loopState.status === "complete") {
      await agentTaskService.completeTask(loopState.taskId, loopState.finalOutput).catch(() => {});
    } else if (loopState.status === "failed") {
      await agentTaskService.failTask(loopState.taskId, loopState.finalOutput).catch(() => {});
    }
  }

  return loopState;
}

// ─── Interactive goal loop ────────────────────────────────────────────────────

async function iterativeAgentLoop(conversation, workingDirectory) {
  console.log(
    chalk.hex('#6b7280')(
      'provide a goal  ·  agent will plan and execute up to ' +
      MAX_STEPS + ' steps  ·  "exit" to quit'
    )
  );
  console.log('');

  // ── Read project context once for the entire session ──────────────────────
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
      `Could not read project context: ${err.message} — proceeding without context`
    );
  }

  let isFirstGoal = true;

  while (true) {
    // ── Check for incomplete tasks and offer resume ────────────────────────
    let loopState;

    const incompleteTasks = await agentTaskService
      .getIncompleteTasksForConversation(conversation.id)
      .catch(() => { return []; });

    if (incompleteTasks.length > 0) {
      const task = incompleteTasks[0];
      const lastResult =
        Array.isArray(task.stepResults) && task.stepResults.length > 0
          ? String(task.stepResults[task.stepResults.length - 1]).slice(0, 120)
          : "No steps completed yet";

      console.log('');
      console.log(chalk.hex('#374151')('── interrupted task ' + '─'.repeat(40)));
      console.log(
        chalk.hex('#6b7280')('  goal   ') +
        chalk.hex('#f9fafb')(task.goal)
      );
      console.log(
        chalk.hex('#6b7280')('  steps  ') +
        chalk.hex('#22d3ee')(String(task.currentStep)) +
        chalk.hex('#6b7280')(' / ') +
        chalk.hex('#22d3ee')(String(Array.isArray(task.plan) ? task.plan.length : '?'))
      );
      console.log(
        chalk.hex('#6b7280')('  last   ') +
        chalk.hex('#6b7280')(lastResult + (lastResult.length >= 120 ? '...' : ''))
      );
      console.log('');

      const resumeChoice = await select({
        message: `Resume from step ${task.currentStep + 1} or start a new goal?`,
        options: [
          { value: "resume", label: `Resume from step ${task.currentStep + 1}`, hint: "Continue from where it left off" },
          { value: "new", label: "Start a new goal", hint: "Discard the interrupted task" },
        ],
      });

      if (isCancel(resumeChoice)) {
        console.log(chalk.yellow("\nAgent session cancelled\n"));
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

        console.log(chalk.hex('#4ade80')('resuming from step ' + (task.currentStep + 1)));
        console.log('');

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
            console.log(chalk.hex('#4ade80')('goal accomplished  ·  ready for next goal'));
            console.log('');
          } else {
            console.log(chalk.hex('#facc15')('loop ended  ·  goal not fully completed'));
            console.log('');
          }
        } catch (error) {
          console.log(chalk.hex('#f87171')('error: ' + error.message));
          console.log('');
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
      console.log(chalk.yellow("\nAgent session cancelled\n"));
      process.exit(0);
    }

    if (userInput.trim().toLowerCase() === "exit") {
      console.log(chalk.yellow("\nIterative agent session ended\n"));
      break;
    }

    const goal = userInput.trim();

    // Display the goal
    console.log('');
    console.log(chalk.hex('#38bdf8').bold('you'));
    console.log(
      chalk.hex('#38bdf8')('│ ') +
      chalk.hex('#e2e8f0')(goal)
    );
    console.log('');

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
      .catch(() => { return null; });
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
        console.log(chalk.hex('#4ade80')('goal accomplished  ·  ready for next goal'));
        console.log('');
      } else {
        console.log(chalk.hex('#facc15')('loop ended  ·  goal not fully completed'));
        console.log('');
      }
    } catch (error) {
      console.log(chalk.hex('#f87171')('error: ' + error.message));
      console.log('');
      if (loopState?.taskId) {
        await agentTaskService.failTask(loopState.taskId, error.message).catch(() => {});
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
    const user = await getUserFromToken();

    const conversation = await chatService.getOrCreateConversation(
      user.id,
      conversationId,
      "agent"
    );

    const { activeName, requestedName, isFallback } = getActiveProviderInfo();
    const modelDisplay = isFallback
      ? chalk.hex('#facc15')(activeName + ' (fallback)')
      : chalk.hex('#a78bfa')(activeName);

    console.log(
      chalk.hex('#22d3ee').bold('orbit α') +
      chalk.hex('#374151')(' │ ') +
      modelDisplay +
      chalk.hex('#374151')(' │ ') +
      chalk.hex('#c084fc')('iterative agent') +
      chalk.hex('#374151')(' │ ') +
      chalk.hex('#6b7280')(conversation.id.slice(0, 8)) +
      chalk.hex('#374151')(' │ ') +
      chalk.hex('#4ade80')(workingDirectory)
    );
    console.log(chalk.hex('#1e2230')('─'.repeat(60)));
    console.log('');

    await iterativeAgentLoop(conversation, workingDirectory);

  } catch (error) {
    console.log('');
    console.log(chalk.hex('#f87171')('error: ' + error.message));
  }
}

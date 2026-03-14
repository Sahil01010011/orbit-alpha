import prisma from "../lib/db.js";

/**
 * Service for persisting iterative agent task state to the database.
 * Allows resuming interrupted tasks after crashes, rate-limit errors, or user exits.
 */
export class AgentTaskService {
  /**
   * Create a new AgentTask record at the start of a reasoning loop.
   * @param {string} conversationId - The conversation this task belongs to
   * @param {string} goal - The user's stated goal
   * @returns {Promise<Object>} The created AgentTask record
   */
  async createTask(conversationId, goal) {
    return await prisma.agentTask.create({
      data: {
        conversationId,
        goal,
        plan: [],
        status: "planning",
      },
    });
  }

  /**
   * Update step progress after each loop iteration completes.
   * Stores a full snapshot of the current in-memory state.
   * @param {string} taskId - AgentTask ID
   * @param {number} currentStep - The current step index (next step to execute)
   * @param {Array<string>} stepResults - Full array of all step results so far
   * @param {string} status - Current loop status (planning|acting|reflecting|complete|failed)
   * @param {Array<string>} [plan] - The plan steps (optional, stored after planning phase)
   * @returns {Promise<Object>} Updated AgentTask record
   */
  async updateTaskStep(taskId, currentStep, stepResults, status, plan = undefined) {
    return await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        currentStep,
        stepResults: Array.isArray(stepResults) ? stepResults : [],
        status,
        ...(plan !== undefined && { plan }),
      },
    });
  }

  /**
   * Mark a task as complete with its final output.
   * @param {string} taskId - AgentTask ID
   * @param {string} finalOutput - The assembled final answer
   * @returns {Promise<Object>} Updated AgentTask record
   */
  async completeTask(taskId, finalOutput) {
    return await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        status: "complete",
        finalOutput,
      },
    });
  }

  /**
   * Mark a task as failed with the error message.
   * @param {string} taskId - AgentTask ID
   * @param {string} error - Error message or description
   * @returns {Promise<Object>} Updated AgentTask record
   */
  async failTask(taskId, error) {
    return await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        finalOutput: error,
      },
    });
  }

  /**
   * Retrieve the full state of a task.
   * @param {string} taskId - AgentTask ID
   * @returns {Promise<Object|null>} AgentTask record or null
   */
  async getTask(taskId) {
    return await prisma.agentTask.findUnique({ where: { id: taskId } });
  }

  /**
   * Find any incomplete (non-terminal) tasks for a conversation.
   * Useful for detecting an interrupted session to offer resume.
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Array>} Array of incomplete AgentTask records, newest first
   */
  async getIncompleteTasksForConversation(conversationId) {
    return await prisma.agentTask.findMany({
      where: {
        conversationId,
        status: {
          notIn: ["complete", "failed"],
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}

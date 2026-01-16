import { TaskStateStore } from "../github/state-store";
import { IssueTracker } from "../github/issue-tracker";
import { TaskExecutor, ExecutionResult } from "./task-executor";
import { StartTaskRequest, TaskState } from "../models/task-state";

export interface CreateTaskOptions {
  request: StartTaskRequest;
  userId: string;
  agentId: string;
  stateRepo: string;
}

export interface ContinueTaskOptions {
  taskId: string;
  stateRepo: string;
  userId: string;
  agentId: string;
  additionalPrompt?: string;
  acceptHandoff?: boolean;
}

/**
 * Create and start a new task
 */
export async function createAndStartTask(
  options: CreateTaskOptions
): Promise<{ task: TaskState; result: ExecutionResult }> {
  const { request, userId, agentId, stateRepo } = options;

  // Initialize stores
  const stateStore = new TaskStateStore(stateRepo);
  const issueTracker = new IssueTracker(request.github.repo);

  // Create task in state store
  const task = await stateStore.createTask({
    title: request.title,
    description: request.description,
    github: {
      repo: request.github.repo,
      branch: request.github.branch,
      stateRepo,
    },
    agentId,
    userId,
  });

  // Create GitHub issue if requested
  if (request.github.createIssue) {
    const issueNumber = await issueTracker.createTaskIssue(task);
    await stateStore.updateTask(task.id, {
      github: {
        ...task.github,
        issueNumber,
      },
    });
    task.github.issueNumber = issueNumber;
  }

  // Create executor and run
  const executor = new TaskExecutor({
    taskId: task.id,
    model: request.config?.model || "claude-sonnet-4-5-20250929",
    maxTurns: request.config?.maxTurns || 50,
    stateStore,
    issueTracker,
  });

  const result = await executor.execute(request.prompt);

  // Refresh task state
  const updatedTask = await stateStore.getTask(task.id);

  return {
    task: updatedTask || task,
    result,
  };
}

/**
 * Continue an existing task
 */
export async function continueTask(
  options: ContinueTaskOptions
): Promise<{ task: TaskState; result: ExecutionResult }> {
  const { taskId, stateRepo, userId, agentId, additionalPrompt, acceptHandoff } = options;

  const stateStore = new TaskStateStore(stateRepo);
  const task = await stateStore.getTask(taskId);

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Verify authorization
  if (
    !task.security.allowedAgents.includes("*") &&
    !task.security.allowedAgents.includes(agentId)
  ) {
    throw new Error("Not authorized to continue this task");
  }

  // Accept handoff if requested
  if (acceptHandoff && task.status === "awaiting_handoff") {
    await stateStore.acceptHandoff(taskId, agentId, userId);
  }

  const issueTracker = new IssueTracker(task.github.repo);

  // Create executor and resume
  const executor = new TaskExecutor({
    taskId,
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 50,
    stateStore,
    issueTracker,
  });

  const result = await executor.resume(
    task.session.currentSessionId,
    additionalPrompt
  );

  // Refresh task state
  const updatedTask = await stateStore.getTask(taskId);

  return {
    task: updatedTask || task,
    result,
  };
}

/**
 * Get task status
 */
export async function getTaskStatus(
  taskId: string,
  stateRepo: string
): Promise<TaskState | null> {
  const stateStore = new TaskStateStore(stateRepo);
  return stateStore.getTask(taskId);
}

/**
 * List all tasks
 */
export async function listTasks(
  stateRepo: string
): Promise<Array<{ id: string; title: string; status: string }>> {
  const stateStore = new TaskStateStore(stateRepo);
  return stateStore.listTasks();
}

export { TaskExecutor } from "./task-executor";
export type { ExecutionResult } from "./task-executor";
export { SessionManager } from "./session-manager";

import { getOctokit, parseRepoString } from "./client";
import {
  TaskState,
  TaskStateSchema,
  FileModification,
  ConversationMessage,
  HandoffRecord,
} from "../models/task-state";
import { v4 as uuidv4 } from "uuid";

const BASE_PATH = ".task-handoff";

export class TaskStateStore {
  private owner: string;
  private repo: string;

  constructor(stateRepoFullName: string) {
    const { owner, repo } = parseRepoString(stateRepoFullName);
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Create a new task and persist to GitHub
   */
  async createTask(params: {
    id?: string;
    title: string;
    description: string;
    github: {
      repo: string;
      branch: string;
      stateRepo?: string;
    };
    agentId: string;
    userId: string;
  }): Promise<TaskState> {
    const now = new Date().toISOString();
    const taskId = params.id || uuidv4();

    const taskState: TaskState = {
      id: taskId,
      version: 1,
      title: params.title,
      description: params.description,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      github: {
        repo: params.github.repo,
        branch: params.github.branch,
        stateRepo: params.github.stateRepo || `${this.owner}/${this.repo}`,
      },
      session: {
        currentSessionId: "",
        transcriptPath: `${BASE_PATH}/tasks/${taskId}/transcript.json`,
      },
      context: {
        conversationHistory: [],
      },
      progress: {
        currentPhase: "initialization",
        checkpoints: [],
        percentComplete: 0,
      },
      files: {
        modifications: [],
        workingDirectory: ".",
      },
      handoffs: [
        {
          fromAgent: {
            userId: params.userId,
            agentId: params.agentId,
            sessionId: "",
            startedAt: now,
          },
          handoffAt: now,
          reason: "Task created",
          instructions: "Initial task creation",
        },
      ],
      nextSteps: {
        immediate: ["Analyze task requirements", "Plan implementation approach"],
        considerations: [],
        blockers: [],
        resources: [],
      },
      security: {
        allowedAgents: ["*"],
        requireApproval: false,
      },
    };

    // Validate schema
    TaskStateSchema.parse(taskState);

    // Save to GitHub
    await this.saveTaskState(taskState);

    // Update task index
    await this.addToIndex(taskId, params.title);

    return taskState;
  }

  /**
   * Get task state from GitHub
   */
  async getTask(taskId: string): Promise<TaskState | null> {
    try {
      const octokit = getOctokit();
      const path = `${BASE_PATH}/tasks/${taskId}/state.json`;

      const { data } = await octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
      });

      if ("content" in data) {
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        return TaskStateSchema.parse(JSON.parse(content));
      }
      return null;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "status" in error && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update task state with optimistic concurrency
   */
  async updateTask(
    taskId: string,
    updates: Partial<TaskState>
  ): Promise<TaskState> {
    const current = await this.getTask(taskId);
    if (!current) {
      throw new Error("Task not found");
    }

    const updated: TaskState = {
      ...current,
      ...updates,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };

    // Validate before saving
    TaskStateSchema.parse(updated);

    await this.saveTaskState(updated);
    return updated;
  }

  /**
   * Update session ID
   */
  async updateSessionId(taskId: string, sessionId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error("Task not found");

    task.session.currentSessionId = sessionId;
    task.status = "in_progress";

    // Also update the current handoff's session
    const currentHandoff = task.handoffs[task.handoffs.length - 1];
    if (currentHandoff?.fromAgent) {
      currentHandoff.fromAgent.sessionId = sessionId;
    }

    await this.saveTaskState(task);
  }

  /**
   * Add a file modification record
   */
  async addFileModification(
    taskId: string,
    modification: FileModification
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error("Task not found");

    task.files.modifications.push(modification);
    task.updatedAt = new Date().toISOString();
    await this.saveTaskState(task);
  }

  /**
   * Add conversation message
   */
  async addConversationMessage(
    taskId: string,
    message: ConversationMessage
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error("Task not found");

    task.context.conversationHistory.push(message);

    // Compact if history gets too long
    if (task.context.conversationHistory.length > 50) {
      await this.compactHistory(task);
    }

    task.updatedAt = new Date().toISOString();
    await this.saveTaskState(task);
  }

  /**
   * Update progress
   */
  async updateProgress(
    taskId: string,
    progress: Partial<TaskState["progress"]>
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error("Task not found");

    task.progress = { ...task.progress, ...progress };
    task.updatedAt = new Date().toISOString();
    await this.saveTaskState(task);
  }

  /**
   * Update next steps
   */
  async updateNextSteps(
    taskId: string,
    nextSteps: Partial<TaskState["nextSteps"]>
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error("Task not found");

    task.nextSteps = { ...task.nextSteps, ...nextSteps };
    task.updatedAt = new Date().toISOString();
    await this.saveTaskState(task);
  }

  /**
   * Initiate handoff
   */
  async initiateHandoff(
    taskId: string,
    handoff: Omit<HandoffRecord, "toAgent">
  ): Promise<TaskState> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error("Task not found");

    task.status = "awaiting_handoff";
    task.handoffs.push(handoff);
    task.updatedAt = new Date().toISOString();

    await this.saveTaskState(task);
    return task;
  }

  /**
   * Accept handoff
   */
  async acceptHandoff(
    taskId: string,
    agentId: string,
    userId: string
  ): Promise<TaskState> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error("Task not found");

    const lastHandoff = task.handoffs[task.handoffs.length - 1];
    if (!lastHandoff) throw new Error("No handoff record found");

    lastHandoff.toAgent = {
      userId,
      agentId,
      sessionId: "",
      startedAt: new Date().toISOString(),
    };

    task.status = "handed_off";
    task.updatedAt = new Date().toISOString();

    await this.saveTaskState(task);
    return task;
  }

  /**
   * Mark task as completed
   */
  async completeTask(taskId: string): Promise<TaskState> {
    return this.updateTask(taskId, {
      status: "completed",
      progress: {
        currentPhase: "completed",
        checkpoints: [],
        percentComplete: 100,
      },
    });
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<Array<{ id: string; title: string; status: string }>> {
    try {
      const octokit = getOctokit();
      const path = `${BASE_PATH}/index.json`;

      const { data } = await octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
      });

      if ("content" in data) {
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        return JSON.parse(content).tasks || [];
      }
      return [];
    } catch (error: unknown) {
      if (error && typeof error === "object" && "status" in error && error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  private async saveTaskState(state: TaskState): Promise<void> {
    const octokit = getOctokit();
    const path = `${BASE_PATH}/tasks/${state.id}/state.json`;
    const content = Buffer.from(JSON.stringify(state, null, 2)).toString(
      "base64"
    );

    try {
      // Get current file SHA if it exists
      let sha: string | undefined;
      try {
        const { data: existing } = await octokit.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path,
        });
        if ("sha" in existing) {
          sha = existing.sha;
        }
      } catch {
        // File doesn't exist yet
      }

      await octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path,
        message: `[Task Handoff] Update task ${state.id} - v${state.version} - ${state.status}`,
        content,
        sha,
      });
    } catch (error) {
      console.error("Failed to save task state:", error);
      throw error;
    }
  }

  private async addToIndex(taskId: string, title: string): Promise<void> {
    const octokit = getOctokit();
    const path = `${BASE_PATH}/index.json`;

    let index: { tasks: Array<{ id: string; title: string; createdAt: string }> } = {
      tasks: [],
    };
    let sha: string | undefined;

    try {
      const { data } = await octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
      });
      if ("content" in data && "sha" in data) {
        index = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
        sha = data.sha;
      }
    } catch {
      // Index doesn't exist yet
    }

    index.tasks.push({
      id: taskId,
      title,
      createdAt: new Date().toISOString(),
    });

    const content = Buffer.from(JSON.stringify(index, null, 2)).toString("base64");

    await octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message: `[Task Handoff] Add task ${taskId} to index`,
      content,
      sha,
    });
  }

  private async compactHistory(task: TaskState): Promise<void> {
    const toCompact = task.context.conversationHistory.slice(0, -20);
    const toKeep = task.context.conversationHistory.slice(-20);

    const summary = toCompact
      .map((m) => `[${m.role}]: ${m.content.substring(0, 100)}...`)
      .join("\n");

    task.context.compactedSummary =
      (task.context.compactedSummary || "") + "\n\n---\n" + summary;
    task.context.conversationHistory = toKeep;
  }
}

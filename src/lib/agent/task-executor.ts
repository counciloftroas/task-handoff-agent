import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { TaskStateStore } from "../github/state-store";
import { IssueTracker } from "../github/issue-tracker";
import { SessionManager } from "./session-manager";
import { TaskState } from "../models/task-state";

export interface TaskExecutorConfig {
  taskId: string;
  model: string;
  maxTurns: number;
  stateStore: TaskStateStore;
  issueTracker?: IssueTracker;
}

export interface ExecutionResult {
  sessionId: string;
  status: TaskState["status"];
  progress: number;
  result?: string;
  error?: string;
}

export class TaskExecutor {
  private sessionManager: SessionManager;

  constructor(private config: TaskExecutorConfig) {
    this.sessionManager = new SessionManager({
      model: config.model,
    });
  }

  /**
   * Execute a new task
   */
  async execute(prompt: string): Promise<ExecutionResult> {
    const taskState = await this.config.stateStore.getTask(this.config.taskId);
    if (!taskState) {
      throw new Error("Task not found");
    }

    const sessionId = uuidv4();
    this.sessionManager.setSessionId(sessionId);

    // Update task with session ID
    await this.config.stateStore.updateSessionId(this.config.taskId, sessionId);

    const systemPrompt = this.sessionManager.buildSystemPrompt(taskState);

    try {
      const result = await generateText({
        model: anthropic(this.config.model),
        system: systemPrompt,
        prompt,
        tools: this.createTools(),
      });

      // Update final state
      await this.config.stateStore.updateTask(this.config.taskId, {
        status: "in_progress",
      });

      // Add conversation to history
      await this.config.stateStore.addConversationMessage(this.config.taskId, {
        role: "assistant",
        content: result.text,
        timestamp: new Date().toISOString(),
      });

      return {
        sessionId,
        status: "in_progress",
        progress: taskState.progress.percentComplete,
        result: result.text,
      };
    } catch (error) {
      console.error("Task execution error:", error);
      await this.config.stateStore.updateTask(this.config.taskId, {
        status: "failed",
      });

      return {
        sessionId,
        status: "failed",
        progress: taskState.progress.percentComplete,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Resume an existing task
   */
  async resume(
    sessionId: string,
    additionalPrompt?: string
  ): Promise<ExecutionResult> {
    const taskState = await this.config.stateStore.getTask(this.config.taskId);
    if (!taskState) {
      throw new Error("Task not found");
    }

    this.sessionManager.setSessionId(sessionId);

    const resumptionPrompt = this.sessionManager.buildResumptionPrompt(
      taskState,
      additionalPrompt
    );

    const systemPrompt = this.sessionManager.buildSystemPrompt(taskState);

    try {
      const result = await generateText({
        model: anthropic(this.config.model),
        system: systemPrompt,
        prompt: resumptionPrompt,
        tools: this.createTools(),
      });

      // Update state
      await this.config.stateStore.updateTask(this.config.taskId, {
        status: "in_progress",
      });

      // Add to conversation history
      await this.config.stateStore.addConversationMessage(this.config.taskId, {
        role: "assistant",
        content: result.text,
        timestamp: new Date().toISOString(),
      });

      return {
        sessionId,
        status: "in_progress",
        progress: taskState.progress.percentComplete,
        result: result.text,
      };
    } catch (error) {
      console.error("Task resume error:", error);
      return {
        sessionId,
        status: "failed",
        progress: taskState.progress.percentComplete,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Create tools available to the agent
   */
  private createTools() {
    const stateStore = this.config.stateStore;
    const taskId = this.config.taskId;
    const issueTracker = this.config.issueTracker;
    const sessionManager = this.sessionManager;

    return {
      updateProgress: tool({
        description: "Update the task progress with current phase and percentage",
        inputSchema: z.object({
          phase: z.string(),
          percentComplete: z.number(),
          completedSteps: z.array(z.string()),
          remainingSteps: z.array(z.string()),
        }),
        execute: async (input: { phase: string; percentComplete: number; completedSteps: string[]; remainingSteps: string[] }) => {
          await stateStore.updateProgress(taskId, {
            currentPhase: input.phase,
            percentComplete: input.percentComplete,
            checkpoints: [
              {
                id: uuidv4(),
                timestamp: new Date().toISOString(),
                description: `Progress update: ${input.phase}`,
                completedSteps: input.completedSteps,
                remainingSteps: input.remainingSteps,
              },
            ],
          });
          return { success: true, message: `Progress updated to ${input.percentComplete}%` };
        },
      }),

      updateNextSteps: tool({
        description: "Update the next steps for the task",
        inputSchema: z.object({
          immediate: z.array(z.string()),
          considerations: z.array(z.string()),
          blockers: z.array(z.string()),
        }),
        execute: async (input: { immediate: string[]; considerations: string[]; blockers: string[] }) => {
          await stateStore.updateNextSteps(taskId, {
            immediate: input.immediate,
            considerations: input.considerations,
            blockers: input.blockers,
          });
          return { success: true, message: "Next steps updated" };
        },
      }),

      recordFileChange: tool({
        description: "Record a file modification made during the task",
        inputSchema: z.object({
          path: z.string(),
          action: z.enum(["created", "modified", "deleted"]),
          summary: z.string(),
        }),
        execute: async (input: { path: string; action: "created" | "modified" | "deleted"; summary: string }) => {
          await stateStore.addFileModification(taskId, {
            path: input.path,
            action: input.action,
            currentHash: "",
            summary: input.summary,
          });
          return { success: true, message: `Recorded ${input.action} for ${input.path}` };
        },
      }),

      requestHandoff: tool({
        description: "Request a handoff to another agent when you need to stop or need different expertise",
        inputSchema: z.object({
          reason: z.enum([
            "task_complete_phase",
            "expertise_needed",
            "time_limit",
            "user_request",
            "error_recovery",
          ]),
          instructions: z.string(),
          urgency: z.enum(["low", "medium", "high", "critical"]),
        }),
        execute: async (input: { reason: string; instructions: string; urgency: string }) => {
          const task = await stateStore.getTask(taskId);
          if (!task) throw new Error("Task not found");

          const lastHandoff = task.handoffs[task.handoffs.length - 1];

          await stateStore.initiateHandoff(taskId, {
            fromAgent: lastHandoff?.fromAgent || {
              userId: "unknown",
              agentId: "unknown",
              sessionId: sessionManager.getSessionId() || "",
              startedAt: new Date().toISOString(),
            },
            handoffAt: new Date().toISOString(),
            reason: input.reason,
            instructions: input.instructions,
          });

          // Post to GitHub issue if available
          if (issueTracker && task.github.issueNumber) {
            await issueTracker.addHandoffComment(task.github.issueNumber, {
              taskId,
              fromAgentId: lastHandoff?.fromAgent.agentId || "unknown",
              reason: input.reason as "task_complete_phase" | "expertise_needed" | "time_limit" | "user_request" | "error_recovery",
              instructions: input.instructions,
              urgency: input.urgency as "low" | "medium" | "high" | "critical",
            });
          }

          return {
            success: true,
            message: `Handoff requested: ${input.reason}. Task is now awaiting pickup by another agent.`,
          };
        },
      }),
    };
  }

  /**
   * Handle step finish for logging/tracking
   */
  private async handleStepFinish(
    step: { toolCalls?: Array<{ toolName: string; args: unknown }> },
    taskState: TaskState
  ): Promise<void> {
    if (step.toolCalls) {
      for (const toolCall of step.toolCalls) {
        console.log(`Tool called: ${toolCall.toolName}`, toolCall.args);
      }
    }
  }
}

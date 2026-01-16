import { TaskState } from "../models/task-state";

export interface SerializedSession {
  version: number;
  sessionId: string;
  conversationHistory: TaskState["context"]["conversationHistory"];
  compactedSummary?: string;
  lastCheckpoint?: TaskState["progress"]["checkpoints"][0];
  nextSteps: TaskState["nextSteps"];
  filesModified: TaskState["files"]["modifications"];
}

export class SessionManager {
  private sessionId: string | null = null;

  constructor(
    private config: {
      model: string;
      systemPrompt?: string;
    }
  ) {}

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Serialize session state for GitHub storage
   */
  serializeForHandoff(taskState: TaskState): string {
    const handoffData: SerializedSession = {
      version: 1,
      sessionId: this.sessionId || taskState.session.currentSessionId,
      conversationHistory: taskState.context.conversationHistory,
      compactedSummary: taskState.context.compactedSummary,
      lastCheckpoint:
        taskState.progress.checkpoints[
          taskState.progress.checkpoints.length - 1
        ],
      nextSteps: taskState.nextSteps,
      filesModified: taskState.files.modifications,
    };

    return JSON.stringify(handoffData, null, 2);
  }

  /**
   * Deserialize session state from GitHub
   */
  static deserializeFromHandoff(data: string): SerializedSession {
    return JSON.parse(data) as SerializedSession;
  }

  /**
   * Build context prompt for resumed session
   */
  buildResumptionPrompt(taskState: TaskState, additionalInstructions?: string): string {
    const lastCheckpoint =
      taskState.progress.checkpoints[
        taskState.progress.checkpoints.length - 1
      ];

    const lastHandoff = taskState.handoffs[taskState.handoffs.length - 1];

    let prompt = `## Task Resumption Context

You are continuing a task that was previously worked on${lastHandoff?.fromAgent.agentId ? ` by agent ${lastHandoff.fromAgent.agentId}` : ""}.

### Task: ${taskState.title}
${taskState.description}

### Current Status
- **Phase:** ${taskState.progress.currentPhase}
- **Progress:** ${taskState.progress.percentComplete}% complete
- **Status:** ${taskState.status}

`;

    if (lastCheckpoint) {
      prompt += `### Last Checkpoint
**${lastCheckpoint.description}** (${lastCheckpoint.timestamp})

#### Completed Steps:
${lastCheckpoint.completedSteps.map((s) => `- ${s}`).join("\n") || "- None recorded"}

#### Remaining Steps:
${lastCheckpoint.remainingSteps.map((s) => `- ${s}`).join("\n") || "- To be determined"}

`;
    }

    if (taskState.files.modifications.length > 0) {
      prompt += `### Files Modified:
${taskState.files.modifications.map((f) => `- \`${f.path}\` (${f.action}): ${f.summary}`).join("\n")}

`;
    }

    prompt += `### Immediate Next Steps:
${taskState.nextSteps.immediate.map((s, i) => `${i + 1}. ${s}`).join("\n") || "- To be determined"}

`;

    if (taskState.nextSteps.considerations.length > 0) {
      prompt += `### Important Considerations:
${taskState.nextSteps.considerations.map((c) => `- ${c}`).join("\n")}

`;
    }

    if (taskState.nextSteps.blockers.length > 0) {
      prompt += `### Known Blockers:
${taskState.nextSteps.blockers.map((b) => `- ${b}`).join("\n")}

`;
    }

    if (lastHandoff?.instructions && lastHandoff.instructions !== "Initial task creation") {
      prompt += `### Handoff Instructions from Previous Agent:
${lastHandoff.instructions}

`;
    }

    if (taskState.context.compactedSummary) {
      prompt += `### Previous Conversation Summary:
${taskState.context.compactedSummary}

`;
    }

    if (additionalInstructions) {
      prompt += `### Additional Instructions:
${additionalInstructions}

`;
    }

    prompt += `---
Please review this context and continue working on the task. Start by confirming your understanding of the current state, then proceed with the next steps.`;

    return prompt;
  }

  /**
   * Build initial system prompt for a new task
   */
  buildSystemPrompt(taskState: TaskState): string {
    return `You are a collaborative AI agent working on a task that may be handed off to other agents.

## Your Responsibilities:
1. Work on the assigned task efficiently
2. Keep clear records of your progress and decisions
3. When you reach a natural stopping point or need expertise you don't have, prepare for handoff
4. Document next steps clearly for the next agent

## Task Context:
- **Task ID:** ${taskState.id}
- **Repository:** ${taskState.github.repo}
- **Branch:** ${taskState.github.branch}

## Important Guidelines:
- Always explain your reasoning before making changes
- Document any assumptions you make
- If you encounter blockers, note them clearly
- Keep the next steps list updated as you work
- When ready to handoff, clearly state what's done and what remains

${this.config.systemPrompt || ""}`;
  }

  /**
   * Build handoff summary for the next agent
   */
  buildHandoffSummary(
    taskState: TaskState,
    reason: string,
    instructions: string
  ): string {
    return `## Handoff Summary

**Task:** ${taskState.title}
**Reason for Handoff:** ${reason}

### Work Completed:
${taskState.progress.checkpoints
  .flatMap((cp) => cp.completedSteps)
  .map((s) => `- ${s}`)
  .join("\n") || "- See conversation history"}

### Current State:
- Phase: ${taskState.progress.currentPhase}
- Progress: ${taskState.progress.percentComplete}%

### Files Modified:
${taskState.files.modifications.map((f) => `- \`${f.path}\`: ${f.summary}`).join("\n") || "- None"}

### Next Steps:
${taskState.nextSteps.immediate.map((s, i) => `${i + 1}. ${s}`).join("\n")}

### Blockers:
${taskState.nextSteps.blockers.map((b) => `- ${b}`).join("\n") || "- None"}

### Instructions for Next Agent:
${instructions}
`;
  }
}

import { getOctokit, parseRepoString } from "./client";
import { TaskState, HandoffRequest } from "../models/task-state";

export class IssueTracker {
  private owner: string;
  private repo: string;

  constructor(repoFullName: string) {
    const { owner, repo } = parseRepoString(repoFullName);
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Create a GitHub issue for a new task
   */
  async createTaskIssue(task: TaskState): Promise<number> {
    const octokit = getOctokit();

    const body = `## Task Handoff Agent

**Task ID:** \`${task.id}\`
**Status:** ${task.status}
**Created:** ${task.createdAt}

### Description
${task.description}

### Progress
- Phase: ${task.progress.currentPhase}
- Completion: ${task.progress.percentComplete}%

---
*This issue is managed by the Task Handoff Agent system.*
*State is stored in: \`${task.github.stateRepo}\`*
`;

    const { data } = await octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: `[Task Handoff] ${task.title}`,
      body,
      labels: ["task-handoff", "automated"],
    });

    return data.number;
  }

  /**
   * Update issue with current task status
   */
  async updateTaskIssue(task: TaskState): Promise<void> {
    if (!task.github.issueNumber) return;

    const octokit = getOctokit();

    const body = `## Task Handoff Agent

**Task ID:** \`${task.id}\`
**Status:** ${task.status}
**Last Updated:** ${task.updatedAt}

### Description
${task.description}

### Progress
- Phase: ${task.progress.currentPhase}
- Completion: ${task.progress.percentComplete}%

### Next Steps
${task.nextSteps.immediate.map((s) => `- [ ] ${s}`).join("\n")}

### Considerations
${task.nextSteps.considerations.map((c) => `- ${c}`).join("\n") || "_None_"}

### Blockers
${task.nextSteps.blockers.map((b) => `- ${b}`).join("\n") || "_None_"}

### File Modifications
${task.files.modifications.map((f) => `- \`${f.path}\` (${f.action}): ${f.summary}`).join("\n") || "_None yet_"}

### Handoff History
${task.handoffs
  .map(
    (h, i) =>
      `${i + 1}. **${h.reason}** at ${h.handoffAt}\n   - From: ${h.fromAgent.agentId}\n   - To: ${h.toAgent?.agentId || "_Awaiting_"}`
  )
  .join("\n")}

---
*This issue is managed by the Task Handoff Agent system.*
*State repo: \`${task.github.stateRepo}\`*
`;

    await octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: task.github.issueNumber,
      body,
    });
  }

  /**
   * Add a handoff comment to the issue
   */
  async addHandoffComment(
    issueNumber: number,
    handoff: HandoffRequest
  ): Promise<void> {
    const octokit = getOctokit();

    const urgencyEmoji = {
      low: "",
      medium: "",
      high: "",
      critical: "",
    };

    const body = `## ${urgencyEmoji[handoff.urgency]} Handoff Initiated

**Reason:** ${handoff.reason.replace(/_/g, " ")}
**Urgency:** ${handoff.urgency}
**Target Agent:** ${handoff.targetAgentId || "_Open for any agent_"}

### Instructions for Next Agent
${handoff.instructions}

---
To accept this handoff, use:
\`\`\`bash
task-handoff continue ${handoff.taskId} --accept-handoff
\`\`\`

Or via API:
\`\`\`json
POST /api/agent/continue
{
  "taskId": "${handoff.taskId}",
  "acceptHandoff": true
}
\`\`\`
`;

    await octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });
  }

  /**
   * Add a progress comment
   */
  async addProgressComment(
    issueNumber: number,
    message: string,
    agentId: string
  ): Promise<void> {
    const octokit = getOctokit();

    const body = `### Progress Update
**Agent:** \`${agentId}\`
**Time:** ${new Date().toISOString()}

${message}
`;

    await octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });
  }

  /**
   * Close the issue when task is completed
   */
  async closeTaskIssue(issueNumber: number, summary: string): Promise<void> {
    const octokit = getOctokit();

    await octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: `## Task Completed\n\n${summary}`,
    });

    await octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: "closed",
    });
  }
}

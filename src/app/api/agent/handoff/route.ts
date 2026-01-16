import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TaskStateStore } from "@/lib/github/state-store";
import { IssueTracker } from "@/lib/github/issue-tracker";
import { HandoffRequestSchema } from "@/lib/models/task-state";
import { validateAuth, getAuthInfo } from "@/lib/utils/auth";

const DEFAULT_STATE_REPO = process.env.DEFAULT_STATE_REPO || "counciloftroas/task-handoff-state";

export async function POST(request: NextRequest) {
  try {
    // Validate auth
    const authResult = await validateAuth(request);
    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error || "Unauthorized" },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const handoffRequest = HandoffRequestSchema.parse(body);

    // Get state repo from query or default
    const stateRepo =
      request.nextUrl.searchParams.get("stateRepo") || DEFAULT_STATE_REPO;

    const { userId, agentId } = getAuthInfo(request);

    // Get task state
    const stateStore = new TaskStateStore(stateRepo);
    const task = await stateStore.getTask(handoffRequest.taskId);

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Verify the requesting agent has permission
    const currentHandoff = task.handoffs[task.handoffs.length - 1];
    if (
      currentHandoff?.fromAgent.agentId !== agentId &&
      currentHandoff?.fromAgent.agentId !== handoffRequest.fromAgentId
    ) {
      // Allow if agent is in allowed list
      if (
        !task.security.allowedAgents.includes("*") &&
        !task.security.allowedAgents.includes(agentId)
      ) {
        return NextResponse.json(
          { error: "Not authorized to handoff this task" },
          { status: 403 }
        );
      }
    }

    // Update task state for handoff
    await stateStore.initiateHandoff(handoffRequest.taskId, {
      fromAgent: {
        userId,
        agentId: handoffRequest.fromAgentId,
        sessionId: task.session.currentSessionId,
        startedAt: currentHandoff?.fromAgent.startedAt || task.createdAt,
        endedAt: new Date().toISOString(),
      },
      handoffAt: new Date().toISOString(),
      reason: handoffRequest.reason,
      instructions: handoffRequest.instructions,
    });

    // Create GitHub issue comment for visibility
    if (task.github.issueNumber) {
      const issueTracker = new IssueTracker(task.github.repo);
      await issueTracker.addHandoffComment(
        task.github.issueNumber,
        handoffRequest
      );
    }

    return NextResponse.json({
      success: true,
      taskId: handoffRequest.taskId,
      status: "awaiting_handoff",
      handoffUrl: task.github.issueNumber
        ? `https://github.com/${task.github.repo}/issues/${task.github.issueNumber}`
        : undefined,
      message: "Handoff initiated. Task is now awaiting pickup by another agent.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Handoff error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

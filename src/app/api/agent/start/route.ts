import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAndStartTask } from "@/lib/agent";
import { StartTaskRequestSchema } from "@/lib/models/task-state";
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
    const parsed = StartTaskRequestSchema.parse(body);

    // Get user/agent info
    const { userId, agentId } = getAuthInfo(request);

    // Determine state repo
    const stateRepo = parsed.github.stateRepo || DEFAULT_STATE_REPO;

    // Create and start task
    const { task, result } = await createAndStartTask({
      request: parsed,
      userId,
      agentId,
      stateRepo,
    });

    return NextResponse.json({
      success: true,
      taskId: task.id,
      sessionId: result.sessionId,
      status: result.status,
      progress: result.progress,
      issueUrl: task.github.issueNumber
        ? `https://github.com/${parsed.github.repo}/issues/${task.github.issueNumber}`
        : undefined,
      stateUrl: `https://github.com/${stateRepo}/blob/main/.task-handoff/tasks/${task.id}/state.json`,
      result: result.result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Start task error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

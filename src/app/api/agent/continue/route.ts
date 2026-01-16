import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { continueTask } from "@/lib/agent";
import { ContinueTaskRequestSchema } from "@/lib/models/task-state";
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
    const parsed = ContinueTaskRequestSchema.parse(body);

    // Get state repo from query or default
    const stateRepo =
      request.nextUrl.searchParams.get("stateRepo") || DEFAULT_STATE_REPO;

    // Get user/agent info
    const { userId, agentId } = getAuthInfo(request);

    // Continue task
    const { task, result } = await continueTask({
      taskId: parsed.taskId,
      stateRepo,
      userId,
      agentId,
      additionalPrompt: parsed.prompt,
      acceptHandoff: parsed.acceptHandoff,
    });

    return NextResponse.json({
      success: true,
      taskId: task.id,
      sessionId: result.sessionId,
      status: result.status,
      progress: result.progress,
      handoffAccepted: parsed.acceptHandoff,
      result: result.result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Continue task error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

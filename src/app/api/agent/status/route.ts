import { NextRequest, NextResponse } from "next/server";
import { getTaskStatus, listTasks } from "@/lib/agent";
import { validateAuth } from "@/lib/utils/auth";

const DEFAULT_STATE_REPO = process.env.DEFAULT_STATE_REPO || "counciloftroas/task-handoff-state";

export async function GET(request: NextRequest) {
  try {
    // Validate auth
    const authResult = await validateAuth(request);
    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error || "Unauthorized" },
        { status: 401 }
      );
    }

    const taskId = request.nextUrl.searchParams.get("taskId");
    const stateRepo =
      request.nextUrl.searchParams.get("stateRepo") || DEFAULT_STATE_REPO;

    // If taskId provided, get specific task
    if (taskId) {
      const task = await getTaskStatus(taskId, stateRepo);

      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          progress: task.progress,
          nextSteps: task.nextSteps,
          github: {
            repo: task.github.repo,
            issueNumber: task.github.issueNumber,
            issueUrl: task.github.issueNumber
              ? `https://github.com/${task.github.repo}/issues/${task.github.issueNumber}`
              : undefined,
          },
          handoffs: task.handoffs.length,
          lastHandoff: task.handoffs[task.handoffs.length - 1],
          files: task.files.modifications.length,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        },
      });
    }

    // Otherwise, list all tasks
    const tasks = await listTasks(stateRepo);

    return NextResponse.json({
      success: true,
      tasks,
      stateRepo,
    });
  } catch (error) {
    console.error("Status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

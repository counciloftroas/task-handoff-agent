import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { TaskStateStore } from "@/lib/github/state-store";

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const DEFAULT_STATE_REPO = process.env.DEFAULT_STATE_REPO || "counciloftroas/task-handoff-state";

/**
 * Verify GitHub webhook signature
 */
function verifySignature(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn("GITHUB_WEBHOOK_SECRET not set, skipping verification");
    return true;
  }

  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  hmac.update(payload);
  const digest = `sha256=${hmac.digest("hex")}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-hub-signature-256") || "";
    const event = request.headers.get("x-github-event") || "";
    const payload = await request.text();

    // Verify signature
    if (!verifySignature(payload, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const data = JSON.parse(payload);

    // Handle different event types
    switch (event) {
      case "issue_comment":
        await handleIssueComment(data);
        break;

      case "issues":
        await handleIssueEvent(data);
        break;

      default:
        console.log(`Unhandled event type: ${event}`);
    }

    return NextResponse.json({ success: true, event });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing failed" },
      { status: 500 }
    );
  }
}

/**
 * Handle issue comment events
 * Used to detect commands like "/accept-handoff"
 */
async function handleIssueComment(data: {
  action: string;
  issue: { number: number; title: string; body: string };
  comment: { body: string; user: { login: string } };
  repository: { full_name: string };
}) {
  if (data.action !== "created") return;

  const comment = data.comment.body.trim().toLowerCase();

  // Check for accept handoff command
  if (comment.startsWith("/accept-handoff") || comment.startsWith("/accept")) {
    const taskIdMatch = data.issue.body.match(/Task ID:\s*`([^`]+)`/);
    if (!taskIdMatch) {
      console.log("Could not find task ID in issue body");
      return;
    }

    const taskId = taskIdMatch[1];
    console.log(`Handoff acceptance requested for task ${taskId} by ${data.comment.user.login}`);

    // In a full implementation, this would:
    // 1. Verify the user has permission
    // 2. Update the task state
    // 3. Potentially trigger the agent to continue
  }

  // Check for status command
  if (comment === "/status") {
    console.log("Status requested for issue", data.issue.number);
    // Could post a comment with current task status
  }
}

/**
 * Handle issue events (labeled, closed, etc.)
 */
async function handleIssueEvent(data: {
  action: string;
  issue: { number: number; title: string; body: string; labels?: Array<{ name: string }> };
  repository: { full_name: string };
  label?: { name: string };
}) {
  // Handle "ready-for-handoff" label
  if (data.action === "labeled" && data.label?.name === "ready-for-handoff") {
    console.log(`Issue ${data.issue.number} labeled for handoff`);
    // Could notify waiting agents or update task state
  }

  // Handle issue closed
  if (data.action === "closed") {
    const taskIdMatch = data.issue.body?.match(/Task ID:\s*`([^`]+)`/);
    if (taskIdMatch) {
      const taskId = taskIdMatch[1];
      console.log(`Task ${taskId} issue was closed`);

      // Update task state to completed/cancelled
      try {
        const stateStore = new TaskStateStore(DEFAULT_STATE_REPO);
        await stateStore.updateTask(taskId, {
          status: "completed",
        });
      } catch (error) {
        console.error("Failed to update task state:", error);
      }
    }
  }
}

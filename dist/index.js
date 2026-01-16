#!/usr/bin/env node
"use strict";
/**
 * Task Handoff Agent CLI
 *
 * Usage:
 *   npx task-handoff start --title "Task name" --prompt "What to do"
 *   npx task-handoff continue <taskId> [--accept-handoff]
 *   npx task-handoff handoff <taskId> --reason "expertise_needed" --instructions "Next steps"
 *   npx task-handoff status [taskId]
 */
const API_BASE = process.env.TASK_HANDOFF_API || "http://localhost:3000";
const STATE_REPO = process.env.STATE_REPO || "counciloftroas/task-handoff-state";
async function apiRequest(endpoint, method, body) {
    const token = process.env.TASK_HANDOFF_TOKEN;
    const headers = {
        "Content-Type": "application/json",
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return fetch(`${API_BASE}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
}
async function startTask(options) {
    console.log(`Starting task: ${options.title}`);
    const response = await apiRequest("/api/agent/start", "POST", {
        title: options.title,
        description: options.description || options.title,
        prompt: options.prompt,
        github: {
            repo: options.repo,
            branch: options.branch || "main",
            stateRepo: STATE_REPO,
            createIssue: !options.noIssue,
        },
    });
    const data = await response.json();
    if (!response.ok) {
        console.error("Failed to start task:", data.error);
        process.exit(1);
    }
    console.log("\n Task started successfully!");
    console.log(`   Task ID: ${data.taskId}`);
    console.log(`   Session: ${data.sessionId}`);
    console.log(`   Status: ${data.status}`);
    if (data.issueUrl) {
        console.log(`   Issue: ${data.issueUrl}`);
    }
    console.log(`   State: ${data.stateUrl}`);
    if (data.result) {
        console.log("\n Agent Response:");
        console.log("─".repeat(50));
        console.log(data.result);
    }
}
async function continueTask(options) {
    console.log(`Continuing task: ${options.taskId}`);
    if (options.acceptHandoff) {
        console.log("   Accepting handoff...");
    }
    const response = await apiRequest(`/api/agent/continue?stateRepo=${STATE_REPO}`, "POST", {
        taskId: options.taskId,
        prompt: options.prompt,
        acceptHandoff: options.acceptHandoff,
    });
    const data = await response.json();
    if (!response.ok) {
        console.error("Failed to continue task:", data.error);
        process.exit(1);
    }
    console.log("\n Task continued successfully!");
    console.log(`   Status: ${data.status}`);
    console.log(`   Progress: ${data.progress}%`);
    if (data.result) {
        console.log("\n Agent Response:");
        console.log("─".repeat(50));
        console.log(data.result);
    }
}
async function initiateHandoff(options) {
    console.log(`Initiating handoff for task: ${options.taskId}`);
    const response = await apiRequest(`/api/agent/handoff?stateRepo=${STATE_REPO}`, "POST", {
        taskId: options.taskId,
        fromAgentId: "cli-agent",
        reason: options.reason,
        instructions: options.instructions,
        urgency: options.urgency || "medium",
    });
    const data = await response.json();
    if (!response.ok) {
        console.error("Failed to initiate handoff:", data.error);
        process.exit(1);
    }
    console.log("\n Handoff initiated successfully!");
    console.log(`   Status: ${data.status}`);
    if (data.handoffUrl) {
        console.log(`   Issue: ${data.handoffUrl}`);
    }
    console.log(`   ${data.message}`);
}
async function getStatus(taskId) {
    var _a, _b, _c, _d, _e;
    const url = taskId
        ? `/api/agent/status?taskId=${taskId}&stateRepo=${STATE_REPO}`
        : `/api/agent/status?stateRepo=${STATE_REPO}`;
    const response = await apiRequest(url, "GET");
    const data = await response.json();
    if (!response.ok) {
        console.error("Failed to get status:", data.error);
        process.exit(1);
    }
    if (taskId && data.task) {
        const task = data.task;
        console.log("\n Task Details:");
        console.log("─".repeat(50));
        console.log(`   ID: ${task.id}`);
        console.log(`   Title: ${task.title}`);
        console.log(`   Status: ${task.status}`);
        console.log(`   Progress: ${((_a = task.progress) === null || _a === void 0 ? void 0 : _a.percentComplete) || 0}%`);
        console.log(`   Phase: ${((_b = task.progress) === null || _b === void 0 ? void 0 : _b.currentPhase) || "unknown"}`);
        if ((_c = task.github) === null || _c === void 0 ? void 0 : _c.issueUrl) {
            console.log(`   Issue: ${task.github.issueUrl}`);
        }
        if (((_e = (_d = task.nextSteps) === null || _d === void 0 ? void 0 : _d.immediate) === null || _e === void 0 ? void 0 : _e.length) > 0) {
            console.log("\n   Next Steps:");
            task.nextSteps.immediate.forEach((step, i) => {
                console.log(`     ${i + 1}. ${step}`);
            });
        }
        if (task.lastHandoff) {
            console.log("\n   Last Handoff:");
            console.log(`     Reason: ${task.lastHandoff.reason}`);
            console.log(`     At: ${task.lastHandoff.handoffAt}`);
        }
    }
    else if (data.tasks) {
        console.log("\n All Tasks:");
        console.log("─".repeat(50));
        if (data.tasks.length === 0) {
            console.log("   No tasks found");
        }
        else {
            data.tasks.forEach((task) => {
                console.log(`   ${task.id.slice(0, 8)}... - ${task.title}`);
            });
        }
    }
}
function printUsage() {
    console.log(`
Task Handoff Agent CLI

Usage:
  task-handoff start [options]     Start a new task
  task-handoff continue <taskId>   Continue an existing task
  task-handoff handoff <taskId>    Initiate a handoff
  task-handoff status [taskId]     Get task status

Start Options:
  --title, -t       Task title (required)
  --prompt, -p      Initial prompt for the agent (required)
  --repo, -r        GitHub repo (owner/repo) (required)
  --description, -d Task description
  --branch, -b      Git branch (default: main)
  --no-issue        Don't create GitHub issue

Continue Options:
  --prompt, -p      Additional instructions
  --accept-handoff  Accept a pending handoff

Handoff Options:
  --reason, -r         Reason for handoff (required)
  --instructions, -i   Instructions for next agent (required)
  --urgency, -u        Urgency level (low/medium/high/critical)

Environment Variables:
  TASK_HANDOFF_API    API base URL (default: http://localhost:3000)
  TASK_HANDOFF_TOKEN  Authentication token
  STATE_REPO          State storage repo (default: counciloftroas/task-handoff-state)
  GITHUB_TOKEN        GitHub API token

Examples:
  task-handoff start -t "Fix bug" -p "Fix the login error" -r "user/repo"
  task-handoff continue abc123 --accept-handoff
  task-handoff handoff abc123 -r "expertise_needed" -i "Need frontend help"
  task-handoff status abc123
`);
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        printUsage();
        process.exit(0);
    }
    const command = args[0];
    try {
        switch (command) {
            case "start": {
                const options = {
                    title: "",
                    prompt: "",
                    repo: "",
                };
                for (let i = 1; i < args.length; i++) {
                    const arg = args[i];
                    const next = args[i + 1];
                    switch (arg) {
                        case "--title":
                        case "-t":
                            options.title = next;
                            i++;
                            break;
                        case "--prompt":
                        case "-p":
                            options.prompt = next;
                            i++;
                            break;
                        case "--repo":
                        case "-r":
                            options.repo = next;
                            i++;
                            break;
                        case "--description":
                        case "-d":
                            options.description = next;
                            i++;
                            break;
                        case "--branch":
                        case "-b":
                            options.branch = next;
                            i++;
                            break;
                        case "--no-issue":
                            options.noIssue = true;
                            break;
                    }
                }
                if (!options.title || !options.prompt || !options.repo) {
                    console.error("Missing required options: --title, --prompt, --repo");
                    process.exit(1);
                }
                await startTask(options);
                break;
            }
            case "continue": {
                const taskId = args[1];
                if (!taskId) {
                    console.error("Task ID required");
                    process.exit(1);
                }
                const options = { taskId };
                for (let i = 2; i < args.length; i++) {
                    const arg = args[i];
                    const next = args[i + 1];
                    switch (arg) {
                        case "--prompt":
                        case "-p":
                            options.prompt = next;
                            i++;
                            break;
                        case "--accept-handoff":
                            options.acceptHandoff = true;
                            break;
                    }
                }
                await continueTask(options);
                break;
            }
            case "handoff": {
                const taskId = args[1];
                if (!taskId) {
                    console.error("Task ID required");
                    process.exit(1);
                }
                const options = {
                    taskId,
                    reason: "",
                    instructions: "",
                };
                for (let i = 2; i < args.length; i++) {
                    const arg = args[i];
                    const next = args[i + 1];
                    switch (arg) {
                        case "--reason":
                        case "-r":
                            options.reason = next;
                            i++;
                            break;
                        case "--instructions":
                        case "-i":
                            options.instructions = next;
                            i++;
                            break;
                        case "--urgency":
                        case "-u":
                            options.urgency = next;
                            i++;
                            break;
                    }
                }
                if (!options.reason || !options.instructions) {
                    console.error("Missing required options: --reason, --instructions");
                    process.exit(1);
                }
                await initiateHandoff(options);
                break;
            }
            case "status": {
                const taskId = args[1];
                await getStatus(taskId);
                break;
            }
            default:
                console.error(`Unknown command: ${command}`);
                printUsage();
                process.exit(1);
        }
    }
    catch (error) {
        console.error("Error:", error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
main();

#!/usr/bin/env node
/**
 * Task Handoff Agent CLI
 *
 * Usage:
 *   npx task-handoff start --title "Task name" --prompt "What to do"
 *   npx task-handoff continue <taskId> [--accept-handoff]
 *   npx task-handoff handoff <taskId> --reason "expertise_needed" --instructions "Next steps"
 *   npx task-handoff status [taskId]
 */
declare const API_BASE: string;
declare const STATE_REPO: string;
interface StartOptions {
    title: string;
    description?: string;
    prompt: string;
    repo: string;
    branch?: string;
    noIssue?: boolean;
}
interface ContinueOptions {
    taskId: string;
    prompt?: string;
    acceptHandoff?: boolean;
}
interface HandoffOptions {
    taskId: string;
    reason: string;
    instructions: string;
    urgency?: string;
}
declare function apiRequest(endpoint: string, method: string, body?: object): Promise<Response>;
declare function startTask(options: StartOptions): Promise<void>;
declare function continueTask(options: ContinueOptions): Promise<void>;
declare function initiateHandoff(options: HandoffOptions): Promise<void>;
declare function getStatus(taskId?: string): Promise<void>;
declare function printUsage(): void;
declare function main(): Promise<void>;

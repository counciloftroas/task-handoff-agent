import { z } from "zod";

// File modification record
export const FileModificationSchema = z.object({
  path: z.string(),
  action: z.enum(["created", "modified", "deleted"]),
  previousHash: z.string().optional(),
  currentHash: z.string(),
  summary: z.string(),
});

// Conversation message for context transfer
export const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  timestamp: z.string().datetime(),
  toolCalls: z
    .array(
      z.object({
        name: z.string(),
        input: z.record(z.unknown()),
        result: z.string().optional(),
      })
    )
    .optional(),
});

// Progress checkpoint
export const ProgressCheckpointSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  description: z.string(),
  completedSteps: z.array(z.string()),
  remainingSteps: z.array(z.string()),
  blockers: z.array(z.string()).optional(),
});

// Agent identity
export const AgentIdentitySchema = z.object({
  userId: z.string(),
  agentId: z.string(),
  sessionId: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});

// Handoff record
export const HandoffRecordSchema = z.object({
  fromAgent: AgentIdentitySchema,
  toAgent: AgentIdentitySchema.optional(),
  handoffAt: z.string().datetime(),
  reason: z.string(),
  instructions: z.string(),
});

// Resource reference
export const ResourceSchema = z.object({
  type: z.enum(["file", "url", "documentation"]),
  path: z.string(),
  description: z.string(),
});

// Main Task State
export const TaskStateSchema = z.object({
  // Identity
  id: z.string().uuid(),
  version: z.number().int().min(1),

  // Metadata
  title: z.string(),
  description: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),

  // Status
  status: z.enum([
    "pending",
    "in_progress",
    "awaiting_handoff",
    "handed_off",
    "completed",
    "failed",
    "cancelled",
  ]),

  // GitHub Integration
  github: z.object({
    repo: z.string(),
    branch: z.string(),
    stateRepo: z.string(), // Separate repo for state storage
    issueNumber: z.number().optional(),
    prNumber: z.number().optional(),
    commitSha: z.string().optional(),
  }),

  // Session State
  session: z.object({
    currentSessionId: z.string(),
    transcriptPath: z.string(),
    lastMessageUuid: z.string().optional(),
  }),

  // Conversation Context
  context: z.object({
    systemPrompt: z.string().optional(),
    conversationHistory: z.array(ConversationMessageSchema),
    compactedSummary: z.string().optional(),
  }),

  // Progress Tracking
  progress: z.object({
    currentPhase: z.string(),
    checkpoints: z.array(ProgressCheckpointSchema),
    percentComplete: z.number().min(0).max(100),
  }),

  // File Changes
  files: z.object({
    modifications: z.array(FileModificationSchema),
    workingDirectory: z.string(),
  }),

  // Handoff Chain
  handoffs: z.array(HandoffRecordSchema),

  // Next Steps
  nextSteps: z.object({
    immediate: z.array(z.string()),
    considerations: z.array(z.string()),
    blockers: z.array(z.string()),
    resources: z.array(ResourceSchema),
  }),

  // Security
  security: z.object({
    encryptedSecrets: z.string().optional(),
    allowedAgents: z.array(z.string()),
    requireApproval: z.boolean(),
  }),
});

// Handoff request schema
export const HandoffRequestSchema = z.object({
  taskId: z.string().uuid(),
  fromAgentId: z.string(),
  reason: z.enum([
    "task_complete_phase",
    "expertise_needed",
    "time_limit",
    "user_request",
    "error_recovery",
  ]),
  instructions: z.string(),
  urgency: z.enum(["low", "medium", "high", "critical"]),
  targetAgentId: z.string().optional(),
});

// Handoff response schema
export const HandoffResponseSchema = z.object({
  taskId: z.string().uuid(),
  accepted: z.boolean(),
  agentId: z.string(),
  message: z.string().optional(),
  estimatedStartTime: z.string().datetime().optional(),
});

// Start task request schema
export const StartTaskRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  prompt: z.string().min(1),
  github: z.object({
    repo: z.string().regex(/^[^/]+\/[^/]+$/),
    branch: z.string().default("main"),
    stateRepo: z.string().regex(/^[^/]+\/[^/]+$/).optional(),
    createIssue: z.boolean().default(true),
  }),
  config: z
    .object({
      model: z.string().default("claude-sonnet-4-5-20250929"),
      maxTurns: z.number().int().min(1).max(100).default(50),
      allowedTools: z.array(z.string()).optional(),
    })
    .optional(),
});

// Continue task request schema
export const ContinueTaskRequestSchema = z.object({
  taskId: z.string().uuid(),
  prompt: z.string().optional(),
  acceptHandoff: z.boolean().default(false),
});

// Type exports
export type TaskState = z.infer<typeof TaskStateSchema>;
export type FileModification = z.infer<typeof FileModificationSchema>;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ProgressCheckpoint = z.infer<typeof ProgressCheckpointSchema>;
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type HandoffRecord = z.infer<typeof HandoffRecordSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type HandoffRequest = z.infer<typeof HandoffRequestSchema>;
export type HandoffResponse = z.infer<typeof HandoffResponseSchema>;
export type StartTaskRequest = z.infer<typeof StartTaskRequestSchema>;
export type ContinueTaskRequest = z.infer<typeof ContinueTaskRequestSchema>;

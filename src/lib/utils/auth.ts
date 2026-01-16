import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

export interface AuthResult {
  valid: boolean;
  userId?: string;
  agentId?: string;
  error?: string;
}

export interface AgentToken {
  sub: string;
  agentId: string;
  iat: number;
  exp: number;
  scopes: string[];
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

/**
 * Validate authentication from request
 */
export async function validateAuth(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get("Authorization");

  // For development, allow unauthenticated requests with default agent
  if (!authHeader) {
    if (process.env.NODE_ENV === "development") {
      return {
        valid: true,
        userId: "dev-user",
        agentId: "dev-agent",
      };
    }
    return { valid: false, error: "Missing authorization header" };
  }

  if (!authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Invalid authorization format" };
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AgentToken;

    if (decoded.exp < Date.now() / 1000) {
      return { valid: false, error: "Token expired" };
    }

    return {
      valid: true,
      userId: decoded.sub,
      agentId: decoded.agentId,
    };
  } catch {
    return { valid: false, error: "Invalid token" };
  }
}

/**
 * Generate a new agent token
 */
export function generateAgentToken(userId: string, agentId: string): string {
  const payload: AgentToken = {
    sub: userId,
    agentId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
    scopes: ["task:read", "task:write", "task:handoff"],
  };

  return jwt.sign(payload, JWT_SECRET);
}

/**
 * Get user/agent info from request (with fallback for dev)
 */
export function getAuthInfo(request: NextRequest): {
  userId: string;
  agentId: string;
} {
  const authHeader = request.headers.get("Authorization");

  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, JWT_SECRET) as AgentToken;
      return {
        userId: decoded.sub,
        agentId: decoded.agentId,
      };
    } catch {
      // Fall through to default
    }
  }

  // Default for development
  return {
    userId: "dev-user",
    agentId: `agent-${Date.now()}`,
  };
}

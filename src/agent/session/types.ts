/**
 * Agent 会话类型 — AgentSession 的入参与结果类型。
 */
import type { ConversationHandlerOptions } from "@/conversation";

export interface AgentSessionResult {
  agentName: string;
  ok: boolean;
  text: string;
  error?: string;
  toolRounds: number;
  durationMs: number;
  reasoning?: string;
  usage?: import("@/session/type").TokenUsage;
}

export interface SubagentTask {
  id: string;
  agentName: string;
  prompt: string;
  status: "pending" | "running" | "completed" | "error";
  result?: AgentSessionResult;
  startTime?: number;
  endTime?: number;
  /** 关联的子 AgentSession 实例(用于级联销毁) */
  session?: import("./session").AgentSession;
}

export interface AgentSessionOptions extends Partial<ConversationHandlerOptions> {
  abortSignal?: ConversationHandlerOptions["abortSignal"];
  spawnDepth?: number;
  maxSpawnDepth?: number;
  instanceId?: string;
  maxToolRounds?: ConversationHandlerOptions["maxToolRounds"];
  permissionRequestHandler?: ConversationHandlerOptions["permissionRequestHandler"];
  sessionId?: ConversationHandlerOptions["sessionId"];
  systemPrompt?: ConversationHandlerOptions["systemPrompt"];
  askUserCallback?: (
    question: string,
    options: string[],
    multiSelect: boolean,
  ) => Promise<{ selected: string | string[]; customInput?: string }>;
  inheritedAllowedTools?: string[];
  inheritAllTools?: boolean;
}

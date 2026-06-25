import { type Tool, jsonSchema } from "ai";
import type { AppConfigSchema } from "@/schema/config";

// ─── 合成工具 Schema(发送给 LLM 的工具定义) ────────────────────

export type TeamSyntheticToolName =
  | "message_teammate"
  | "claim_task"
  | "complete_task"
  | "list_team_tasks"
  | "wait-for-messages"
  | "request_plan_approval";

export type TeamSynthesizedTool = Tool<unknown, never>;

export type TeamSynthesizedToolMap = Record<
  Exclude<TeamSyntheticToolName, "request_plan_approval">,
  TeamSynthesizedTool
> &
  Partial<Record<"request_plan_approval", TeamSynthesizedTool>>;

/** 为队友构建合成工具集(AI SDK Tool 格式，不含 execute) */
export function buildSyntheticTools(requirePlanApproval: boolean): TeamSynthesizedToolMap {
  const tools: TeamSynthesizedToolMap = {
    claim_task: {
      description: "从共享任务列表中认领一个待处理任务。该任务必须处于待处理状态且尚未分配负责人。",
      inputSchema: jsonSchema({
        properties: {
          task_id: {
            description: "要认领的任务 ID。",
            type: "string",
          },
        },
        required: ["task_id"],
        type: "object",
      }),
    },
    complete_task: {
      description: "完成工作后，将任务标记为已完成。",
      inputSchema: jsonSchema({
        properties: {
          task_id: {
            description: "要标记为完成的任务 ID。",
            type: "string",
          },
        },
        required: ["task_id"],
        type: "object",
      }),
    },
    list_team_tasks: {
      description: "查看共享任务列表中的全部任务，包括状态和负责人。",
      inputSchema: jsonSchema({
        properties: {},
        required: [],
        type: "object",
      }),
    },
    message_teammate: {
      description: "向其他队友或团队负责人发送消息，用于共享发现、协调工作或请求帮助。",
      inputSchema: jsonSchema({
        properties: {
          content: {
            description: "要发送的消息内容。",
            type: "string",
          },
          target: {
            description: '目标队友的名称或 ID；填写 "lead" 表示发送给团队负责人。',
            type: "string",
          },
        },
        required: ["target", "content"],
        type: "object",
      }),
    },
    "wait-for-messages": {
      description:
        "阻塞并等待来自负责人、用户或其他队友的新消息。当你已完成当前工作并等待下一步指令时调用。等待期间不会消耗资源；如果队列中已有消息会立即返回。",
      inputSchema: jsonSchema({
        properties: {
          summary: {
            description: "当前已完成工作的简要总结，会发送给负责人。",
            type: "string",
          },
        },
        required: ["summary"],
        type: "object",
      }),
    },
  };

  if (requirePlanApproval) {
    tools.request_plan_approval = {
      description: "向团队负责人提交实施计划以供审阅和批准。当负责人要求该队友先通过计划审批时必须调用。",
      inputSchema: jsonSchema({
        properties: {
          plan: {
            description: "Markdown 格式的详细实施计划。",
            type: "string",
          },
        },
        required: ["plan"],
        type: "object",
      }),
    };
  }

  return tools;
}

export const SYNTHETIC_TOOL_NAMES = new Set([
  "message_teammate",
  "claim_task",
  "complete_task",
  "list_team_tasks",
  "wait-for-messages",
  "waitForMessages",
  "request_plan_approval",
]);

export interface TeammateExecutionOptions {
  onMessage?: (msg: TeammateStreamMessage) => void;
  abortSignal?: AbortSignal;
  yoloMode?: boolean;
  requirePlanApproval?: boolean;
  appConfig?: AppConfigSchema;
}

export interface TeammateStreamMessage {
  type: "status" | "content" | "tool_call" | "tool_result" | "error" | "done" | "standby";
  teammateId: string;
  teammateName: string;
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  status?: string;
}

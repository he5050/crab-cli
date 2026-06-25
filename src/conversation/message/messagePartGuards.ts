/**
 * 消息片段守卫 — 类型守卫与归一化工具，用于兼容多种 ModelMessage 内容形态。
 *
 * 职责:
 *   - 统一判定 tool-call / tool-result / text 等消息片段结构
 *   - 为上游逻辑提供安全归一化入口
 *
 * 模块功能:
 *   - ToolCallLikePart / ToolResultLikePart: 兼容性片段结构
 *   - 各类消息片段类型守卫与归一化函数
 */
/** 兼容性工具调用片段:同时支持 AI SDK(input) 和 OpenAI(args) 两种参数命名。
 *  isToolCallPart 仅检查 type/toolCallId/toolName，不区分 input/args 来源。 */
export interface ToolCallLikePart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  /** AI SDK 格式的调用参数 */
  input?: unknown;
  /** OpenAI 格式的调用参数 */
  args?: unknown;
}

export interface ToolResultLikePart {
  type: "tool-result";
  toolCallId: string;
  toolName?: string;
  output: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isToolCallPart(part: unknown): part is ToolCallLikePart {
  return (
    isRecord(part) &&
    part.type === "tool-call" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  );
}

export function isToolResultPart(part: unknown): part is ToolResultLikePart {
  return isRecord(part) && part.type === "tool-result" && typeof part.toolCallId === "string" && "output" in part;
}

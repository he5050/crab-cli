/**
 * 事件载荷公共类型 — 供多个业务域复用的基础接口。
 *
 * 职责:
 *   - 提取跨域重复出现的工具调用/结果等公共字段
 *   - 避免 ToolEvents 与 ConversationEvents 等域之间的重复定义
 *
 * 边界:
 *   - 仅包含纯数据结构类型,不引入业务逻辑
 *   - 字段保持为可选/未知,由具体域在 defineEvent 时收窄
 */

/** 工具调用的公共基础字段。 */
export interface ToolCallBase {
  tool: string;
  args: unknown;
  callId: string;
  metadata?: Record<string, unknown>;
  files?: unknown[];
  diagnostics?: unknown[];
  subSessionId?: string;
  startedAt?: number;
  time?: unknown;
}

/** 工具结果的公共基础字段（继承 ToolCallBase 的部分字段）。
 *
 * args 在此处改为可选,因为 ToolResult 发布方可能不关心入参。
 *
 * 设计目标:
 *   - toolEvents.ToolResult 与 conversation 等域共享基字段
 *   - 避免在每个域中重复声明 sessionId / success / durationMs 等字段
 *   - args 设为可选以兼容现有不传 args 的发布方
 */
export interface ToolResultBase extends Omit<ToolCallBase, "args"> {
  args?: unknown;
  sessionId?: string;
  result: unknown;
  success: boolean;
  truncated?: boolean;
  outputPath?: string;
  endedAt?: number;
  durationMs?: number;
}

/**
 * 工具调用相关事件定义。
 *
 * 职责:
 *   - 集中定义工具执行生命周期事件
 *   - 提供类型安全的事件载荷
 *
 * 事件清单:
 *   - ToolCall: 工具调用开始
 *   - ToolResult: 工具调用完成
 *   - ToolTimeout: 工具执行超时
 *
 * 使用场景:
 *   - UI 实时显示工具调用进度与结果
 *   - 审计/日志模块记录所有工具调用
 *   - 监控模块统计超时事件
 */
import { defineEvent } from "../core";
import type { ToolCallBase, ToolResultBase } from "./common";

export const ToolEvents = {
  /** 工具调用开始 */
  ToolCall: defineEvent<ToolCallBase>("tool.call"),

  /** 工具调用完成 */
  ToolResult: defineEvent<ToolResultBase>("tool.result"),

  /** 工具执行超时(per-tool timeoutMs 用尽) */
  ToolTimeout: defineEvent<{
    toolName: string;
    timeoutMs: number;
    sessionId?: string;
    messageId?: string;
  }>("tool.timeout"),
} as const;

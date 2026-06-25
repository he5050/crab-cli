/**
 * MCP 工具变更追踪器 — 监听 MCP 工具列表变更并生成 LLM 提醒。
 *
 * 从 ConversationHandler 提取的独立职责:
 *   - 监听 AppEvent.ToolsListChanged 事件
 *   - 缓冲变更记录(上限 20 条)
 *   - 生成结构化提醒文本供系统提示词使用
 *
 * 边界:
 *   1. 无状态持久化，每次 consumeReminder() 后清空缓冲
 *   2. 不修改工具注册表，仅追踪变更通知
 */

import type { EventBus } from "@/bus";
import { AppEvent } from "@/bus";

export interface McpToolChangeNotice {
  serverName: string;
  toolCount: number;
  added: string[];
  removed: string[];
}

/** 提醒文本生成回调(供外部自定义格式) */
export type ReminderFormatter = (changes: McpToolChangeNotice[]) => string | undefined;

const DEFAULT_MAX_PENDING = 20;

/**
 * MCP 工具变更追踪器
 *
 * 使用方式:
 *   1. 构造时传入 EventBus
 *   2. init() 开始监听
 *   3. consumeReminder() 获取并清空提醒
 *   4. destroy() 停止监听
 */
export class McpToolChangeTracker {
  private pendingChanges: McpToolChangeNotice[] = [];
  private unsubToolsListChanged?: () => void;
  private readonly maxPending: number;

  constructor(
    private readonly eventBus: EventBus,
    options?: { maxPending?: number },
  ) {
    this.maxPending = options?.maxPending ?? DEFAULT_MAX_PENDING;
  }

  /** 开始监听 ToolsListChanged 事件 */
  init(): void {
    this.unsubToolsListChanged = this.eventBus.subscribe(AppEvent.ToolsListChanged, (evt) => {
      const change = evt.properties;
      if (change.added.length === 0 && change.removed.length === 0) {
        return;
      }
      this.pendingChanges.push({
        added: [...change.added],
        removed: [...change.removed],
        serverName: change.serverName,
        toolCount: change.toolCount,
      });
      if (this.pendingChanges.length > this.maxPending) {
        this.pendingChanges = this.pendingChanges.slice(-this.maxPending);
      }
    });
  }

  /** 消费并清空当前提醒，返回格式化文本(无变更时返回 undefined) */
  consumeReminder(formatter?: ReminderFormatter): string | undefined {
    if (this.pendingChanges.length === 0) {
      return undefined;
    }
    const changes = this.pendingChanges;
    this.pendingChanges = [];
    return formatter?.(changes) ?? formatMcpToolChanges(changes);
  }

  /** 当前待处理变更数量(用于诊断) */
  get pendingCount(): number {
    return this.pendingChanges.length;
  }

  /** 停止监听 */
  destroy(): void {
    this.unsubToolsListChanged?.();
    this.unsubToolsListChanged = undefined;
    this.pendingChanges = [];
  }
}

/** 默认提醒格式化 */
function formatMcpToolChanges(changes: McpToolChangeNotice[]): string {
  const lines = [
    "",
    "## MCP 工具列表变更",
    "自上一轮 LLM 请求后，MCP 工具集发生变化。请基于当前 tools schema 判断可用工具，不要假设旧工具仍可调用。",
    "",
    ...changes.flatMap((change) => [
      `- ${change.serverName}: 当前 ${change.toolCount} 个工具`,
      change.added.length > 0 ? `  - 新增: ${change.added.join(", ")}` : undefined,
      change.removed.length > 0 ? `  - 移除: ${change.removed.join(", ")}` : undefined,
    ]),
  ].filter((line): line is string => typeof line === "string");
  return lines.join("\n");
}

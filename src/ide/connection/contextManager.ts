/**
 * IDE 上下文收集器 — 聚合多 IDE 客户端的上下文信息
 *
 * 职责:
 *   - 收集所有已连接 IDE 的编辑器上下文
 *   - 合并去重工作区信息
 *   - 生成统一的上下文快照
 *   - 提供上下文变更事件通知
 *
 * 模块功能:
 *   - AggregatedContext: 聚合上下文快照接口
 *   - getAggregatedContext: 获取当前聚合上下文快照
 *   - onContextChange: 监听上下文变更事件
 *
 * 使用场景:
 *   - IDE 连接状态监控
 *   - 编辑器上下文同步
 *   - 多客户端状态聚合
 *
 * 边界:
 * 1. 依赖 ideStateManager 状态管理
 * 2. 上下文合并策略:取最新活跃的那个
 * 3. 不处理 IDE 连接的具体通信逻辑
 *
 * 流程:
 * 1. 调用 getAggregatedContext 获取当前快照
 * 2. 订阅上下文变更事件
 * 3. 收到变更通知时重新获取快照
 */

import { ideStateManager } from "./stateManager";
import type { EditorContext } from "@/ide/types";

/** 聚合上下文快照 */
export interface AggregatedContext {
  /** 是否有任何上下文可用 */
  hasContext: boolean;
  /** 合并后的编辑器上下文(取最新活跃) */
  editorContext: EditorContext;
  /** 所有工作区 */
  workspaceFolders: string[];
  /** 已连接的 IDE 数量 */
  connectedCount: number;
}

/**
 * 获取当前聚合上下文快照。
 */
export function getAggregatedContext(): AggregatedContext {
  const state = ideStateManager.getState();
  return {
    connectedCount: state.clientCount,
    editorContext: state.editorContext,
    hasContext: Boolean(state.editorContext.activeFile),
    workspaceFolders: state.workspaceFolders,
  };
}

/**
 * 获取格式化的上下文摘要(用于注入到 AI 提示)。
 */
export function getAggregatedContextPrompt(): string {
  const ctx = getAggregatedContext();

  if (!ctx.hasContext) {
    return "";
  }

  const parts: string[] = ["", "## IDE Context (WebSocket)", `- Connected IDEs: ${ctx.connectedCount}`];

  if (ctx.workspaceFolders.length > 0) {
    parts.push(`- Workspaces: ${ctx.workspaceFolders.join(", ")}`);
  }

  const ec = ctx.editorContext;
  if (ec.activeFile) {
    parts.push(`- Active file: ${ec.activeFile}`);
  }

  if (ec.cursorPosition) {
    parts.push(`- Cursor: line ${ec.cursorPosition.line + 1}, column ${ec.cursorPosition.character + 1}`);
  }

  if (ec.selectedText) {
    const lines = ec.selectedText.split("\n").length;
    if (lines <= 30) {
      parts.push(`- Selected text (${lines} lines):`);
      parts.push("```");
      parts.push(ec.selectedText);
      parts.push("```");
    } else {
      const allLines = ec.selectedText.split("\n");
      parts.push(`- Selected text (${lines} lines, truncated):`);
      parts.push("```");
      parts.push(allLines.slice(0, 5).join("\n"));
      parts.push(`... (${lines - 8} lines omitted) ...`);
      parts.push(allLines.slice(-3).join("\n"));
      parts.push("```");
    }
  }

  parts.push("");
  return parts.join("\n");
}

/**
 * 订阅聚合上下文变更。支持两种回调签名以保持向后兼容。
 */
export function onAggregatedContextChange(callback: (context: AggregatedContext | EditorContext) => void): () => void {
  return ideStateManager.onContextChange(() => {
    callback(getAggregatedContext());
  });
}

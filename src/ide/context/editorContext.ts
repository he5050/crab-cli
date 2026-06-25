/**
 * 编辑器上下文 — 委托到 contextManager 统一实现。
 *
 * 职责:
 *   - 提供 buildEditorContextPrompt / hasEditorContext 的向后兼容导出
 *   - 实际逻辑委托给 contextManager 和 ideStateManager
 *
 * 边界:
 * 1. 所有实现委托到 src/ide/connection/contextManager.ts
 * 2. 保持原有导出接口不变
 */

import { getAggregatedContextPrompt, onAggregatedContextChange } from "@/ide/connection/contextManager";
import { ideStateManager } from "@/ide/connection/stateManager";
import type { EditorContext } from "@/ide/types";

/**
 * 构建编辑器上下文的文本表示，用于注入到 AI 系统提示中。
 * 委托到 contextManager.getAggregatedContextPrompt()。
 */
export function buildEditorContextPrompt(): string {
  return getAggregatedContextPrompt();
}

/**
 * 检查是否有可用的编辑器上下文。
 */
export function hasEditorContext(): boolean {
  return Boolean(resolveEditorContext().activeFile);
}

/**
 * 获取当前编辑器上下文的摘要(用于日志等场景)。
 */
export function getEditorContextSummary(): string {
  const ctx = resolveEditorContext();
  if (!ctx.activeFile) {
    return "No active file";
  }

  const file = ctx.activeFile.split(/[\\/]/).pop() ?? ctx.activeFile;
  let summary = file;

  if (ctx.cursorPosition) {
    summary += `:${ctx.cursorPosition.line + 1}`;
  }

  if (ctx.selectedText) {
    const lines = ctx.selectedText.split("\n").length;
    summary += ` (${lines} lines selected)`;
  }

  return summary;
}

// ─── 上下文变更监听(向后兼容) ─────────────────────────────

type ContextChangeCallback = (context: EditorContext) => void;

/**
 * 注册编辑器上下文变更监听器。
 * 委托到 contextManager.onAggregatedContextChange()。
 */
export function onEditorContextChange(callback: ContextChangeCallback): () => void {
  let active = true;
  const current = resolveEditorContext();
  if (current.activeFile) {
    safeNotify(callback, current);
  }
  const unsubscribe = onAggregatedContextChange((ctx) => {
    if (!active) return;
    const editorContext = "editorContext" in ctx ? ctx.editorContext : ctx;
    safeNotify(callback, editorContext);
  });
  return () => {
    active = false;
    unsubscribe();
  };
}

// ─── 自动启动(向后兼容) ─────────────────────────────────────

let autoStarted = false;

/**
 * 自动启动编辑器上下文监听。
 */
export function startEditorContextWatch(): void {
  if (autoStarted) {
    return;
  }
  autoStarted = true;
  // IdeStateManager.init() 在应用启动时调用，此处无需重复初始化
}

function resolveEditorContext(): EditorContext {
  return ideStateManager.getEditorContext();
}

function safeNotify(callback: ContextChangeCallback, context: EditorContext): void {
  try {
    callback(context);
  } catch {
    // Context listeners are best-effort; one failing listener must not break prompt construction.
  }
}

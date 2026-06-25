/**
 * 工具显示模式切换
 *
 *
 * 三种模式:
 *   full    — 显示完整工具调用（名称 + 参数 + 结果）
 *   compact — 仅显示工具名称 + 简短状态
 *   hidden  — 隐藏所有工具调用过程，只显示 AI 回复
 */

import { readMergedSettings, updateSettings } from "@/config/settings/unifiedSettings";

// ─── 类型 ──────────────────────────────────────────────────

export type ToolDisplayMode = "full" | "compact" | "hidden";

// ─── 默认值 ────────────────────────────────────────────────

const DEFAULT_TOOL_DISPLAY_MODE: ToolDisplayMode = "full";

// ─── 公开 API ──────────────────────────────────────────────────

/** 获取当前工具显示模式 */
export function getToolDisplayMode(): ToolDisplayMode {
  const merged = readMergedSettings();
  if (merged.toolDisplayMode && ["full", "compact", "hidden"].includes(merged.toolDisplayMode)) {
    return merged.toolDisplayMode as ToolDisplayMode;
  }
  return DEFAULT_TOOL_DISPLAY_MODE;
}

/** 设置工具显示模式（持久化到 settings） */
export function setToolDisplayMode(mode: ToolDisplayMode): void {
  updateSettings("project", (s) => {
    s.toolDisplayMode = mode;
  });
}

/** 切换工具显示模式 */
export function toggleToolDisplayMode(mode: ToolDisplayMode): boolean {
  const current = getToolDisplayMode();
  const next = current === mode ? DEFAULT_TOOL_DISPLAY_MODE : mode;
  setToolDisplayMode(next);
  return next !== current;
}

/** 状态消息 */
export function toolDisplayStatusMessage(mode: ToolDisplayMode): string {
  switch (mode) {
    case "full":
      return "工具显示: 完整模式（名称 + 参数 + 结果）";
    case "compact":
      return "工具显示: 精简模式（仅名称 + 简短状态）";
    case "hidden":
      return "工具显示: 隐藏模式（仅 AI 回复）";
    default:
      return `未知模式: ${mode}`;
  }
}

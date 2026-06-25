/**
 * 业务级图标派生模块 — 业务模块的图标一律基于此派生
 *
 * 规则:
 *   1. 本文件不引入任何硬编码 emoji 字符串
 *   2. 所有派生函数依赖 @core/icon 的字符串常量
 *   3. 业务模块不应再自行定义 getStatusIcon / getToolIcon 等
 *   4. 命名规范: <domain>Icon(<discriminator>): string
 *
 * 类别索引:
 *   - todo / task / tool / file / branch / teammate / lspSeverity / risk / connection
 *   - permission / review / hookSuccess / animationGlyph
 */

import {
  actionHint,
  actionMore,
  asciiBullet,
  asciiCheck,
  asciiCircle,
  asciiCircleDouble,
  asciiCross,
  asciiCrossHeavy,
  asciiDiamond,
  asciiDiamondOpen,
  asciiDot,
  asciiDotFilled,
  asciiEmDash,
  asciiHalf,
  asciiNoEntry,
  asciiSpinner,
  asciiStop,
  asciiTimer,
  asciiTriangleDown,
  asciiTriangleDownOpen,
  asciiTriangleRight,
  asciiTriangleRightOpen,
  iconBlocked,
  iconDefault,
  iconDisabled,
  iconError,
  iconFolder,
  iconIdle,
  iconLoading,
  iconLock,
  iconPause,
  iconPrivate,
  iconPublic,
  iconQueued,
  iconRunning,
  iconSuccess,
  iconTasks,
  iconUnknown,
  iconWarning,
  symArrowDown,
  symArrowLeft,
  symArrowRight,
  symArrowSwap,
  symArrowUp,
  symCheck,
  symCross,
  symDot,
  symEmpty,
  symExclaim,
  symInfo,
  symMinus,
  symPlus,
  symQuestion,
  symWarn,
  toolBash,
  toolCodeSearch,
  toolGeneric,
  toolGit,
  toolRead,
  toolSubagent,
  toolWebFetch,
  toolWebSearch,
  toolWrite,
} from "./icon";

// ═══════ Todo / Task 状态 ═══════

/** 通用任务状态:done / running / error / pending / blocked / queued / warn / skipped / partial / timeout / cancelled / unknown */
export type GenericTaskStatus =
  | "done"
  | "completed"
  | "running"
  | "in_progress"
  | "error"
  | "failed"
  | "pending"
  | "queued"
  | "warn"
  | "warning"
  | "skipped"
  | "blocked"
  | "timeout"
  | "partial"
  | "cancelled"
  | "unknown";

/** 通用任务状态 → 图标(覆盖 @core/icon.taskIcon 的别名集合) */
export function genericTaskIcon(status: string): string {
  switch (status) {
    case "done":
    case "completed":
    case "success": {
      return iconSuccess;
    }
    case "running":
    case "in_progress": {
      return iconRunning;
    }
    case "error":
    case "failed": {
      return iconError;
    }
    case "warn":
    case "warning": {
      return iconWarning;
    }
    case "pending":
    case "queued": {
      return iconQueued;
    }
    case "skipped": {
      return symArrowRight;
    }
    case "blocked": {
      return iconBlocked;
    }
    case "timeout": {
      return symExclaim;
    }
    case "partial": {
      return symDot;
    }
    case "cancelled": {
      return symCross;
    }
    default: {
      return iconUnknown;
    }
  }
}

/** TODO 状态:completed / inProgress / pending */
export type TodoStatusKind = "completed" | "inProgress" | "pending" | (string & {});

/** TODO 状态 → 图标(轻量,使用 symCheck / symDot / symEmpty) */
export function todoStatusIcon(status: TodoStatusKind): string {
  if (status === "completed") {
    return symCheck;
  }
  if (status === "inProgress") {
    return symDot;
  }
  return symEmpty;
}

/** Task 状态(panel 级,挂起态用 iconIdle) */
export function taskPanelIcon(status: string): string {
  switch (status) {
    case "pending": {
      return iconIdle;
    }
    case "running": {
      return iconLoading;
    }
    case "completed": {
      return iconTasks;
    }
    case "failed": {
      return iconError;
    }
    case "blocked": {
      return iconBlocked;
    }
    case "queued": {
      return iconQueued;
    }
    case "cancelled": {
      return iconDisabled;
    }
    default: {
      return iconIdle;
    }
  }
}

// ═══════ Teammate(团队成员)状态 ═══════

export type TeammateStatusKind = "pending" | "running" | "completed" | "failed" | "idle" | (string & {});

/** 团队成员状态 → 图标 */
export function teammateStatusIcon(status: TeammateStatusKind): string {
  switch (status) {
    case "pending": {
      return iconIdle;
    }
    case "running": {
      return iconLoading;
    }
    case "completed": {
      return iconSuccess;
    }
    case "failed": {
      return iconError;
    }
    default: {
      return iconIdle;
    }
  }
}

// ═══════ Tool 工具名 → 图标 ═══════

const TOOL_ICON_MAP: Readonly<Record<string, string>> = {
  bash: toolBash,
  read: toolRead,
  write: toolWrite,
  edit: toolWrite,
  "codebase-search": toolCodeSearch,
  codebase_search: toolCodeSearch,
  "web-search": toolWebSearch,
  "web-fetch": toolWebFetch,
  git: toolGit,
  subagent: toolSubagent,
  default: toolGeneric,
};

/** 工具名 → 图标(未识别使用 toolGeneric) */
export function toolIcon(name: string): string {
  return TOOL_ICON_MAP[name] ?? toolGeneric;
}

/** 工具调用生命周期状态 → 图标 */
export function toolCallStatusIcon(status: string): string {
  switch (status) {
    case "completed": {
      return symCheck;
    }
    case "error": {
      return symCross;
    }
    case "executing":
    case "running": {
      return iconLoading;
    }
    case "cancelled": {
      return iconDisabled;
    }
    case "pending":
    default: {
      return symEmpty;
    }
  }
}

// ═══════ Git 文件状态 ═══════

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked" | (string & {});

/** Git 文件状态 → 图标(轻量字符) */
export function gitFileStatusIcon(status: GitFileStatus | undefined): string {
  switch (status) {
    case "added": {
      return symPlus;
    }
    case "modified": {
      return symDot;
    }
    case "deleted": {
      return symMinus;
    }
    case "renamed": {
      return symArrowRight;
    }
    case "untracked": {
      return symQuestion;
    }
    default: {
      return symEmpty;
    }
  }
}

/** Git 分支(当前/远程/本地) → 图标 */
export function gitBranchIcon(isCurrent: boolean, isRemote: boolean): string {
  if (isCurrent) {
    return iconRunning;
  }
  return isRemote ? iconIdle : iconIdle;
}

// ═══════ LSP 严重性 ═══════

/** LSP 诊断严重性 → 图标 */
export function lspSeverityIcon(severity: string): string {
  switch (severity) {
    case "error": {
      return iconError;
    }
    case "warning": {
      return iconWarning;
    }
    case "info": {
      return symInfo;
    }
    case "hint": {
      return actionHint;
    }
    default: {
      return symEmpty;
    }
  }
}

// ═══════ 通用成功/失败布尔 ═══════

/** 布尔成功 → 图标 */
export function successIcon(success: boolean): string {
  return success ? symCheck : symCross;
}

/** 布尔完成(✓ / •) → 图标(用于审查/勾选行) */
export function reviewedIcon(reviewed: boolean): string {
  return reviewed ? symCheck : symDot;
}

/** 注意力级别 → 图标(配合 attention.ts) */
export function attentionLevelIcon(level: string): string {
  switch (level) {
    case "critical": {
      return iconError;
    }
    case "warning": {
      return iconWarning;
    }
    default: {
      return actionHint;
    }
  }
}

// ═══════ 风险等级 ═══════

export type RiskLevel = "low" | "medium" | "high" | (string & {});

/** 风险等级 → 图标 */
export function riskLevelIcon(level: RiskLevel): string {
  switch (level) {
    case "low": {
      return iconSuccess;
    }
    case "medium": {
      return iconWarning;
    }
    case "high": {
      return iconError;
    }
    default: {
      return iconUnknown;
    }
  }
}

// ═══════ 复选框(用于菜单/选项) ═══════

/** 启用复选框:[✓] / [ ] */
export function checkboxIcon(checked: boolean): string {
  return checked ? "[✓]" : "[ ]";
}

// ═══════ IDE 连接状态 ═══════

export type IdeConnectionStatus = "connected" | "connecting" | "error" | "disconnected" | "idle" | (string & {});

/** IDE 状态 → 图标 */
export function ideStatusIcon(status: IdeConnectionStatus): string {
  switch (status) {
    case "connected": {
      return symCheck;
    }
    case "connecting": {
      return symDot;
    }
    case "error": {
      return symCross;
    }
    case "disconnected":
    case "idle": {
      return symEmpty;
    }
    default: {
      return symDot;
    }
  }
}

// ═══════ MCP 服务器状态 ═══════

export type McpServerStatus = "connected" | "connecting" | "error" | "disconnected" | "idle" | (string & {});

/** MCP 服务器状态 → 图标 */
export function mcpServerStatusIcon(status: McpServerStatus): string {
  switch (status) {
    case "connected": {
      return iconRunning;
    }
    case "connecting": {
      return iconLoading;
    }
    case "error": {
      return iconError;
    }
    case "disconnected":
    case "idle": {
      return iconIdle;
    }
    default: {
      return iconIdle;
    }
  }
}

// ═══════ 任务/工具输出行(severity) ═══════

export type OutputSeverity = "error" | "warning" | "info" | (string & {});

/** 输出严重性 → 图标 */
export function outputSeverityIcon(severity: OutputSeverity): string {
  switch (severity) {
    case "error": {
      return iconError;
    }
    case "warning": {
      return iconWarning;
    }
    case "info": {
      return symInfo;
    }
    default: {
      return symDot;
    }
  }
}

// ═══════ 任务条目(phase/item)状态 ═══════

/** Todo 工具 item 状态:completed / inProgress / pending */
export function todoItemStatusIcon(status: string): string {
  switch (status) {
    case "completed": {
      return iconTasks;
    }
    case "inProgress":
    case "in_progress": {
      return iconLoading;
    }
    case "pending":
    default: {
      return symEmpty;
    }
  }
}

// ═══════ 列表(选择/未选择) ═══════

/** 选项选中状态 → 图标(用于 question 组件) */
export function optionPickedIcon(picked: boolean): string {
  return picked ? symCheck : symEmpty;
}

// ═══════ 集合别名(便于 import 收敛) ═══════

/** 文件 / 目录 → 图标 */
export function entryKindIcon(kind: "file" | "folder"): string {
  return kind === "folder" ? iconFolder : symEmpty;
}

// ═══════ 状态 - 颜色 - 标签 三元组(用于 permission) ═══════

export interface RiskGlyph {
  icon: string;
  color: "success" | "warning" | "error";
}

/** 风险等级 → 图标 + 推荐色(供 permissionDialog 使用) */
export function riskGlyph(level: RiskLevel): RiskGlyph {
  switch (level) {
    case "low": {
      return { icon: iconSuccess, color: "success" };
    }
    case "medium": {
      return { icon: iconWarning, color: "warning" };
    }
    case "high": {
      return { icon: iconError, color: "error" };
    }
    default: {
      return { icon: iconUnknown, color: "warning" };
    }
  }
}

// ═══════ 锁定 / 公开 / 私有 状态 ═══════

/** 锁定状态 → 图标 */
export function lockStateIcon(locked: boolean): string {
  return locked ? iconLock : iconDefault;
}

/** 公开/私有 → 图标 */
export function visibilityIcon(visibility: "public" | "private" | (string & {})): string {
  return visibility === "public" ? iconPublic : iconPrivate;
}

// ═══════ 动画字形序列(供 animations.ts 使用) ═══════

/** 成功动画字形序列(供 spinner / 动效使用) */
export const successGlyphs: readonly string[] = [symCheck];
/** 失败动画字形序列 */
export const errorGlyphs: readonly string[] = [symCross];
/** 警告动画字形序列 */
export const warnGlyphs: readonly string[] = [symWarn];
/** 信息动画字形序列 */
export const infoGlyphs: readonly string[] = [symInfo];
/** 加载动画字形序列(占位) */
export const loadingGlyphs: readonly string[] = [iconLoading];
/** 更多动作字形(overflow menu) */
export const moreGlyph = actionMore;

// ═══════ 等宽单字符(用于行内输出、列对齐) ═══════

/** 成功勾选 ✓ */
export const asciiCheckGlyph = asciiCheck;
/** 失败叉号 ✗ */
export const asciiCrossGlyph = asciiCross;
/** 圆点 • */
export const asciiBulletGlyph = asciiBullet;
/** 圆圈 ○ */
export const asciiCircleGlyph = asciiCircle;
/** 半圆 ◐ */
export const asciiHalfGlyph = asciiHalf;
/** 禁止 ⊘ */
export const asciiNoEntryGlyph = asciiNoEntry;
/** 旋转/进行中 ⟳ */
export const asciiSpinnerGlyph = asciiSpinner;
/** 菱形 ◆ */
export const asciiDiamondGlyph = asciiDiamond;
/** 空心菱形 ◇ */
export const asciiDiamondOpenGlyph = asciiDiamondOpen;
/** 长破折号 — */
export const asciiEmDashGlyph = asciiEmDash;

// ═══════ 行内布尔成功/失败(原 const icon = success ? "✓" : "✗") ═══════

/** 成功 → ✓ / 失败 → ✗(行内字符,用于 export / export 头部 / 反馈行) */
export function inlineSuccessIcon(success: boolean): string {
  return success ? asciiCheck : asciiCross;
}

/** 行内成功/失败(Heavy 风格 ✘) */
export function inlineSuccessIconHeavy(success: boolean): string {
  return success ? asciiCheck : asciiCross;
}

/** 工具调用结果(✓/✗) — CodebaseSearchStatus 风格 */
export function toolResultGlyph(success: boolean): string {
  return success ? asciiCheck : asciiCross;
}

/** 状态提示:"已读" / "未读"(•/ ) */
export function bulletGlyph(active: boolean): string {
  return active ? asciiBullet : " ";
}

/** 注意力提示(⏳ / 空白) */
export function waitingGlyph(active: boolean): string {
  return active ? asciiSpinner : "";
}

// ═══════ 复选框 字符(用于菜单/选项) ═══════

/** [✓] 勾 / [•] 提示 / [ ] 空(用于 settings 菜单多状态) */
export function triStateIcon(state: "checked" | "indeterminate" | "unchecked"): string {
  if (state === "checked") {
    return "[✓]";
  }
  if (state === "indeterminate") {
    return "[•]";
  }
  return "[ ]";
}

/** 内嵌 [✓] / [ ] 富文本复选框(在标签内使用) */
export function inlineCheckboxIcon(checked: boolean): string {
  return checked ? `[${asciiCheck}]` : "[ ]";
}

// ═══════ 行内三个状态:成功/失败/进行(用于 sessionTaskItems 等) ═══════

/** 任务/工具行 状态 字符前缀(⟳ / ✓ / ✗) */
export function taskLinePrefix(status: "running" | "done" | "error" | (string & {})): string {
  if (status === "running") {
    return asciiSpinner;
  }
  if (status === "done") {
    return asciiCheck;
  }
  if (status === "error") {
    return asciiCross;
  }
  return "";
}

/** 通过内容前缀字符反推状态 */
export function statusFromContentPrefix(content: string): "running" | "done" | "error" | "unknown" {
  if (content.startsWith(asciiSpinner)) {
    return "running";
  }
  if (content.startsWith(asciiCheck)) {
    return "done";
  }
  if (content.startsWith(asciiCross) || content.startsWith(asciiCrossHeavy)) {
    return "error";
  }
  return "unknown";
}

// ═══════ Radio 单选 ═══════

/** Radio 选中状态字符(● / ○) */
export function radioGlyph(selected: boolean): string {
  return selected ? asciiDot : asciiCircle;
}

/** Radio 选中(强调)状态字符(◉ / ◎) */
export function radioGlyphAlt(selected: boolean): string {
  return selected ? asciiDotFilled : asciiCircleDouble;
}

// ═══════ 展开/折叠 ═══════

/** 展开/折叠字符(▼ / ▶) */
export function expandCollapseIcon(expanded: boolean): string {
  return expanded ? asciiTriangleDown : asciiTriangleRight;
}

/** 折叠状态字符(▽ / ▷) */
export function expandCollapseIconAlt(expanded: boolean): string {
  return expanded ? asciiTriangleDownOpen : asciiTriangleRightOpen;
}

// ═══════ 方向箭头 ═══════

export type ArrowDirection = "right" | "left" | "up" | "down" | "swap" | (string & {});

/** 方向箭头字符(→ / ← / ↑ / ↓ / ⇆) */
export function arrowGlyph(direction: ArrowDirection): string {
  if (direction === "right") {
    return symArrowRight;
  }
  if (direction === "left") {
    return symArrowLeft;
  }
  if (direction === "up") {
    return symArrowUp;
  }
  if (direction === "down") {
    return symArrowDown;
  }
  if (direction === "swap") {
    return symArrowSwap;
  }
  return symArrowRight;
}

// ═══════ 时钟/计时/进度控制 ═══════

export type TimerKind =
  | "budget"
  | "loading"
  | "alarm"
  | "pause"
  | "stop"
  | "skip"
  | "forward"
  | "rewind"
  | "record"
  | (string & {});

/** 时钟/进度控制字符(⏱/⏳/⏰/⏸/⏹/⏭/⏮/⏯/⏺) */
export function timerGlyph(kind: TimerKind): string {
  if (kind === "budget") {
    return asciiTimer;
  }
  if (kind === "loading") {
    return iconLoading;
  }
  if (kind === "alarm") {
    return iconLoading;
  }
  if (kind === "pause") {
    return iconPause;
  }
  if (kind === "stop") {
    return asciiStop;
  }
  if (kind === "skip") {
    return iconIdle;
  }
  if (kind === "forward") {
    return symArrowRight;
  }
  if (kind === "rewind") {
    return symArrowLeft;
  }
  if (kind === "record") {
    return asciiDot;
  }
  return iconLoading;
}

// ═══════ 行内 选中/未选中 指示器 ═══════

/** 行内选中(▸)/未选中(■)指示器(用于像素编辑器、tree 等) */
export function pickerGlyph(active: boolean, activeChar = "▸", inactiveChar = "■"): string {
  return active ? activeChar : inactiveChar;
}

// ═══════ 工具调用生命周期状态(扩展版) ═══════

/** 工具调用生命周期(cancelled/completed/error/executing/running/pending) */
export function toolStatusGlyph(status: string): string {
  switch (status) {
    case "completed": {
      return asciiCheck;
    }
    case "error": {
      return asciiCross;
    }
    case "cancelled": {
      return asciiNoEntry;
    }
    case "executing":
    case "running": {
      return iconLoading;
    }
    case "pending":
    default: {
      return symEmpty;
    }
  }
}

// ═══════ 会话列表 / 子状态 ═══════

/** 会话级状态字符(可省略 空白) */
export function sessionItemGlyph(state: string): string {
  switch (state) {
    case "active": {
      return asciiCircle;
    }
    case "idle": {
      return asciiHalf;
    }
    case "archived": {
      return asciiEmDash;
    }
    default: {
      return "";
    }
  }
}

// ═══════ 队列项 / 任务序列(用于 appCommands) ═══════

/** 队列项指示符(▶ / ● / ○) */
export function queueItemGlyph(kind: "current" | "active" | "pending"): string {
  if (kind === "current") {
    return symArrowRight;
  }
  if (kind === "active") {
    return symDot;
  }
  return symEmpty;
}

// ═══════ 风险色卡(原 permissionDialog 内联) ═══════

export interface RiskCard {
  icon: string;
  color: "success" | "warning" | "error";
  label: string;
}

/** 风险等级 → {icon, color, label} (中文) */
export function riskCard(level: RiskLevel, locale: "zh" | "en" = "zh"): RiskCard {
  const label =
    {
      low: locale === "zh" ? "低风险" : "Low risk",
      medium: locale === "zh" ? "中风险" : "Medium risk",
      high: locale === "zh" ? "高风险" : "High risk",
    }[level as "low" | "medium" | "high"] ?? (locale === "zh" ? "未知风险" : "Unknown");
  switch (level) {
    case "low": {
      return { icon: iconSuccess, color: "success", label };
    }
    case "medium": {
      return { icon: iconWarning, color: "warning", label };
    }
    case "high": {
      return { icon: iconError, color: "error", label };
    }
    default: {
      return { icon: iconUnknown, color: "warning", label };
    }
  }
}

// ═══════ IDE 状态(连接/加载/失败) ═══════

/** IDE 状态 → 字符(连接/加载/失败/断开) — 与 ideSelectPanel 保持一致 */
export function ideStatusGlyph(status: string): string {
  if (status === "connected") {
    return symCheck;
  }
  if (status === "connecting") {
    return symDot;
  }
  if (status === "error") {
    return symCross;
  }
  return symEmpty;
}

/** IDE 状态 → 字符(连接/加载/失败/断开) — 与 ideCommands 保持一致 */
export function ideConnectionGlyph(status: string): string {
  if (status === "connected") {
    return symCheck;
  }
  if (status === "connecting") {
    return symDot;
  }
  if (status === "error") {
    return symCross;
  }
  return symEmpty;
}

// ═══════ 工具分类图标(settings 锁定/MCP) ═══════

/** 工具/服务 分类图标(MCP 🔌 / LSP 🔦 / Hook 🪝 等) */
export function toolCategoryIcon(category: string): string {
  switch (category) {
    case "mcp": {
      return "🔌";
    }
    case "lsp": {
      return "🔦";
    }
    case "hook": {
      return "🪝";
    }
    case "agent": {
      return "🤖";
    }
    case "skill": {
      return "🏅";
    }
    case "team": {
      return "👥";
    }
    default: {
      return symDot;
    }
  }
}

// ═══════ 自定义命令 类型图标(◆/◇ 用于 sensitiveCommandConfig) ═══════

/** 命令来源标识(预设 ◆ / 自定义 ◇) */
export function commandSourceIcon(isPreset: boolean): string {
  return isPreset ? asciiDiamond : asciiDiamondOpen;
}

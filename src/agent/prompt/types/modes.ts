/**
 * 模式类型定义 — 6 种对话模式及元信息管理。
 *
 * 职责:
 *   - 定义 ChatMode 类型(chat/plan/team/yolo/simple/security)
 *   - 管理各模式的元信息(图标、标签、描述)
 *   - 提供模式查询和判断工具函数
 *
 * 模块功能:
 *   - ChatMode: 对话模式类型定义
 *   - ModeMeta: 模式元信息接口
 *   - MODE_META: 所有模式的元信息常量
 *   - getModeMeta(): 获取指定模式的元信息
 *   - listModes(): 列出所有模式
 *   - isReadOnlyMode(): 判断是否为只读模式(plan/security)
 *   - isAutoApproveMode(): 判断是否跳过权限确认(yolo)
 *   - isToollessMode(): 判断是否为无工具模式(simple)
 *
 * 使用场景:
 *   - 模式切换时获取模式元信息用于 UI 显示
 *   - 工具调用前检查当前模式权限
 *   - 模式切换命令处理(/plan、/team、/yolo、/simple、/security)
 *
 * 边界:
 * 1. 只读模式(plan/security):不允许使用工具修改文件
 * 2. 自动批准模式(yolo):跳过所有权限确认
 * 3. 无工具模式(simple):纯文本对话，不提供任何工具
 * 4. 模式元信息用于 UI 显示，不影响核心逻辑
 *
 * 流程:
 * 1. 用户执行模式切换命令
 * 2. 解析命令获取目标模式
 * 3. 调用 getModeMeta() 获取模式信息
 * 4. 更新当前模式状态
 * 5. 根据模式类型应用相应约束
 */

import { iconLock, iconLsp, iconTeam } from "@/core/icons/icon";

/** 对话模式 */
export type ChatMode = "chat" | "plan" | "team" | "yolo" | "simple" | "security";

/** 模式元信息(UI 显示用) */
export interface ModeMeta {
  /** 模式标识 */
  mode: ChatMode;
  /** 显示图标 */
  icon: string;
  /** 显示标签 */
  label: string;
  /** 模式描述 */
  description: string;
  /** 对应的 Agent 名称(用于自动切换 Agent) */
  agentName?: string;
}

/** 所有模式的元信息 */
export const MODE_META: Record<ChatMode, ModeMeta> = {
  chat: {
    description: "默认对话模式，直接与 AI 交互",
    icon: "💬",
    label: "对话",
    mode: "chat",
  },
  plan: {
    agentName: "plan",
    description: "计划模式:AI 先分析需求并制定计划，确认后再执行",
    icon: "📋",
    label: "Plan",
    mode: "plan",
  },
  security: {
    description: "安全审计模式:专注于漏洞检测和安全分析",
    icon: "🛡️",
    label: "Security",
    mode: "security",
  },
  simple: {
    description: "简单模式:纯文本对话，不使用工具",
    icon: iconLsp,
    label: "Simple",
    mode: "simple",
  },
  team: {
    agentName: "team-lead",
    description: "团队模式:AI 协调多个子代理并行工作",
    icon: iconTeam,
    label: "Team",
    mode: "team",
  },
  yolo: {
    description: "YOLO 模式:自动执行所有操作，跳过确认",
    icon: iconLock,
    label: "YOLO",
    mode: "yolo",
  },
};

/** 获取模式元信息 */
export function getModeMeta(mode: ChatMode): ModeMeta {
  return MODE_META[mode];
}

/** 模式列表(用于 UI 遍历) */
export function listModes(): ModeMeta[] {
  return Object.values(MODE_META);
}

/** 是否为只读模式(不允许工具调用修改文件) */
export function isReadOnlyMode(mode: ChatMode): boolean {
  return mode === "plan" || mode === "security";
}

/** 是否跳过权限确认 */
export function isAutoApproveMode(mode: ChatMode): boolean {
  return mode === "yolo";
}

/** 是否为无工具模式 */
export function isToollessMode(mode: ChatMode): boolean {
  return mode === "simple";
}

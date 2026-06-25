/**
 * Hook 配置持久化 — 管理 .crab/hooks/ 目录下的 Hook 配置文件。
 *
 * 职责:
 *   - 管理 Hook 配置文件的读写
 *   - 支持 global/project 双作用域
 *   - 提供 Hook 事件到配置键的映射
 *
 * 模块功能:
 *   - loadHookConfig: 加载指定 Hook 事件的配置规则
 *   - loadHookConfigByEvent: 通过 HookEvent 加载配置
 *   - saveHookConfig: 保存 Hook 配置
 *   - deleteHookConfig: 删除 Hook 配置文件
 *   - listConfiguredHooks: 列出所有已配置的 Hook 键
 *   - getAllConfigKeys: 获取所有合法的配置键
 *   - isActionTypeAllowed: 验证 ActionType 是否允许
 *   - getHooksDir: 获取指定作用域的 hooks 目录
 *   - HOOK_EVENT_TO_CONFIG_KEY: HookEvent 到配置键的映射
 *   - CONFIG_KEY_TO_HOOK_EVENT: 配置键到 HookEvent 的映射
 *   - HookAction: Hook 执行动作接口
 *   - HookRule: Hook 规则接口
 *   - HookConfig: Hook 配置接口
 *   - HookScope: 作用域类型
 *
 * 使用场景:
 *   - 工具调用前后 Hook
 *   - 用户消息处理 Hook
 *   - 会话生命周期 Hook
 *   - 子代理事件 Hook
 *
 * 边界:
 *   1. 使用 ~/.crab/hooks/ 作为全局 Hook 配置目录
 *   2. 使用项目目录下的 .crab/hooks/ 作为项目级配置目录
 *   3. prompt 类型仅限于 onStop 和 onSubAgentComplete
 *   4. 支持 command 和 prompt 两种动作类型
 *
 * 流程:
 *   1. 确定作用域(global/project)
 *   2. 获取 hooks 目录路径
 *   3. 加载/保存/删除配置文件
 *   4. 解析 JSON 配置
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { getGlobalCrabDir } from "../paths/paths";
import type { HookEvent } from "@/hooks/types";
import { createInternalError } from "@/core/errors/appError";

const logHookConfig = (() => {
  // 延迟加载 logger 避免循环依赖:
  // hooksConfig 被 @hooks 模块导入，而 @hooks 也被 @core/logger 的消费者间接引用，
  // 顶层静态 import 会产生循环依赖，因此使用延迟初始化。
  let _log: ReturnType<typeof import("@/core/logging/logger").createLogger> | null = null;
  const getLog = async () => {
    if (!_log) {
      const { createLogger } = await import("@/core/logging/logger");
      _log = createLogger("config:hooks");
    }
    return _log!;
  };
  return {
    /** fire-and-forget: 调用方无需 await，异常仅记录到 stderr */
    error(msg: string, data?: Record<string, unknown>): void {
      void getLog().then((l) => l.error(msg, { payload: data }));
    },
    /** fire-and-forget: 调用方无需 await，异常仅记录到 stderr */
    warn(msg: string, data?: Record<string, unknown>): void {
      void getLog().then((l) => l.warn(msg, { payload: data }));
    },
  };
})();

// ─── Hook 配置类型 ────────────────────────────────────────

/** Hook 执行动作类型 */
export type HookActionType = "command" | "prompt";

/** Hook 执行动作 */
export interface HookAction {
  type: HookActionType;
  /** Type=command 时的 Shell 命令 */
  command?: string;
  /** Type=prompt 时的提示词模板 */
  prompt?: string;
  /** 超时时间(毫秒) */
  timeout?: number;
  /** 是否启用(默认 true) */
  enabled?: boolean;
}

/** Hook 规则 */
export interface HookRule {
  /** 匹配器(仅用于工具 Hooks，多个用逗号分隔，支持通配符 *) */
  matcher?: string;
  /** 规则描述 */
  description: string;
  /** 按顺序执行的 Hook 动作 */
  hooks: HookAction[];
}

/** Hook 配置 */
export type HookConfig = Record<string, HookRule[]>;

// ─── Hook 事件上下文类型 ──────────────────────────────────

export interface OnUserMessageContext {
  message: string;
  imageCount: number;
  source: "normal" | "pending";
}

export interface BeforeToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
}

export interface AfterToolCallContext {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  error: Error | null;
}

export interface ToolConfirmationContext {
  toolName: string;
  args: string | Record<string, unknown> | undefined;
  isSensitive?: boolean;
  allTools?: { name: string; arguments: string }[];
  matchedPattern?: string;
  matchedReason?: string;
}

export interface OnSubAgentCompleteContext {
  agentId: string;
  agentName: string;
  content: string;
  success: boolean;
  usage: unknown;
}

export interface BeforeCompressContext {
  messages: unknown[];
  conversationJson: string;
}

export interface OnSessionStartContext {
  messages: unknown[];
  messageCount: number;
}

export interface OnStopContext {
  messages: unknown[];
}

// ─── Hook 事件与上下文映射 ─────────────────────────────────

/**
 * HookEvent 到配置文件 hookType 的映射。
 * crab-cli 使用 HookEvent 枚举(PreToolUse 等)，
 * 配置文件使用小写 snake_case 键(beforeToolCall 等)。
 */
export const HOOK_EVENT_TO_CONFIG_KEY: Record<HookEvent, string> = {
  Compress: "beforeCompress",
  Notification: "onNotification",
  OnError: "onError",
  PostToolUse: "afterToolCall",
  PreToolUse: "beforeToolCall",
  SessionEnd: "onSessionEnd",
  SessionStart: "onSessionStart",
  SkillExecute: "onSkillExecute",
  Stop: "onStop",
  SubAgentStart: "onSubAgentStart",
  SubAgentStop: "onSubAgentComplete",
  ToolConfirmation: "toolConfirmation",
  UserMessage: "onUserMessage",
};

export const CONFIG_KEY_TO_HOOK_EVENT: Record<string, HookEvent> = {};
for (const [event, key] of Object.entries(HOOK_EVENT_TO_CONFIG_KEY)) {
  CONFIG_KEY_TO_HOOK_EVENT[key] = event as HookEvent;
}

/** 所有配置键(文件名用) */
export type ConfigHookKey = (typeof HOOK_EVENT_TO_CONFIG_KEY)[HookEvent];

// ─── 作用域 ───────────────────────────────────────────────

export type HookScope = "global" | "project";

/**
 * 获取指定作用域的 hooks 目录。
 */
export function getHooksDir(scope: HookScope): string {
  if (scope === "global") {
    return join(getGlobalCrabDir(), "hooks");
  }
  return join(cwd(), ".crab", "hooks");
}

function ensureHooksDirectory(scope: HookScope): void {
  const hooksDir = getHooksDir(scope);
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }
}

function getHookFilePath(configKey: string, scope: HookScope): string {
  return join(getHooksDir(scope), `${configKey}.json`);
}

// ─── 配置读写 ─────────────────────────────────────────────

/**
 * 加载指定 Hook 事件的配置规则。
 */
export function loadHookConfig(configKey: string, scope: HookScope): HookRule[] {
  ensureHooksDirectory(scope);
  const filePath = getHookFilePath(configKey, scope);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const data = JSON.parse(content);

    // 支持直接数组格式
    if (Array.isArray(data)) {
      return data;
    }

    // 支持对象格式 { configKey: HookRule[] }
    if (data[configKey]) {
      return data[configKey];
    }

    return [];
  } catch (error) {
    logHookConfig.warn(`加载 Hook 配置失败: ${configKey}`, {
      error: String(error),
    });
    return [];
  }
}

/**
 * 通过 HookEvent 加载配置(自动转换为配置键)。
 */
export function loadHookConfigByEvent(event: HookEvent, scope: HookScope): HookRule[] {
  const configKey = HOOK_EVENT_TO_CONFIG_KEY[event];
  return configKey ? loadHookConfig(configKey, scope) : [];
}

/**
 * 保存 Hook 配置。
 */
export function saveHookConfig(configKey: string, scope: HookScope, rules: HookRule[]): void {
  ensureHooksDirectory(scope);
  const filePath = getHookFilePath(configKey, scope);

  try {
    const config: HookConfig = { [configKey]: rules };
    writeFileSync(filePath, JSON.stringify(config, null, 4), "utf8");
  } catch (error) {
    throw createInternalError("INTERNAL_ERROR", `保存 Hook 配置失败 ${configKey}: ${String(error)}`);
  }
}

/**
 * 删除 Hook 配置文件。
 */
export function deleteHookConfig(configKey: string, scope: HookScope): void {
  const filePath = getHookFilePath(configKey, scope);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

/**
 * 列出指定作用域下所有已配置的 Hook 键。
 */
export function listConfiguredHooks(scope: HookScope): string[] {
  ensureHooksDirectory(scope);
  const hooksDir = getHooksDir(scope);

  try {
    const files = readdirSync(hooksDir);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

/**
 * 获取所有合法的配置键。
 */
export function getAllConfigKeys(): string[] {
  return Object.values(HOOK_EVENT_TO_CONFIG_KEY);
}

/**
 * 验证 HookActionType 是否允许在指定配置键中使用。
 * prompt 类型仅限于 onStop、onSubAgentComplete 和 onError。
 */
export function isActionTypeAllowed(configKey: string, actionType: HookActionType): boolean {
  if (actionType === "prompt") {
    return configKey === "onStop" || configKey === "onSubAgentComplete" || configKey === "onError";
  }
  return true;
}

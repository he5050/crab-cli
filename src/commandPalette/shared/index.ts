/**
 * 应用命令共享模块 — 提供命令依赖注入和通用工具。
 *
 * 职责:
 *   - 定义细粒度的命令依赖接口（遵循接口隔离原则）
 *   - 提供获取应用配置的辅助函数
 *   - 提供错误消息提取工具函数
 *   - 共享命令上下文类型定义
 *   - 支持命令间的依赖注入模式
 *
 * 模块功能:
 *   - NavigationDeps: 导航相关依赖
 *   - UIDeps: UI 反馈相关依赖
 *   - ConfigDeps: 配置相关依赖
 *   - SessionDeps: 会话相关依赖
 *   - EventBusDeps: 事件总线依赖
 *   - CommandDeps: 完整命令依赖（组合所有细粒度接口）
 *   - getAppConfig: 获取类型化的应用配置
 *   - getErrorMessage: 从未知错误中提取消息
 *
 * 使用场景:
 *   - 命令实现依赖注入
 *   - 命令间共享上下文
 *   - 导航和 UI 操作
 *   - 获取应用配置和会话信息
 *   - 统一的错误消息提取
 *
 * 边界:
 *   1. 仅定义类型和简单辅助函数
 *   2. 不包含具体命令实现
 *   3. 依赖接口中的方法由外部注入实现
 *
 * 流程:
 *   1. 定义细粒度依赖接口
 *   2. 组合为 CommandDeps 保持向后兼容
 *   3. 实现辅助函数
 *   4. 各命令模块通过 CommandDeps 获取所需依赖
 *   5. 应用初始化时注入具体的依赖实现
 */

import type { AppConfigSchema } from "@/schema/config";
import type { EventBus } from "@/bus";

/**
 * 导航相关依赖 — 仅包含导航操作
 */
export interface NavigationDeps {
  navigate: (route: { type: string; [key: string]: unknown }) => void;
  back: () => void;
  requestExit: () => void;
}

/**
 * UI 反馈相关依赖 — 仅包含 UI 操作
 */
export interface UIDeps {
  clearScreen?: () => void;
  showToast?: (message: string, variant?: "success" | "warning" | "error" | "info") => void;
}

/**
 * 配置相关依赖 — 仅包含配置读取
 */
export interface ConfigDeps {
  getConfig?: () => AppConfigSchema | undefined;
}

/**
 * 会话相关依赖 — 仅包含会话操作
 */
export interface SessionDeps {
  getCurrentSessionId?: () => string | undefined;
  createSession?: () => void;
  getConversationHistory?: () => import("ai").ModelMessage[];
  sessionApi?: typeof import("@session");
  rollbackApi?: typeof import("@/tool/rollback/crossSession");
}

/**
 * 事件总线依赖
 */
export interface EventBusDeps {
  eventBus?: EventBus;
}

/**
 * 命令依赖接口 — 定义命令执行所需的依赖（组合所有细粒度接口，保持向后兼容）
 */
export interface CommandDeps extends NavigationDeps, UIDeps, ConfigDeps, SessionDeps, EventBusDeps {}

/**
 * 获取类型化的应用配置
 */
export function getAppConfig(deps: CommandDeps): AppConfigSchema | undefined {
  return deps.getConfig?.();
}

/**
 * 从未知错误中提取消息 — 统一的错误消息提取工具
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

/**
 * 显示错误 toast — 统一的错误反馈工具
 */
export function showErrorToast(deps: CommandDeps, error: unknown): void {
  deps.showToast?.(getErrorMessage(error), "error");
}

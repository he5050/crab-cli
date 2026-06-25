/**
 * [Hook 系统] — 统一出口
 *
 * 职责:
 *   - 统一导出 Hook 系统所有公共接口
 *   - 提供类型定义、执行器、注册表、策略解释器等核心组件
 *   - 简化外部模块对 Hook 系统的使用
 *
 * 子模块:
 *   - types.ts          核心类型（HookEvent, HookContext, HookDecision 等）
 *   - hookRegistry.ts   Hook 注册表（全局单例）
 *   - hookExecutor.ts   Hook 执行器（基于注册表，shell + builtin）
 *   - hookStrategies.ts 13 种事件策略解释器
 *   - unifiedHookExecutor.ts 配置文件驱动执行器（command + prompt）
 *   - shellHook.ts      Shell 命令执行器
 *   - builtinHooks.ts   4 个内置 Hook
 *   - statuslineHook.ts 状态栏 Hook
 *
 * 边界:
 *   1. 仅作为入口文件，不包含具体实现逻辑
 *   2. 所有公共 API 均从此文件导出
 *   3. 所有实现逻辑由子模块提供
 */

// ─── 类型导出 ─────────────────────────────────────────────
export type {
  AnyHookResult,
  CommandHookResult,
  HookActionResult,
  HookContext,
  HookDecision,
  HookDefinition,
  HookEvent,
  HookResult,
  HookType,
  PromptHookResponse,
  PromptHookResult,
} from "./types";

export type { StatusLineHookResult, StatusLineSegment } from "./statuslineHook";

// ─── 注册表 ──────────────────────────────────────────────
export { hookRegistry } from "./hookRegistry";

// ─── 执行器（注册表驱动，shell + builtin）────────────────
export { HookExecutor, hookExecutor } from "./hookExecutor";

// ─── 策略解释器 ─────────────────────────────────────────
export { hookStrategies, interpretHookResult } from "./hookStrategies";
export type { InterpretedHookResult } from "./hookStrategies";

// ─── 统一执行器（配置文件驱动，command + prompt）──────────
export { UnifiedHooksExecutor, unifiedHooksExecutor } from "./unifiedHookExecutor";
export type { UnifiedHookExecutionResult } from "./unifiedHookExecutor";

// ─── Shell Hook ───────────────────────────────────────────
export { executeShellHook } from "./shellHook";

// ─── 内置 Hook ───────────────────────────────────────────
export { builtinHooks, registerBuiltinHooks } from "./builtinHooks";

// ─── 状态栏 Hook ─────────────────────────────────────────
export { executeStatusLineHooks, formatStatusLine, getDefaultStatusLine } from "./statuslineHook";

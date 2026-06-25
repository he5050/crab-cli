/**
 * AgentSession 依赖注入单例 + 测试替身管理。
 *
 * 设计动机:
 *   - session.ts 中的 ConversationHandler / hookExecutor / buildAgentRuntimeAugmentations
 *     需在单测中可被替换为 mock.
 *   - 集中管理 deps 单例便于跨文件协调, 同时保证外部 API 兼容.
 *   - 生产代码引用只读 getter 视图，防止意外修改，同时允许测试替换后备存储。
 *
 * 循环依赖说明:
 *   session.ts → sessionDeps.ts → conversationHandler.ts → @/agent → session.ts
 *   使用 Bun 的 import.meta.require() 在 getter 中同步延迟加载,
 *   可绕过 ESM 静态分析阶段的 TDZ (Temporal Dead Zone) 问题.
 *   import.meta.require 是 Bun 运行时提供的同步 require, 支持 ESM 模块.
 */
import type { ConversationHandler as ConversationHandlerType } from "@/conversation/core/conversationHandler";
import type { buildAgentRuntimeAugmentations as BuildAugmentationsType } from "@/agent/runtime/augmentations";
import { subAgentTracker } from "@/agent/subagent/tracker";
import { hookExecutor } from "@/hooks/hookExecutor";

// ─── 同步懒加载（Bun import.meta.require）──────────────────────────

function lazyConversationHandler(): typeof ConversationHandlerType {
  return import.meta.require("@/conversation/core/conversationHandler").ConversationHandler;
}

function lazyBuildAgentRuntimeAugmentations(): typeof BuildAugmentationsType {
  return import.meta.require("@/agent/runtime/augmentations").buildAgentRuntimeAugmentations;
}

// ─── 后备存储（仅测试辅助函数可修改）──────────────────────────────

interface AgentSessionDepsShape {
  ConversationHandler: typeof ConversationHandlerType;
  buildAgentRuntimeAugmentations: typeof BuildAugmentationsType;
  hookExecutor: typeof hookExecutor;
  subagentCollector?: SubagentResultCollector;
}

const _deps: AgentSessionDepsShape = {
  ConversationHandler: null as unknown as typeof ConversationHandlerType,
  buildAgentRuntimeAugmentations: null as unknown as typeof BuildAugmentationsType,
  hookExecutor,
  subagentCollector: subAgentTracker,
};

// ─── 只读导出（生产代码使用）──────────────────────────────────────

/** 只读视图：生产代码使用此引用，测试辅助函数修改后备存储后可即时生效 */
export const agentSessionDeps: Readonly<AgentSessionDepsShape> = {
  get ConversationHandler() {
    if (!_deps.ConversationHandler) {
      _deps.ConversationHandler = lazyConversationHandler();
    }
    return _deps.ConversationHandler;
  },
  get buildAgentRuntimeAugmentations() {
    if (!_deps.buildAgentRuntimeAugmentations) {
      _deps.buildAgentRuntimeAugmentations = lazyBuildAgentRuntimeAugmentations();
    }
    return _deps.buildAgentRuntimeAugmentations;
  },
  get hookExecutor() {
    return _deps.hookExecutor;
  },
  get subagentCollector() {
    return _deps.subagentCollector;
  },
};

export type AgentSessionDeps = typeof agentSessionDeps;

// ─── 子代理结果收集器接口 ─────────────────────────────────────────

/** 子代理结果收集器抽象接口，用于解耦 session 与 subAgentTracker 全局单例 */
export interface SubagentResultCollector {
  register(opts: {
    instanceId: string;
    agentId: string;
    agentName: string;
    prompt?: string;
    abortController?: AbortController;
  }): void;
  unregister(instanceId: string): void;
  waitForSpawnedAgents(instanceIds: string[], timeoutMs: number, signal?: AbortSignal): Promise<void>;
  drainSpawnedResults(instanceId: string): import("@/agent/subagent/tracker").SpawnedResult[];
  drainOrphanedResults(): import("@/agent/subagent/tracker").SpawnedResult[];
  dequeueMessages(instanceId: string): string[];
  dequeueInterAgentMessages(instanceId: string): import("@/agent/subagent/tracker").InterAgentMessage[];
  isRunning(instanceId: string): boolean;
}

// ─── 测试辅助函数（修改后备存储后重新冻结导出）──────────────────────

/**
 * 替换部分依赖, 用于单元测试.
 * 调用方应配套使用 __resetAgentSessionDepsForTesting 清理.
 */
export function __setAgentSessionDepsForTesting(overrides: Partial<AgentSessionDepsShape>): void {
  Object.assign(_deps, overrides);
}

/**
 * 恢复依赖为生产实现, 配套 __setAgentSessionDepsForTesting 使用.
 */
export function __resetAgentSessionDepsForTesting(): void {
  _deps.ConversationHandler = lazyConversationHandler();
  _deps.hookExecutor = hookExecutor;
  _deps.buildAgentRuntimeAugmentations = lazyBuildAgentRuntimeAugmentations();
  _deps.subagentCollector = subAgentTracker;
}

/** 为测试设置子代理结果收集器. */
export function __setSubagentCollectorForTesting(collector: SubagentResultCollector | undefined): void {
  _deps.subagentCollector = collector;
}

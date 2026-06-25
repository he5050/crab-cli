/**
 * Agent 模块内部事件总线.
 *
 * 设计目的:
 *   - 避免 agent 内部 10+ 处重复写 `globalBus.publish(AppEvent.X, payload)` 模板
 *   - 提供类型安全: payload 类型从 @bus/events 的 EventPayloadMap 推导
 *   - 不替代 globalBus, 而是薄封装(底层仍然 publish 到 globalBus, 保持跨模块兼容)
 *
 * 使用:
 *   import { agentEvents } from "@/agent/core/agentEvents"
 *   agentEvents.agentSelected({ agentName, previousAgent })
 *   agentEvents.subagentStarted({ parentAgent, subagentName, taskId })
 *
 * 边界:
 *   1. 仅暴露 agent 模块"产生"的事件(不暴露全部 AppEvent)
 *   2. 不替代 globalBus.subscribe 行为(订阅仍走 globalBus 或各模块自有 emitter)
 *   3. 所有事件 payload 类型来自 @bus/events 的 EventPayloadMap, 单一事实源
 *   4. 子代理强制终止/超时事件不在 AppEvent 中, 仍走 @config/constants 字符串
 */
import { globalBus, type EventBus } from "@/bus/core/eventBus";
import { AgentEvents } from "@/bus/events/agentEvents";
import { CompressEvents } from "@/bus/events/compressEvents";
import { LifecycleEvents } from "@/bus/events/lifecycleEvents";
import { PermissionEvents } from "@/bus/events/permissionEvents";

/**
 * payload 类型推导(直接来自 EventPayloadMap[K], 即事件 properties 形状).
 */
type EventDefinitionPayload<T> = T extends { type: string }
  ? T extends import("@/bus/core/types").EventDefinition<infer P>
    ? P
    : never
  : never;

type AgentSelectedPayload = EventDefinitionPayload<typeof AgentEvents.AgentSelected>;
type AgentStatusChangedPayload = EventDefinitionPayload<typeof AgentEvents.AgentStatusChanged>;
type ToastPayload = EventDefinitionPayload<typeof LifecycleEvents.Toast>;
type CompressCompletedPayload = EventDefinitionPayload<typeof CompressEvents.CompressCompleted>;
type PermissionAskedPayload = EventDefinitionPayload<typeof PermissionEvents.PermissionAsked>;
type PermissionResolvedPayload = EventDefinitionPayload<typeof PermissionEvents.PermissionResolved>;
type SubagentStartedPayload = EventDefinitionPayload<typeof AgentEvents.SubagentStarted>;
type SubagentCompletedPayload = EventDefinitionPayload<typeof AgentEvents.SubagentCompleted>;

/**
 * Agent 模块事件命名空间.
 *
 * 每个方法对应一个 @bus/events 中已定义的事件.
 * 命名风格: 驼峰式(去除 dot), 与 TypeScript 习惯一致.
 */
export function createAgentEvents(eventBus?: EventBus) {
  const getBus = () => eventBus ?? globalBus;

  return {
    // ─── Agent 生命周期 ─────────────────────────────────
    /** 活跃 Agent 切换 */
    agentSelected(payload: AgentSelectedPayload): void {
      getBus().publish(AgentEvents.AgentSelected, payload);
    },

    /** Agent 状态变化 */
    agentStatusChanged(payload: AgentStatusChangedPayload): void {
      getBus().publish(AgentEvents.AgentStatusChanged, payload);
    },

    // ─── UI 通知 ───────────────────────────────────────
    /** Toast 通知(由 modeState 等模块触发) */
    toast(payload: ToastPayload): void {
      getBus().publish(LifecycleEvents.Toast, payload);
    },

    // ─── 压缩 ───────────────────────────────────────────
    /** 压缩完成(供 runtime/compression 订阅) */
    compressCompleted(payload: CompressCompletedPayload): void {
      getBus().publish(CompressEvents.CompressCompleted, payload);
    },

    // ─── 权限 ───────────────────────────────────────────
    /** 权限询问(MCP E2E 测试用) */
    permissionAsked(payload: PermissionAskedPayload): void {
      getBus().publish(PermissionEvents.PermissionAsked, payload);
    },

    /** 权限决议 */
    permissionResolved(payload: PermissionResolvedPayload): void {
      getBus().publish(PermissionEvents.PermissionResolved, payload);
    },

    // ─── 子代理 ─────────────────────────────────────────
    /** 子代理启动 */
    subagentStarted(payload: SubagentStartedPayload): void {
      getBus().publish(AgentEvents.SubagentStarted, payload);
    },

    /** 子代理完成(成功或失败) */
    subagentCompleted(payload: SubagentCompletedPayload): void {
      getBus().publish(AgentEvents.SubagentCompleted, payload);
    },
  } as const;
}

/** 默认 Agent 事件实例(使用全局 EventBus) */
export const agentEvents = createAgentEvents();

/**
 * Agent 事件订阅便捷方法.
 * 仅暴露 agent 模块关心的"输入"事件, 避免其他模块直接订阅完整 AppEvent.
 *
 * 使用:
 *   const unsub = subscribeAgentEvents({
 *     onCompressCompleted: (payload) => { ... }
 *   })
 */
export interface AgentEventSubscribers {
  onCompressCompleted?: (payload: CompressCompletedPayload) => void;
  onPermissionAsked?: (payload: PermissionAskedPayload) => void;
}

export function subscribeAgentEvents(subscribers: AgentEventSubscribers, eventBus?: EventBus): () => void {
  const bus = eventBus ?? globalBus;
  const unsubs: (() => void)[] = [];

  if (subscribers.onCompressCompleted) {
    unsubs.push(
      bus.subscribe(CompressEvents.CompressCompleted, (evt) => {
        subscribers.onCompressCompleted?.(evt.properties);
      }),
    );
  }
  if (subscribers.onPermissionAsked) {
    unsubs.push(
      bus.subscribe(PermissionEvents.PermissionAsked, (evt) => {
        subscribers.onPermissionAsked?.(evt.properties);
      }),
    );
  }

  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}

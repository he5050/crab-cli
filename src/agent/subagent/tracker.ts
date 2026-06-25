/**
 * 子代理运行时追踪器 — 追踪所有运行中的子代理，支持消息注入和状态查询。
 *
 * 职责:
 *   - 注册/注销运行中的子代理
 *   - 子代理间消息传递(send_message_to_agent)
 *   - 用户消息注入到子代理上下文
 *   - spawn 结果收集
 *   - 异步等待 spawned children 完成
 *   - 管理子代理生命周期事件通知
 *
 * 模块功能:
 *   - RunningSubAgentTracker: 子代理追踪器类
 *   - InterAgentMessage: Agent 间消息接口
 *   - SpawnedResult: Spawn 结果接口
 *   - SubAgentStatus: 子代理状态摘要接口
 *   - TrackerChangeEvent: 追踪器变更事件类型
 *   - subAgentTracker: 全局追踪器实例
 *
 * 使用场景:
 *   - 多 Agent 协作时的状态追踪
 *   - 子代理间消息传递
 *   - 用户消息注入到子代理上下文
 *   - 异步收集 spawn 结果
 *   - 等待 spawned children 完成
 *
 * 边界:
 *   1. 仅维护内存中的运行时状态，不持久化
 *   2. 不负责实际的 Agent 执行逻辑
 *   3. 消息队列在取出后清空，不保留历史
 *   4. 孤儿结果(orphaned results)仅临时存储
 *
 * 流程:
 *   1. 子代理启动时调用 register() 注册
 *   2. 运行期间:
 *      - 通过 injectMessage() 注入用户消息
 *      - 通过 sendInterAgentMessage() 进行 Agent 间通信
 *      - 通过 storeSpawnedResult() 存储 spawn 结果
 *   3. 子代理完成时调用 unregister() 注销
 *   4. 父代理通过 waitForSpawnedAgents() 等待子代理完成
 *   5. 通过 drainSpawnedResults() 获取子代理结果
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("agent:tracker");

// ─── 类型定义 ────────────────────────────────────────────────

/** Agent 间消息 */
export interface InterAgentMessage {
  fromAgentId: string;
  fromAgentName: string;
  fromInstanceId: string;
  content: string;
}

/** Spawn 结果 */
export interface SpawnedResult {
  instanceId: string;
  agentId: string;
  agentName: string;
  prompt: string;
  success: boolean;
  result: string;
  error?: string;
  completedAt: Date;
}

/** 聚合的子代理结果(简化版，用于父代理消费) */
export interface AggregatedSpawnedChildResult {
  agentName: string;
  success: boolean;
  result: string;
  error?: string;
}

/** Spawned 结果提取器接口 */
export interface SpawnedResultDrainer {
  drainSpawnedResults(instanceId: string): SpawnedResult[];
  drainOrphanedResults(): SpawnedResult[];
}

/** 运行中子代理实例 */
interface RunningSubAgent {
  /** 实例 ID */
  instanceId: string;
  /** Agent 类型 ID */
  agentId: string;
  /** Agent 显示名称 */
  agentName: string;
  /** 初始 prompt(截断到 200 字符) */
  prompt: string;
  /** 启动时间 */
  startedAt: Date;
  /** 运行状态 */
  status: "running" | "paused" | "completed" | "failed";
  /** 待处理的用户消息队列 */
  messageQueue: string[];
  /** Agent 间消息队列 */
  interAgentMessageQueue: InterAgentMessage[];
  /** Spawn 结果队列 */
  spawnedResults: SpawnedResult[];
  /** 中止信号 */
  abortController?: AbortController;
}

/** 子代理状态摘要(对外暴露) */
export interface SubAgentStatus {
  instanceId: string;
  agentId: string;
  agentName: string;
  prompt: string;
  startedAt: Date;
  status: "running" | "paused" | "completed" | "failed";
  messageCount: number;
}

/** 追踪器变更事件 */
export type TrackerChangeEvent =
  | { type: "registered"; instanceId: string; agentName: string }
  | { type: "unregistered"; instanceId: string; agentName: string }
  | { type: "message_injected"; instanceId: string; message: string }
  | { type: "inter_agent_message"; fromInstanceId: string; toInstanceId: string }
  | { type: "spawned_result"; instanceId: string; agentName: string }
  | { type: "aborted"; count: number };

/** 追踪器变更监听器 */
export type TrackerChangeListener = (event: TrackerChangeEvent) => void;

// ─── 全局追踪器 ──────────────────────────────────────────────

export class RunningSubAgentTracker {
  private agents = new Map<string, RunningSubAgent>();
  private _orphanedResults: SpawnedResult[] = [];
  private listeners = new Set<TrackerChangeListener>();

  /** 订阅追踪器变更 */
  subscribe(listener: TrackerChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 通知所有监听器 */
  private notify(event: TrackerChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        log.warn(`监听器执行错误: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** 注册子代理 */
  register(opts: {
    instanceId: string;
    agentId: string;
    agentName: string;
    prompt?: string;
    abortController?: AbortController;
  }): void {
    const { instanceId, agentId, agentName, prompt, abortController } = opts;
    this.agents.set(instanceId, {
      abortController,
      agentId,
      agentName,
      instanceId,
      interAgentMessageQueue: [],
      messageQueue: [],
      prompt: prompt ? (prompt.length > 200 ? `${prompt.substring(0, 200)}...` : prompt) : "",
      spawnedResults: [],
      startedAt: new Date(),
      status: "running",
    });
    log.debug(`子代理注册: ${agentName} (${instanceId})`);
    this.notify({ agentName, instanceId, type: "registered" });
  }

  /** 注销子代理 */
  unregister(instanceId: string): void {
    const agent = this.agents.get(instanceId);
    const agentName = agent?.agentName ?? instanceId;
    if (agent && agent.spawnedResults.length > 0) {
      this._orphanedResults.push(...agent.spawnedResults);
    }
    this.agents.delete(instanceId);
    log.debug(`子代理注销: ${instanceId}`);
    this.notify({ agentName, instanceId, type: "unregistered" });
  }

  // ─── 用户消息注入 ────────────────────────────────────────────

  /** 向子代理注入用户消息 */
  injectMessage(instanceId: string, message: string): boolean {
    const agent = this.agents.get(instanceId);
    if (!agent) {
      return false;
    }
    agent.messageQueue.push(message);
    log.debug(`消息注入到 ${agent.agentName}: ${message.substring(0, 50)}...`);
    this.notify({ instanceId, message, type: "message_injected" });
    return true;
  }

  /** 取出子代理的待处理用户消息 */
  dequeueMessages(instanceId: string): string[] {
    const agent = this.agents.get(instanceId);
    if (!agent) {
      return [];
    }
    const messages = [...agent.messageQueue];
    agent.messageQueue.length = 0;
    return messages;
  }

  // ─── Agent 间消息传递 ────────────────────────────────────────

  /** Agent 间消息传递 */
  sendInterAgentMessage(fromInstanceId: string, toInstanceId: string, message: string): boolean {
    const from = this.agents.get(fromInstanceId);
    const to = this.agents.get(toInstanceId);
    if (!from || !to) {
      return false;
    }
    to.interAgentMessageQueue.push({
      content: message,
      fromAgentId: from.agentId,
      fromAgentName: from.agentName,
      fromInstanceId: from.instanceId,
    });
    log.debug(`Agent 间消息: ${from.agentName} → ${to.agentName}`);
    return true;
  }

  /** 取出 Agent 间消息 */
  dequeueInterAgentMessages(instanceId: string): InterAgentMessage[] {
    const agent = this.agents.get(instanceId);
    if (!agent) {
      return [];
    }
    const messages = [...agent.interAgentMessageQueue];
    agent.interAgentMessageQueue.length = 0;
    return messages;
  }

  // ─── Spawn 结果 ──────────────────────────────────────────────

  /** 存储 spawn 结果 */
  storeSpawnedResult(result: SpawnedResult): void {
    // 找到 spawner(由 spawned agent 的 instanceId 的父级持有)
    // 直接存储到全局结果池
    const agent = this.agents.get(result.instanceId);
    if (agent) {
      agent.spawnedResults.push(result);
    } else {
      // 如果实例已注销，存到全局备用池
      this._orphanedResults.push(result);
    }
    log.debug(`Spawn 结果已存储: ${result.agentName} (success=${result.success})`);
  }

  /** 取出 spawn 结果(指定实例) */
  drainSpawnedResults(instanceId: string): SpawnedResult[] {
    const agent = this.agents.get(instanceId);
    if (!agent) {
      return [];
    }
    const results = [...agent.spawnedResults];
    agent.spawnedResults.length = 0;
    return results;
  }

  /** 检查是否有 spawn 结果可用(全局) */
  hasSpawnedResults(): boolean {
    if (this._orphanedResults.length > 0) {
      return true;
    }
    for (const agent of this.agents.values()) {
      if (agent.spawnedResults.length > 0) {
        return true;
      }
    }
    return false;
  }

  /** 取出所有孤立的 spawn 结果 */
  drainOrphanedResults(): SpawnedResult[] {
    const results = [...this._orphanedResults];
    this._orphanedResults.length = 0;
    return results;
  }

  // ─── 查询 ────────────────────────────────────────────────────

  /** 获取所有运行中子代理的状态 */
  listRunning(): SubAgentStatus[] {
    return [...this.agents.values()].map((a) => ({
      agentId: a.agentId,
      agentName: a.agentName,
      instanceId: a.instanceId,
      messageCount: a.messageQueue.length + a.interAgentMessageQueue.length,
      prompt: a.prompt,
      startedAt: a.startedAt,
      status: a.status,
    }));
  }

  /** 获取所有运行中子代理的状态(别名) */
  listAll(): SubAgentStatus[] {
    return this.listRunning();
  }

  /** 按 instanceId 查找子代理 */
  findByInstanceId(instanceId: string): SubAgentStatus | undefined {
    const agent = this.agents.get(instanceId);
    if (!agent) {
      return undefined;
    }
    return {
      agentId: agent.agentId,
      agentName: agent.agentName,
      instanceId: agent.instanceId,
      messageCount: agent.messageQueue.length + agent.interAgentMessageQueue.length,
      prompt: agent.prompt,
      startedAt: agent.startedAt,
      status: agent.status,
    };
  }

  /** 按 agentId 查找实例(返回第一个匹配的) */
  findInstanceByAgentId(agentId: string): SubAgentStatus | undefined {
    for (const agent of this.agents.values()) {
      if (agent.agentId === agentId) {
        return {
          agentId: agent.agentId,
          agentName: agent.agentName,
          instanceId: agent.instanceId,
          messageCount: agent.messageQueue.length + agent.interAgentMessageQueue.length,
          prompt: agent.prompt,
          startedAt: agent.startedAt,
          status: agent.status,
        };
      }
    }
    return undefined;
  }

  /** 按 agentId 查找实例(别名) */
  findByAgentId(agentId: string): SubAgentStatus | undefined {
    return this.findInstanceByAgentId(agentId);
  }

  /** 检查子代理是否正在运行 */
  isRunning(instanceId: string): boolean {
    return this.agents.has(instanceId);
  }

  /** 获取运行中的子代理数量 */
  get size(): number {
    return this.agents.size;
  }

  /** 统一的运行态快照，降低外部对内部 Map/队列细节的耦合 */
  getRuntimeState(): {
    runningAgents: SubAgentStatus[];
    orphanedResultCount: number;
    hasSpawnedResults: boolean;
    totalQueuedMessages: number;
  } {
    const runningAgents = this.listRunning();
    const totalQueuedMessages = [...this.agents.values()].reduce(
      (sum, agent) => sum + agent.messageQueue.length + agent.interAgentMessageQueue.length,
      0,
    );

    return {
      hasSpawnedResults: this.hasSpawnedResults(),
      orphanedResultCount: this._orphanedResults.length,
      runningAgents,
      totalQueuedMessages,
    };
  }

  // ─── 异步等待 ────────────────────────────────────────────────

  /**
   * 等待指定的 spawned agents 完成。
   *
   * @param timeoutMs - 最大等待时间(毫秒)
   * @param abortSignal - 外部中止信号
   */
  async waitForSpawnedAgents(
    instanceIds: string[],
    timeoutMs: number = 300_000,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (instanceIds.length === 0) {
      return;
    }

    const targetSet = new Set(instanceIds);

    const checkDone = () => {
      for (const id of targetSet) {
        if (this.isRunning(id)) {
          return false;
        }
      }
      return true;
    };

    if (checkDone()) {
      return;
    }
    if (abortSignal?.aborted) {
      return;
    }

    return new Promise<void>((resolve) => {
      const done = () => {
        unsubscribe();
        clearTimeout(timeoutId);
        abortSignal?.removeEventListener("abort", onAbort);
        resolve();
      };

      const unsubscribe = this.subscribe((event) => {
        if (event.type === "unregistered" && targetSet.has(event.instanceId)) {
          if (checkDone()) {
            done();
          }
        }
      });

      const timeoutId = setTimeout(() => {
        log.warn(`等待 spawned agents 超时 (${timeoutMs}ms)`);
        done();
      }, timeoutMs);

      const onAbort = () => done();
      abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  // ─── 中止与清理 ──────────────────────────────────────────────

  /** 中止所有运行中的子代理 */
  abortAll(): void {
    const count = this.agents.size;
    for (const agent of this.agents.values()) {
      agent.abortController?.abort();
    }
    log.info(`已中止所有子代理 (${count} 个)`);
    this.notify({ count, type: "aborted" });
  }

  /** 清空所有追踪 */
  clear(): void {
    this.agents.clear();
    this._orphanedResults.length = 0;
  }
}

/** 全局追踪器实例 */
export const subAgentTracker = new RunningSubAgentTracker();

// ═══════════════════════════════════════════════════════════
// 工具函数(从 spawnedResults.ts 合并)
// ═══════════════════════════════════════════════════════════

/**
 * 构建 SpawnedResult 对象
 */
export function buildSpawnedToolResult(input: {
  instanceId: string;
  agentId: string;
  agentName: string;
  prompt: string;
  success: boolean;
  result: string;
  error?: string;
}): SpawnedResult {
  return {
    agentId: input.agentId,
    agentName: input.agentName,
    completedAt: new Date(),
    error: input.error,
    instanceId: input.instanceId,
    prompt: input.prompt.length > 200 ? `${input.prompt.substring(0, 200)}...` : input.prompt,
    result: input.result,
    success: input.success,
  };
}

/**
 * 提取子代理结果并聚合
 *
 * @deprecated 直接从 "./trackerDrain" 导入以避免 session ↔ tracker 反向耦合
 * @param childIds - 子代理实例 ID 列表
 * @param drainer - 结果提取器(通常是 RunningSubAgentTracker 实例)
 */
export { drainSpawnedChildResults, buildSpawnedChildrenContinuationPrompt } from "./trackerDrain";

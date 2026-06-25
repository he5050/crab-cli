/**
 * 子代理流处理器
 *
 * 职责:
 *   - 处理子代理的流式响应
 *   - 合并多个子代理的输出
 *   - 处理流式数据分块
 *   - 管理流处理状态
 *   - 支持多种合并策略
 *
 * 模块功能:
 *   - SubAgentStreamProcessor: 子代理流处理器类
 *   - StreamChunk: 流数据块接口
 *   - StreamState: 流处理状态接口
 *   - StreamProcessorConfig: 流处理器配置接口
 *   - MergeStrategy: 合并策略类型
 *   - createStreamProcessor: 创建流处理器实例
 *
 * 使用场景:
 *   - 子代理流式输出
 *   - 并行子代理结果合并
 *   - 流式数据聚合
 *   - 多子代理协作结果整合
 *
 * 边界:
 *   1. 仅处理流数据块的接收和合并，不执行实际的子代理
 *   2. 支持四种合并策略:concat、interleave、priority、custom
 *   3. 默认最大等待时间为 30 秒
 *   4. 支持有序处理(按序列号)，但默认无序
 *
 * 流程:
 *   1. 创建 SubAgentStreamProcessor 实例并配置合并策略
 *   2. 通过 receiveChunk() 接收子代理的流数据块
 *   3. 内部维护每个子代理的 StreamState
 *   4. 检测 isLast 标记判断流是否完成
 *   5. 所有流完成后触发 onAllComplete 回调
 *   6. 通过 getMergedResults() 获取合并后的结果
 *   7. 支持 waitForCompletion() 等待所有流完成(带超时)
 */

import { createLogger } from "@/core/logging/logger";

const log = createLogger("agent:sub-agent-stream-processor");

/** 流数据块 */
export interface StreamChunk {
  /** 子代理实例 ID */
  instanceId: string;
  /** 代理类型 */
  agentType: string;
  /** 数据内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
  /** 是否是最后一块 */
  isLast: boolean;
  /** 序列号 */
  sequence: number;
}

/** 流处理状态 */
export interface StreamState {
  /** 子代理实例 ID */
  instanceId: string;
  /** 代理类型 */
  agentType: string;
  /** 接收到的数据块 */
  chunks: StreamChunk[];
  /** 是否完成 */
  completed: boolean;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime?: number;
  /** 内容片段缓冲(避免字符串重复拼接) */
  contentParts: string[];
  /** 错误信息 */
  error?: string;
}

/** 合并策略 */
export type MergeStrategy =
  | "concat" // 简单拼接
  | "interleave" // 交错合并
  | "priority" // 按优先级
  | "custom"; // 自定义

/** 子代理优先级 */
export interface AgentPriority {
  agentType: string;
  priority: number;
}

/** 流处理器配置 */
export interface StreamProcessorConfig {
  /** 合并策略，默认 "concat" */
  mergeStrategy: MergeStrategy;
  /** 代理优先级列表 */
  agentPriorities: AgentPriority[];
  /** 最大等待时间(毫秒)，默认 30000 */
  maxWaitTime: number;
  /** 是否按顺序处理，默认 false */
  ordered: boolean;
  /** 自定义合并函数 */
  customMerge?: (streams: Map<string, StreamState>) => string;
}

/** 默认配置 */
const DEFAULT_CONFIG: StreamProcessorConfig = {
  agentPriorities: [
    { agentType: "general", priority: 1 },
    { agentType: "plan", priority: 2 },
    { agentType: "review", priority: 3 },
    { agentType: "explore", priority: 4 },
    { agentType: "qa", priority: 5 },
    { agentType: "debug", priority: 6 },
    { agentType: "security", priority: 7 },
    { agentType: "docs", priority: 8 },
  ],
  maxWaitTime: 30_000,
  mergeStrategy: "concat",
  ordered: false,
};

/**
 * 子代理流处理器类
 */
export class SubAgentStreamProcessor {
  private config: StreamProcessorConfig;
  private streams = new Map<string, StreamState>();
  private callbacks: {
    onChunk?: (chunk: StreamChunk, state: StreamState) => void;
    onComplete?: (instanceId: string, result: string) => void;
    onError?: (instanceId: string, error: string) => void;
    onAllComplete?: (results: Map<string, string>) => void;
  } = {};
  private startTime: number = Date.now();

  constructor(config?: Partial<StreamProcessorConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * 注册流回调
   */
  on(event: "chunk", callback: (chunk: StreamChunk, state: StreamState) => void): void;
  on(event: "complete", callback: (instanceId: string, result: string) => void): void;
  on(event: "error", callback: (instanceId: string, error: string) => void): void;
  on(event: "allComplete", callback: (results: Map<string, string>) => void): void;
  on(event: string, callback: unknown): void {
    switch (event) {
      case "chunk": {
        this.callbacks.onChunk = callback as (chunk: StreamChunk, state: StreamState) => void;
        break;
      }
      case "complete": {
        this.callbacks.onComplete = callback as (instanceId: string, result: string) => void;
        break;
      }
      case "error": {
        this.callbacks.onError = callback as (instanceId: string, error: string) => void;
        break;
      }
      case "allComplete": {
        this.callbacks.onAllComplete = callback as (results: Map<string, string>) => void;
        break;
      }
    }
  }

  /**
   * 接收流数据块
   */
  async receiveChunk(chunk: StreamChunk): Promise<void> {
    let state = this.streams.get(chunk.instanceId);

    if (!state) {
      state = {
        agentType: chunk.agentType,
        chunks: [],
        completed: false,
        contentParts: [],
        instanceId: chunk.instanceId,
        startTime: chunk.timestamp,
      };
      this.streams.set(chunk.instanceId, state);
      log.info(`开始处理子代理流: ${chunk.instanceId} (${chunk.agentType})`);
    }

    // 检查序列号(如果有序处理)
    if (this.config.ordered && state.chunks.length > 0) {
      const lastChunk = state.chunks[state.chunks.length - 1];
      if (chunk.sequence !== (lastChunk?.sequence ?? 0) + 1) {
        log.warn(`序列号不连续: 期望 ${(lastChunk?.sequence ?? 0) + 1}, 收到 ${chunk.sequence}`);
      }
    }

    // 添加数据块
    state.chunks.push(chunk);

    // 缓冲内容片段(避免字符串重复拼接)
    state.contentParts.push(chunk.content);

    // 检查是否是最后一块
    if (chunk.isLast) {
      state.completed = true;
      state.endTime = chunk.timestamp;
      const content = this.getStreamContent(state);
      log.info(`子代理流完成: ${chunk.instanceId}, 总大小: ${content.length} 字符`);

      // 触发完成回调
      if (this.callbacks.onComplete) {
        this.callbacks.onComplete(chunk.instanceId, content);
      }

      // 检查是否所有流都完成
      this.checkAllComplete();
    }

    // 触发数据块回调
    if (this.callbacks.onChunk) {
      this.callbacks.onChunk(chunk, state);
    }
  }

  /**
   * 标记流错误
   */
  markError(instanceId: string, error: string): void {
    const state = this.streams.get(instanceId);
    if (state) {
      state.completed = true;
      state.error = error;
      state.endTime = Date.now();
      log.error(`子代理流错误: ${instanceId}`, { error });

      if (this.callbacks.onError) {
        this.callbacks.onError(instanceId, error);
      }

      this.checkAllComplete();
    }
  }

  /**
   * 检查是否所有流都完成
   */
  private checkAllComplete(): void {
    const allComplete = [...this.streams.values()].every((s) => s.completed);

    if (allComplete && this.streams.size > 0) {
      log.info(`所有子代理流完成, 共 ${this.streams.size} 个流`);

      if (this.callbacks.onAllComplete) {
        const results = this.getMergedResults();
        this.callbacks.onAllComplete(results);
      }
    }
  }

  /**
   * 获取合并后的结果
   */
  getMergedResults(): Map<string, string> {
    const results = new Map<string, string>();

    switch (this.config.mergeStrategy) {
      case "concat": {
        results.set("merged", this.mergeConcat());
        break;
      }
      case "interleave": {
        results.set("merged", this.mergeInterleave());
        break;
      }
      case "priority": {
        results.set("merged", this.mergeByPriority());
        break;
      }
      case "custom": {
        if (this.config.customMerge) {
          results.set("merged", this.config.customMerge(this.streams));
        } else {
          results.set("merged", this.mergeConcat());
        }
        break;
      }
    }

    // 同时保留每个流的独立结果
    for (const [instanceId, state] of this.streams) {
      results.set(instanceId, this.getStreamContent(state));
    }

    return results;
  }

  /**
   * 简单拼接合并
   */
  private mergeConcat(): string {
    const parts: string[] = [];

    for (const state of this.streams.values()) {
      const content = this.getStreamContent(state);
      if (content) {
        parts.push(`## ${state.agentType} (${state.instanceId})\n${content}`);
      }
    }

    return parts.join("\n\n---\n\n");
  }

  /**
   * 交错合并
   */
  private mergeInterleave(): string {
    // 按时间戳交错合并所有数据块
    const allChunks = [...this.streams.values()].flatMap((s) => s.chunks).toSorted((a, b) => a.timestamp - b.timestamp);

    return allChunks.map((c) => c.content).join("");
  }

  /**
   * 按优先级合并
   */
  private mergeByPriority(): string {
    const sortedStates = [...this.streams.values()].toSorted((a, b) => {
      const priorityA = this.getAgentPriority(a.agentType);
      const priorityB = this.getAgentPriority(b.agentType);
      return priorityA - priorityB;
    });

    const parts: string[] = [];
    for (const state of sortedStates) {
      const content = this.getStreamContent(state);
      if (content) {
        parts.push(`## ${state.agentType}\n${content}`);
      }
    }

    return parts.join("\n\n---\n\n");
  }

  /**
   * 获取代理优先级
   */
  private getAgentPriority(agentType: string): number {
    const found = this.config.agentPriorities.find((p) => p.agentType === agentType);
    return found?.priority ?? 100;
  }

  /**
   * 获取流的聚合内容(惰性拼接)
   */
  private getStreamContent(state: StreamState): string {
    return state.contentParts.join("");
  }

  /**
   * 获取流状态
   */
  getStreamState(instanceId: string): StreamState | undefined {
    return this.streams.get(instanceId);
  }

  /**
   * 获取所有流状态
   */
  getAllStreamStates(): Map<string, StreamState> {
    return new Map(this.streams);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalStreams: number;
    completedStreams: number;
    failedStreams: number;
    totalChunks: number;
    totalSize: number;
    averageDuration: number;
  } {
    const completedStreams = [...this.streams.values()].filter((s) => s.completed && !s.error);
    const failedStreams = [...this.streams.values()].filter((s) => s.error);
    const totalChunks = [...this.streams.values()].reduce((sum, s) => sum + s.chunks.length, 0);
    const totalSize = [...this.streams.values()].reduce((sum, s) => sum + this.getStreamContent(s).length, 0);

    const durations = [...this.streams.values()].filter((s) => s.endTime).map((s) => s.endTime! - s.startTime);
    const averageDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      averageDuration,
      completedStreams: completedStreams.length,
      failedStreams: failedStreams.length,
      totalChunks,
      totalSize,
      totalStreams: this.streams.size,
    };
  }

  /**
   * 重置处理器
   */
  reset(): void {
    this.streams.clear();
    this.startTime = Date.now();
  }

  /**
   * 等待所有流完成(带超时)
   */
  async waitForCompletion(timeout?: number): Promise<Map<string, string>> {
    const maxWait = timeout ?? this.config.maxWaitTime;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const allComplete = [...this.streams.values()].every((s) => s.completed);
      if (allComplete) {
        return this.getMergedResults();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 超时，标记未完成的流为错误并清理
    for (const [instanceId, state] of this.streams) {
      if (!state.completed) {
        this.markError(instanceId, "Stream processing timeout");
      }
    }
    const results = this.getMergedResults();
    this.clearCompleted();

    return results;
  }

  /**
   * 清理已完成的流，释放内存
   */
  clearCompleted(): void {
    for (const [instanceId, state] of this.streams) {
      if (state.completed || state.error) {
        this.streams.delete(instanceId);
      }
    }
    if (this.streams.size > 0) {
      log.debug(`清理已完成流: 剩余 ${this.streams.size} 个活跃流`);
    }
  }
}

/**
 * 创建流处理器实例
 */
export function createStreamProcessor(config?: Partial<StreamProcessorConfig>): SubAgentStreamProcessor {
  return new SubAgentStreamProcessor(config);
}

/**
 * 子代理执行器 — 协调器.
 *
 * 职责:
 *   - 维护任务注册表 + 状态机
 *   - 调度: 启动 Watchdog → 调度 runTasks → 收集结果
 *   - 提供公开 API(setTaskExecutor / addTask / execute / cancel / reset)
 *
 * 内部职责按"单一职责"拆分至:
 *   - executorConcurrency.ts  动态并发数计算
 *   - executorDependency.ts   循环依赖检测 + 依赖等待
 *   - executorLifecycle.ts    Watchdog 集成 + 强制终止事件
 *   - executorTaskRunner.ts   runTasks 多任务调度 + executeTask 单任务执行
 *   - executorResult.ts       成功/失败结果构造 + 状态概览
 *
 * 公开 API 完全向后兼容:
 *   - SubAgentExecutor 类
 *   - calculateDynamicConcurrency 独立函数
 *   - 类型导出: ExecutionResult / ExecutionStats / ExecutionStatus / ExecutorConfig / SubAgentTask / TaskCallbacks
 *   - createSubAgentExecutor 工厂
 */
import { createLogger } from "@/core/logging/logger";
import { taskId } from "@/core/id";
import { createStreamProcessor } from "./streamProcessor";
import type { SubAgentStreamProcessor } from "./streamProcessor";
import type { ResolveResult } from "./resolver";
import { detectCycle } from "./executorDependency";
import {
  publishWatchdogTimeoutEvent,
  sendForcedTerminateEvent,
  startTotalTimeoutWatchdog,
  stopWatchdog,
  type TerminationState,
} from "./executorLifecycle";
import { runTasks } from "./executorTaskRunner";
import { createFailedResult, createSuccessResult, getExecutorStatus } from "./executorResult";
import { calculateDynamicConcurrency } from "./executorConcurrency";
import {
  DEFAULT_EXECUTOR_CONFIG,
  type ExecutionResult,
  type ExecutorConfig,
  type SubAgentTask,
  type TaskCallbacks,
} from "./types";

export type {
  ExecutionResult,
  ExecutionStats,
  ExecutionStatus,
  ExecutorConfig,
  SubAgentTask,
  TaskCallbacks,
} from "./types";

const log = createLogger("agent:sub-agent-executor");

/**
 * 子代理执行器类 — 协调器.
 */
export class SubAgentExecutor {
  private config: ExecutorConfig;
  private tasks = new Map<string, SubAgentTask>();
  private streamProcessor: SubAgentStreamProcessor;
  private abortController: AbortController;
  private startTime: number = 0;
  private callbacks: TaskCallbacks = {};
  private taskExecutor?: (task: SubAgentTask, signal: AbortSignal) => Promise<string>;
  private watchdog: ReturnType<typeof startTotalTimeoutWatchdog> | null = null;
  private termination: TerminationState = { isForced: false, reason: "" };
  private isExecuting = false;

  constructor(config?: Partial<ExecutorConfig>) {
    this.config = {
      ...DEFAULT_EXECUTOR_CONFIG,
      ...config,
    };
    this.streamProcessor = createStreamProcessor(this.config.streamProcessorConfig);
    this.abortController = new AbortController();
  }

  isTerminated(): boolean {
    return this.termination.isForced;
  }

  getTerminateReason(): string {
    return this.termination.reason;
  }

  setTaskExecutor(executor: (task: SubAgentTask, signal: AbortSignal) => Promise<string>): void {
    this.taskExecutor = executor;
  }

  on(event: "taskStart", callback: (task: SubAgentTask) => void): void;
  on(event: "taskComplete", callback: (task: SubAgentTask, result: string) => void): void;
  on(event: "taskFailed", callback: (task: SubAgentTask, error: string) => void): void;
  on(
    event: "streamChunk",
    callback: (chunk: import("./streamProcessor").StreamChunk, state: import("./streamProcessor").StreamState) => void,
  ): void;
  on(event: "allComplete", callback: (result: ExecutionResult) => void): void;
  on(event: string, callback: unknown): void {
    switch (event) {
      case "taskStart":
        this.callbacks.onTaskStart = callback as (task: SubAgentTask) => void;
        break;
      case "taskComplete":
        this.callbacks.onTaskComplete = callback as (task: SubAgentTask, result: string) => void;
        break;
      case "taskFailed":
        this.callbacks.onTaskFailed = callback as (task: SubAgentTask, error: string) => void;
        break;
      case "streamChunk":
        this.callbacks.onStreamChunk = callback as never;
        break;
      case "allComplete":
        this.callbacks.onAllComplete = callback as (result: ExecutionResult) => void;
        break;
    }
  }

  addTask(task: Omit<SubAgentTask, "id" | "status" | "createdAt">): string {
    const id = task.instanceId || taskId();
    const fullTask: SubAgentTask = {
      ...task,
      createdAt: Date.now(),
      id,
      instanceId: id,
      status: "pending",
    };
    this.tasks.set(id, fullTask);

    if (task.dependencies && task.dependencies.length > 0 && detectCycle(this.tasks, id)) {
      this.tasks.delete(id);
      log.error(`任务 ${id} 存在循环依赖, 已拒绝添加. 依赖链: [${task.dependencies.join(", ")}]`);
      throw new Error(`任务 ${id} 存在循环依赖, 无法添加`);
    }

    log.info(`添加任务: ${id} (${task.agentType})`);
    return id;
  }

  addTasksFromResolve(results: ResolveResult[]): string[] {
    const ids: string[] = [];
    for (const result of results) {
      if (result.needsSubAgent && result.agentType !== "none") {
        const id = this.addTask({
          agentType: result.agentType,
          dependencies: [],
          instanceId: `task-${result.agentType}-${Date.now()}`,
          priority:
            result.priority === "critical" ? 0 : result.priority === "high" ? 1 : result.priority === "medium" ? 2 : 3,
          prompt: result.taskDescription,
        });
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * 执行所有任务: 启动 Watchdog → 调度 runTasks → 收集结果.
   */
  async execute(): Promise<ExecutionResult> {
    if (this.isExecuting) {
      return createFailedResult(this.tasks, Date.now(), "Executor is already running");
    }
    if (!this.taskExecutor) {
      return createFailedResult(this.tasks, Date.now(), "Task executor not set");
    }

    this.isExecuting = true;
    this.startTime = Date.now();
    this.termination = { isForced: false, reason: "" };
    log.info(`开始执行 ${this.tasks.size} 个任务`);

    const handleForcedTerminate = (reason: string): void => {
      this.termination = sendForcedTerminateEvent(this.tasks, reason);
      this.abortController.abort();
    };

    this.watchdog = startTotalTimeoutWatchdog(this.config.totalTimeout, handleForcedTerminate);

    try {
      this.watchdog.start();

      await runTasks({
        abortSignal: this.abortController.signal,
        callbacks: this.callbacks,
        maxConcurrency: this.config.maxConcurrency,
        onForcedTerminate: handleForcedTerminate,
        retryCount: this.config.retryCount,
        retryDelayMs: this.config.retryDelay,
        streamProcessor: this.streamProcessor,
        taskExecutor: this.taskExecutor,
        taskTimeoutMs: this.config.taskTimeout,
        tasks: this.tasks,
        waitForDependencies: this.config.waitForDependencies,
      });

      const mergedResults = await this.streamProcessor.waitForCompletion();

      const result = createSuccessResult(this.tasks, this.startTime, mergedResults);

      if (this.callbacks.onAllComplete) {
        this.callbacks.onAllComplete(result);
      }

      return result;
    } catch (error) {
      if (this.termination.isForced) {
        log.error("执行被强制终止", { reason: this.termination.reason });
        return createFailedResult(this.tasks, this.startTime, this.termination.reason);
      }

      log.error("执行失败", { error: String(error) });
      return createFailedResult(this.tasks, this.startTime, String(error));
    } finally {
      this.isExecuting = false;
      this.watchdog = stopWatchdog(this.watchdog);

      if (this.termination.isForced) {
        publishWatchdogTimeoutEvent(Date.now() - this.startTime, this.termination.reason, this.startTime);
      }
    }
  }

  cancel(): void {
    log.info("取消所有任务");
    this.abortController.abort();

    for (const task of this.tasks.values()) {
      if (task.status === "pending" || task.status === "running") {
        task.status = "cancelled";
        task.completedAt = Date.now();
      }
    }

    this.watchdog = stopWatchdog(this.watchdog);
  }

  getTaskStatus(taskId: string): SubAgentTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTaskStatuses(): Map<string, SubAgentTask> {
    const result = new Map<string, SubAgentTask>();
    for (const [key, value] of this.tasks) {
      result.set(key, value);
    }
    return result;
  }

  reset(): void {
    this.tasks.clear();
    this.streamProcessor.reset();
    this.abortController = new AbortController();
    this.startTime = 0;
    this.termination = { isForced: false, reason: "" };
    this.watchdog = stopWatchdog(this.watchdog);
  }

  getStatus(): ReturnType<typeof getExecutorStatus> {
    return getExecutorStatus(this.tasks);
  }
}

/**
 * 重新导出 calculateDynamicConcurrency, 保持向后兼容.
 */
export { calculateDynamicConcurrency };

/**
 * 创建执行器实例.
 */
export function createSubAgentExecutor(config?: Partial<ExecutorConfig>): SubAgentExecutor {
  return new SubAgentExecutor(config);
}

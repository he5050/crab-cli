/**
 * 子代理执行器 - 单任务执行与并发调度.
 *
 * 职责:
 *   - executeTask: 单个任务执行 + 超时 + 重试 + 死循环检测 + 流式分块
 *   - runTasks: 多任务并发调度 + 依赖等待 + 事件驱动唤醒
 *
 * 边界:
 *   1. 不持有 SubAgentExecutor 状态, 通过参数注入
 *   2. 死循环检测委托给 circuitBreaker.createDeadLoopHandler
 *   3. 角色注入通过动态 import("roles/roleSubagent") 可选加载
 */
import { createLogger } from "@/core/logging/logger";
import { createDeadLoopHandler } from "@/agent/runtime/circuitBreaker";
import { type StreamChunk, createStreamProcessor } from "./streamProcessor";
import type { SubAgentStreamProcessor } from "./streamProcessor";
import { checkDependenciesCompleted, detectCycle } from "./executorDependency";
import { calculateDynamicConcurrency } from "./executorConcurrency";
import type { SubAgentTask, TaskCallbacks } from "./types";

const log = createLogger("agent:sub-agent-task-runner");

/**
 * 可选加载子代理角色注入.
 * 加载失败时静默跳过(模块可能不存在).
 */
async function maybeInjectSubAgentRole(task: SubAgentTask): Promise<void> {
  try {
    const { loadSubAgentCustomRole } = await import("@/agent/roles/roleSubagent");
    const customRole = loadSubAgentCustomRole(task.agentType, process.cwd());
    if (customRole) {
      task.prompt = `${task.prompt}\n\n${customRole}`;
    }
  } catch {
    // RoleSubagent 模块不可用, 跳过
  }
}

/**
 * 单任务执行参数.
 */
export interface ExecuteTaskDeps {
  task: SubAgentTask;
  taskExecutor: (task: SubAgentTask, signal: AbortSignal) => Promise<string>;
  streamProcessor: SubAgentStreamProcessor;
  abortSignal: AbortSignal;
  taskTimeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
  callbacks: TaskCallbacks;
  onForcedTerminate: (reason: string) => void;
}

/**
 * 执行单个任务: 含超时、重试、死循环检测、流式分块.
 */
export async function executeTask(deps: ExecuteTaskDeps): Promise<void> {
  const {
    task,
    taskExecutor,
    streamProcessor,
    abortSignal,
    taskTimeoutMs,
    retryCount,
    retryDelayMs,
    callbacks,
    onForcedTerminate,
  } = deps;

  if (abortSignal.aborted) {
    task.status = "cancelled";
    task.completedAt = Date.now();
    return;
  }

  task.status = "running";
  task.startedAt = Date.now();
  log.info(`开始执行任务: ${task.id} (${task.agentType})`);

  if (callbacks.onTaskStart) {
    callbacks.onTaskStart(task);
  }

  await maybeInjectSubAgentRole(task);

  const detectDeadLoop = createDeadLoopHandler(task.id, (taskId, message) => {
    log.error(`死循环检测触发 for task ${taskId}: ${message}`);
    onForcedTerminate(message);
  });

  let retries = retryCount;
  let lastError: string | undefined;

  while (true) {
    try {
      const taskAbortController = new AbortController();
      const timeoutId = setTimeout(() => {
        taskAbortController.abort();
      }, taskTimeoutMs);

      const onParentAbort = () => taskAbortController.abort();
      abortSignal.addEventListener("abort", onParentAbort);

      const result = await taskExecutor(task, taskAbortController.signal);
      clearTimeout(timeoutId);
      abortSignal.removeEventListener("abort", onParentAbort);

      if (result) {
        const chunk: StreamChunk = {
          agentType: task.agentType,
          content: result,
          instanceId: task.instanceId,
          isLast: true,
          sequence: 0,
          timestamp: Date.now(),
        };
        await streamProcessor.receiveChunk(chunk);
      }

      task.status = "completed";
      task.completedAt = Date.now();
      task.result = result;

      if (callbacks.onTaskComplete) {
        callbacks.onTaskComplete(task, result);
      }
      log.info(`任务完成: ${task.id}`);
      return;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorType = error instanceof Error ? error.name : "UnknownError";
      lastError = errorMsg;

      if (detectDeadLoop(errorType, errorMsg)) {
        log.error(`任务 ${task.id} 触发熔断, 死循环检测`, { error: errorMsg });
        task.status = "failed";
        task.completedAt = Date.now();
        task.error = `熔断触发:${errorMsg}`;

        if (callbacks.onTaskFailed) {
          callbacks.onTaskFailed(task, task.error);
        }
        return;
      }

      if (retries > 0) {
        log.warn(`任务 ${task.id} 失败, 重试中... (${retries} 次剩余)`, { error: errorMsg });
        retries--;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        break;
      }
    }
  }

  task.status = "failed";
  task.completedAt = Date.now();
  task.error = lastError;
  log.error(`任务失败: ${task.id}`, { error: lastError });

  if (callbacks.onTaskFailed) {
    callbacks.onTaskFailed(task, lastError!);
  }
}

/**
 * 多任务并发调度参数.
 */
export interface RunTasksDeps {
  tasks: Map<string, SubAgentTask>;
  waitForDependencies: boolean;
  maxConcurrency: number;
  taskExecutor: (task: SubAgentTask, signal: AbortSignal) => Promise<string>;
  abortSignal: AbortSignal;
  taskTimeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
  streamProcessor: SubAgentStreamProcessor;
  callbacks: TaskCallbacks;
  onForcedTerminate: (reason: string) => void;
}

/**
 * 多任务并发调度: 按优先级启动, 依赖未满足的任务挂起,
 * 任务完成时通过事件驱动唤醒(替代 100ms 轮询).
 */
export async function runTasks(deps: RunTasksDeps): Promise<void> {
  const sortedTasks = [...deps.tasks.values()].toSorted((a, b) => a.priority - b.priority);

  const hasDependencies = sortedTasks.some((t) => t.dependencies && t.dependencies.length > 0);
  const dynamicConcurrency = calculateDynamicConcurrency(sortedTasks.length, hasDependencies, deps.maxConcurrency);
  log.info(
    `动态并发数计算: 任务数=${sortedTasks.length}, 有依赖=${hasDependencies}, 并发数=${dynamicConcurrency} (maxConcurrency=${deps.maxConcurrency})`,
  );

  const pendingTasks: SubAgentTask[] = [];
  const runningTasks = new Set<string>();
  let taskIndex = 0;

  // 事件驱动等待机制: 任务完成时唤醒
  let wake: (() => void) | null = null;
  const waitForChange = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });

  const runNext = (): void => {
    while (taskIndex < sortedTasks.length && runningTasks.size < dynamicConcurrency) {
      const task = sortedTasks[taskIndex];
      if (!task) {
        taskIndex++;
        continue;
      }
      taskIndex++;

      if (deps.waitForDependencies && task.dependencies && task.dependencies.length > 0) {
        const missingDeps = task.dependencies.filter((depId) => !deps.tasks.has(depId));
        if (missingDeps.length > 0) {
          task.status = "failed";
          task.completedAt = Date.now();
          task.error = `缺失依赖: ${missingDeps.join(", ")}`;
          log.error(`任务 ${task.id} 缺失依赖，无法调度`, { missingDeps: missingDeps.join(", ") });
          if (deps.callbacks.onTaskFailed) {
            deps.callbacks.onTaskFailed(task, task.error);
          }
          continue;
        }
        if (!checkDependenciesCompleted(deps.tasks, task)) {
          pendingTasks.push(task);
          continue;
        }
      }

      runningTasks.add(task.id);
      executeTask({
        abortSignal: deps.abortSignal,
        callbacks: deps.callbacks,
        onForcedTerminate: deps.onForcedTerminate,
        retryCount: deps.retryCount,
        retryDelayMs: deps.retryDelayMs,
        streamProcessor: deps.streamProcessor,
        task,
        taskExecutor: deps.taskExecutor,
        taskTimeoutMs: deps.taskTimeoutMs,
      }).finally(() => {
        runningTasks.delete(task.id);
        wake?.();
      });
    }
  };

  runNext();

  while (runningTasks.size > 0 || pendingTasks.length > 0) {
    await waitForChange();

    const stillPending: SubAgentTask[] = [];
    for (const task of pendingTasks) {
      const taskDeps = task.dependencies ?? [];
      if (taskDeps.length === 0) {
        sortedTasks.push(task);
        continue;
      }

      const missingDeps = taskDeps.filter((depId) => !deps.tasks.has(depId));
      if (missingDeps.length > 0) {
        task.status = "failed";
        task.completedAt = Date.now();
        task.error = `缺失依赖: ${missingDeps.join(", ")}`;
        log.error(`任务 ${task.id} 缺失依赖，无法调度`, { missingDeps: missingDeps.join(", ") });
        if (deps.callbacks.onTaskFailed) {
          deps.callbacks.onTaskFailed(task, task.error);
        }
        continue;
      }

      if (checkDependenciesCompleted(deps.tasks, task)) {
        sortedTasks.push(task);
      } else {
        stillPending.push(task);
      }
    }
    pendingTasks.length = 0;
    pendingTasks.push(...stillPending);

    runNext();
  }
}

/**
 * 重新导出依赖检测, 供上层在 addTask 时直接复用.
 */
export { detectCycle };

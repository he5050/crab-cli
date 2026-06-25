/**
 * [Task 管理器]
 *
 * 职责:
 *   - 创建、查询、取消异步任务
 *   - 管理任务生命周期(pending → running → completed/failed/cancelled)
 *   - 异步执行任务(后台运行，不阻塞调用方)
 *   - 通过 EventBus 发布任务状态变更事件
 *   - 持久化任务状态到磁盘，支持重启后恢复
 *
 * 模块功能:
 *   - create: 创建新任务并开始异步执行
 *   - list: 列出所有任务
 *   - get: 获取单个任务详情
 *   - cancel: 取消运行中的任务
 *   - delete: 删除已完成的任务
 *   - listByStatus: 按状态过滤任务
 *   - runningCount: 获取运行中任务数量
 *   - loadFromDisk: 从磁盘加载任务(启动时调用)
 *   - setProjectDir: 设置项目目录
 *
 * 使用场景:
 *   - 需要异步执行长时间运行的 AI 任务
 *   - Loop 管理器定时触发任务执行
 *   - 用户手动创建后台任务
 *   - 系统重启后恢复未完成任务
 *
 * 边界:
 *   1. 任务在内存 Map 中维护，同时持久化到磁盘
 *   2. 重启后将 running 状态任务标记为 failed
 *   3. 仅支持取消 pending 和 running 状态的任务
 *   4. 仅支持删除非运行中的任务
 *   5. 持久化路径为 .crab/tasks/<taskId>.json
 *
 * 流程:
 *   1. 创建任务: create → 生成 ID → 持久化 → 异步执行
 *   2. 状态变更: executeAsync → 更新状态 → 持久化 → 发布事件
 *   3. 取消任务: cancel → 触发 abort → 更新状态 → 持久化
 *   4. 重启恢复: loadFromDisk → 标记中断任务 → 加载到内存
 */

import fs from "node:fs";
import path from "node:path";
import type { AppConfigSchema } from "@/schema/config";
import { globalBus, type EventBus } from "@/bus/core/eventBus";
import { TaskEvents } from "@/bus/events/taskEvents";
import { createLogger } from "@/core/logging/logger";
import { createId } from "@/core/identity";
import { isProcessAlive, safeUnlinkSync } from "@/core/utilities";
import type { AsyncTask, TaskStatus } from "../types";
import { executeTask } from "./executor";

const log = createLogger("task:manager");

/** 任务持久化目录名 */
const TASKS_DIR_NAME = "tasks";

/** 运行时校验 JSON 解析结果是否符合 AsyncTask 基本结构 */
function isValidAsyncTask(obj: unknown): obj is AsyncTask {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.prompt === "string" &&
    typeof r.status === "string" &&
    typeof r.createdAt === "number"
  );
}

/**
 * 任务管理器(单例模式)。
 *
 * 任务维护在内存 Map 中，同时持久化到 .crab/tasks/ 目录。
 * 任务状态通过 EventBus 广播。
 */
export class TaskManager {
  private tasks = new Map<string, AsyncTask>();
  private abortControllers = new Map<string, AbortController>();
  private projectDir: string | null = null;
  private readonly eventBus?: EventBus;
  /** 测试注入: 自定义 HandlerClass，生产环境使用 ConversationHandler */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _handlerClass?: new (...args: any[]) => any;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  private getEventBus(): EventBus {
    return this.eventBus ?? globalBus;
  }

  /** 设置项目目录(用于持久化) */
  setProjectDir(dir: string): void {
    this.projectDir = dir;
  }

  // ─── 目录与路径 ────────────────────────────────────────────

  private getTaskDir(): string {
    return path.join(this.projectDir ?? process.cwd(), ".crab", TASKS_DIR_NAME);
  }

  private getTaskPath(taskId: string): string {
    return path.join(this.getTaskDir(), `${taskId}.json`);
  }

  private ensureDir(): void {
    const dir = this.getTaskDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ─── 持久化 ────────────────────────────────────────────────

  private persist(task: AsyncTask): void {
    try {
      this.ensureDir();
      const taskPath = this.getTaskPath(task.id);
      fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), "utf8");
    } catch (error) {
      log.error(`任务持久化失败 ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private unpersist(taskId: string): void {
    const taskPath = this.getTaskPath(taskId);
    safeUnlinkSync(taskPath);
  }

  /**
   * 从磁盘加载所有任务(启动时调用)。
   */
  loadFromDisk(): void {
    const dir = this.getTaskDir();
    try {
      if (!fs.existsSync(dir)) {
        return;
      }
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), "utf8");
          const parsed = JSON.parse(content);
          if (isValidAsyncTask(parsed)) {
            this.tasks.set(parsed.id, parsed);
          }
        } catch {
          /* 跳过损坏文件 */
        }
      }
      // 仅在进程确实不存在时，才把 running 状态任务标记为 failed。
      // 这样后台 task 子进程在启动时读取共享任务目录时，不会把父进程刚登记的
      // 运行中任务误判为“进程重启，任务中断”。
      for (const [, task] of this.tasks) {
        if (task.status === "running") {
          if (task.pid && isProcessAlive(task.pid)) {
            continue;
          }
          task.status = "failed";
          task.error = "进程重启，任务中断";
          task.completedAt = Date.now();
          task.updatedAt = task.completedAt;
          this.persist(task);
        }
      }
      log.info(`从磁盘加载 ${this.tasks.size} 个任务`);
    } catch {
      /* 目录不存在 */
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────

  /**
   * 创建新任务并开始异步执行。
   *
   * @returns 任务 ID
   */
  async create(
    prompt: string,
    config: AppConfigSchema,
    options?: {
      description?: string;
      model?: string;
      systemPrompt?: string;
    },
  ): Promise<string> {
    const id = createId("task");
    const task: AsyncTask = {
      createdAt: Date.now(),
      description: options?.description,
      id,
      model: options?.model,
      prompt,
      status: "pending",
    };
    this.tasks.set(id, task);
    this.persist(task);

    log.info(`任务已创建: ${id}`);

    this.getEventBus().publish(TaskEvents.TaskCreated, {
      id,
      prompt,
      status: "pending",
    });

    // 异步执行(不 await)
    this.executeAsync(task, config, options);

    return id;
  }

  /**
   * 异步执行任务。
   */
  private async executeAsync(
    task: AsyncTask,
    config: AppConfigSchema,
    options?: {
      model?: string;
      systemPrompt?: string;
    },
  ): Promise<void> {
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    task.status = "running";
    task.startedAt = Date.now();
    this.persist(task);

    this.getEventBus().publish(TaskEvents.TaskStatusChanged, {
      id: task.id,
      status: "running",
    });

    try {
      const result = await executeTask(task, {
        HandlerClass: this._handlerClass,
        abortSignal: abortController.signal,
        config,
        model: options?.model,
        prompt: task.prompt,
        systemPrompt: options?.systemPrompt,
      });

      const currentTask = this.tasks.get(task.id);
      if (currentTask?.status === "cancelled") {
        log.info(`任务已取消，忽略后台完成结果: ${task.id}`);
        this.abortControllers.delete(task.id);
        this.persist(currentTask);
        return;
      }

      task.status = result.result.ok ? "completed" : "failed";
      task.completedAt = Date.now();
      task.result = result.result.text;
      task.error = result.result.error;
      task.tokenUsage = result.result.usage
        ? { input: result.result.usage.inputTokens, output: result.result.usage.outputTokens }
        : undefined;

      log.info(`任务完成: ${task.id}, status=${task.status}`);
    } catch (error) {
      const currentTask = this.tasks.get(task.id);
      if (currentTask?.status === "cancelled") {
        log.info(`任务已取消，忽略后台错误结果: ${task.id}`);
        this.abortControllers.delete(task.id);
        this.persist(currentTask);
        return;
      }

      task.status = "failed";
      task.completedAt = Date.now();
      task.error = error instanceof Error ? error.message : String(error);

      log.error(`任务失败: ${task.id}: ${task.error}`);
    }

    this.abortControllers.delete(task.id);
    this.persist(task);

    this.getEventBus().publish(TaskEvents.TaskStatusChanged, {
      error: task.error,
      id: task.id,
      status: task.status,
    });
  }

  /** 列出所有任务 */
  list(): AsyncTask[] {
    return [...this.tasks.values()].toSorted((a, b) => b.createdAt - a.createdAt);
  }

  /** 获取单个任务 */
  get(id: string): AsyncTask | undefined {
    return this.tasks.get(id);
  }

  /** 取消运行中的任务 */
  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }
    if (task.status !== "running" && task.status !== "pending") {
      return false;
    }

    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
    }

    task.status = "cancelled";
    task.completedAt = Date.now();
    this.persist(task);

    this.getEventBus().publish(TaskEvents.TaskStatusChanged, {
      id: task.id,
      status: "cancelled",
    });

    log.info(`任务已取消: ${id}`);
    return true;
  }

  /** 删除任务(仅非运行中) */
  delete(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }
    if (task.status === "running") {
      return false;
    }

    this.tasks.delete(id);
    this.unpersist(id);
    log.info(`任务已删除: ${id}`);
    return true;
  }

  /** 按状态过滤 */
  listByStatus(status: TaskStatus): AsyncTask[] {
    return this.list().filter((t) => t.status === status);
  }

  /** 运行中的任务数量 */
  runningCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        count++;
      }
    }
    return count;
  }
}

/** 全局任务管理器实例 */
export const taskManager = new TaskManager();

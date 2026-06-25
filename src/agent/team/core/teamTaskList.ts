/**
 * [Team 共享任务列表]
 *
 * 职责:
 *   - 管理队友间的共享任务
 *   - 支持任务依赖关系
 *   - 持久化任务数据到文件系统
 *   - 任务认领和完成跟踪
 *
 * 模块功能:
 *   - create:创建新任务
 *   - claim:认领任务(带依赖检查)
 *   - complete:标记任务完成
 *   - assign:分配任务给队友
 *   - updateStatus:更新任务状态
 *   - get:获取任务详情
 *   - list:列出所有任务
 *   - listClaimable:列出可认领任务
 *   - listByStatus:按状态过滤任务
 *   - listByAssignee:按队友过滤任务
 *   - clear:清空所有任务
 *
 * 使用场景:
 *   - 团队任务分配
 *   - 任务依赖管理
 *   - 任务进度跟踪
 *   - 队友工作协调
 *
 * 边界:
 *   1. 任务数据存储在 .crab/teams/{teamName}/tasks.json
 *   2. 使用原子写入(tmp+rename)保证数据完整性
 *   3. 认领任务时检查依赖是否完成
 *   4. 非持久化的内存缓存
 *
 * 流程:
 *   1. 设置活跃团队名称
 *   2. 从磁盘加载已有任务
 *   3. 创建/更新任务时修改内存数据
 *   4. 原子写入持久化到磁盘
 *   5. 认领时检查依赖任务状态
 *   6. 完成后更新状态并持久化
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { shortUuid, uuid } from "@/core/id";
import type { TeamTask, TeamTaskStatus } from "../types";
import { createLogger } from "@/core/logging/logger";
import { ensureDir } from "@/tool/shared/fs";
import { getTeamStorageDir, resolveTeamProjectDir } from "../persist/storagePaths";
import { createInternalError } from "@/core/errors/appError";

const log = createLogger("team:task-list");

// ─── 文件 I/O ────────────────────────────────────────────────

interface TaskListData {
  tasks: TeamTask[];
  updatedAt: number;
}

function getTaskListPath(teamName: string, projectDir?: string): string {
  return join(getTeamStorageDir(projectDir), teamName, "tasks.json");
}

function readTaskListData(teamName: string, projectDir?: string): TaskListData {
  const filePath = getTaskListPath(teamName, projectDir);
  if (!existsSync(filePath)) {
    return { tasks: [], updatedAt: Date.now() };
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as TaskListData;
  } catch {
    return { tasks: [], updatedAt: Date.now() };
  }
}

function writeTaskListData(teamName: string, data: TaskListData, projectDir?: string): void {
  const filePath = getTaskListPath(teamName, projectDir);
  data.updatedAt = Date.now();
  const content = JSON.stringify(data, null, 2);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    ensureDir(dirname(filePath));
    // 原子写入:tmp + rename。后缀必须每次写入唯一，避免同进程并发写同一文件时互相覆盖 tmp。
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${shortUuid().slice(0, 8)}`;
    try {
      writeFileSync(tmpPath, content);
      renameSync(tmpPath, filePath);
      return;
    } catch (error) {
      if (attempt === 0 && error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
}

// ─── TaskList 类 ──────────────────────────────────────────────

/** Team 共享任务列表(持久化版) */
export class TeamTaskList {
  private tasks = new Map<string, TeamTask>();
  /** 活跃团队名称(用于持久化) */
  private teamName: string | null = null;
  private projectDir: string;

  constructor(projectDir?: string) {
    this.projectDir = resolveTeamProjectDir(projectDir);
  }

  setProjectDir(projectDir?: string): void {
    this.projectDir = resolveTeamProjectDir(projectDir);
    if (this.teamName) {
      this.loadFromDisk();
    }
  }

  /** 设置活跃团队名称(用于持久化路径) */
  setActiveTeam(teamName: string | null): void {
    this.teamName = teamName;
    if (teamName) {
      // 从文件加载已有任务
      this.loadFromDisk();
    }
  }

  /** 当前活跃团队名称 */
  getActiveTeamName(): string | null {
    return this.teamName;
  }

  /** 从文件加载任务列表 */
  private loadFromDisk(): void {
    if (!this.teamName) {
      return;
    }
    const data = readTaskListData(this.teamName, this.projectDir);
    this.tasks.clear();
    for (const task of data.tasks) {
      this.tasks.set(task.id, task);
    }
    log.info(`从磁盘加载 ${data.tasks.length} 个任务 (${this.teamName})`);
  }

  /** 持久化到文件 */
  private flushToDisk(): void {
    if (!this.teamName) {
      return;
    }
    writeTaskListData(
      this.teamName,
      {
        tasks: [...this.tasks.values()],
        updatedAt: Date.now(),
      },
      this.projectDir,
    );
  }

  /** 创建新任务 */
  create(
    description: string,
    assignee?: string,
    options?: {
      title?: string;
      dependencies?: string[];
      assigneeName?: string;
    },
  ): TeamTask {
    const now = Date.now();
    const task: TeamTask = {
      assignee,
      assigneeName: options?.assigneeName,
      createdAt: now,
      dependencies: options?.dependencies && options.dependencies.length > 0 ? options.dependencies : undefined,
      description,
      id: uuid(),
      status: "pending",
      title: options?.title ?? description.slice(0, 80),
      updatedAt: now,
    };

    // 循环依赖检测
    if (task.dependencies && task.dependencies.length > 0) {
      if (this.detectCycle(task.id, task.dependencies)) {
        throw createInternalError("INTERNAL_ERROR", `任务 "${task.title}" 的依赖存在循环引用`);
      }
    }

    this.tasks.set(task.id, task);
    this.flushToDisk();
    log.info(`任务已创建: ${task.id} — ${task.title}`);
    return task;
  }

  /** 认领任务(带依赖检查) */
  claim(taskId: string, assigneeId: string, assigneeName?: string): TeamTask | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    if (task.status !== "pending") {
      throw createInternalError("INTERNAL_ERROR", `任务 "${task.title}" 状态为 ${task.status}，无法认领`);
    }

    // 检查未完成的依赖
    if (task.dependencies && task.dependencies.length > 0) {
      const unresolved = task.dependencies.filter((depId) => {
        const dep = this.tasks.get(depId);
        return !dep || dep.status !== "completed";
      });
      if (unresolved.length > 0) {
        throw createInternalError("INTERNAL_ERROR", `任务 "${task.title}" 有未完成的依赖: ${unresolved.join(", ")}`);
      }
    }

    task.status = "in-progress";
    task.assignee = assigneeId;
    task.assigneeName = assigneeName;
    task.updatedAt = Date.now();
    this.flushToDisk();
    log.info(`任务 ${taskId} 已认领: ${assigneeName ?? assigneeId}`);
    return task;
  }

  /** 完成任务 */
  complete(taskId: string): TeamTask | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    task.status = "completed";
    task.completedAt = Date.now();
    task.updatedAt = task.completedAt;
    this.flushToDisk();
    log.info(`任务 ${taskId} 已完成: ${task.title}`);
    return task;
  }

  /** 分配任务给队友 */
  assign(taskId: string, teammateId: string, teammateName?: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }
    task.assignee = teammateId;
    task.assigneeName = teammateName;
    task.updatedAt = Date.now();
    this.flushToDisk();
    log.info(`任务 ${taskId} 已分配给队友 ${teammateName ?? teammateId}`);
    return true;
  }

  /** 更新任务状态 */
  updateStatus(taskId: string, status: TeamTaskStatus): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }
    task.status = status;
    task.updatedAt = Date.now();
    if (status === "completed") {
      task.completedAt = Date.now();
    }
    this.flushToDisk();
    log.info(`任务 ${taskId} 状态更新: ${status}`);
    return true;
  }

  /** 获取任务 */
  get(taskId: string): TeamTask | undefined {
    return this.tasks.get(taskId);
  }

  /** 列出所有任务 */
  list(): TeamTask[] {
    return [...this.tasks.values()];
  }

  /** DFS 检测依赖图中是否存在循环 */
  private detectCycle(newTaskId: string, newDeps: string[]): boolean {
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (taskId: string): boolean => {
      if (stack.has(taskId)) {
        return true;
      }
      if (visited.has(taskId)) {
        return false;
      }
      visited.add(taskId);
      stack.add(taskId);

      const task = this.tasks.get(taskId);
      if (task?.dependencies) {
        for (const dep of task.dependencies) {
          if (dfs(dep)) {
            return true;
          }
        }
      }

      stack.delete(taskId);
      return false;
    };

    for (const depId of newDeps) {
      // 如果新任务出现在某依赖链的末尾 → 循环
      if (depId === newTaskId) {
        return true;
      }
      if (dfs(depId)) {
        return true;
      }
    }
    return false;
  }

  /** 列出可认领的任务(依赖全部已完成 + 状态为 pending) */
  listClaimable(): TeamTask[] {
    return this.list().filter((task) => {
      if (task.status !== "pending") {
        return false;
      }
      if (!task.dependencies || task.dependencies.length === 0) {
        return true;
      }
      return task.dependencies.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep && dep.status === "completed";
      });
    });
  }

  /** 按状态过滤 */
  listByStatus(status: TeamTaskStatus): TeamTask[] {
    return this.list().filter((t) => t.status === status);
  }

  /** 按队友过滤 */
  listByAssignee(teammateId: string): TeamTask[] {
    return this.list().filter((t) => t.assignee === teammateId);
  }

  /** 清空所有任务 */
  clear(): void {
    this.tasks.clear();
    this.flushToDisk();
  }

  /** 任务总数 */
  get size(): number {
    return this.tasks.size;
  }
}

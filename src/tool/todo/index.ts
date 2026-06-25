/**
 * TODO 管理工具 — 任务列表的 CRUD + 状态管理。
 *
 * 职责:
 *   - 创建、读取、更新、删除 TODO 项
 *   - 管理 TODO 状态流转
 *   - 扫描代码中的 TODO 注释
 *   - 持久化存储到项目目录
 *
 * 模块功能:
 *   - todoUltraTool: 统一 Todo 管理工具定义
 *   - 状态流转:pending → in_progress → completed
 *   - 支持优先级设置
 *   - 支持从代码扫描 TODO
 *
 * 使用场景:
 *   - AI 需要管理任务列表
 *   - 跟踪代码中的 TODO 注释
 *   - 项目任务管理
 *
 * 边界:
 *   1. 权限:fs.edit
 *   2. 存储位置:项目根目录 .crab/todos.json
 *   3. 支持内存模式和持久化模式
 *   4. 最大内存存储数量限制
 *   5. 支持扫描 TODO/FIXME/HACK 关键字
 *
 * 流程:
 *   1. 接收操作参数
 *   2. 加载或创建存储
 *   3. 执行 CRUD 操作
 *   4. 持久化到文件(如需要)
 *   5. 返回操作结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { AppEvent, globalBus } from "@/bus";
import { MAX_TODO_STORES } from "@/config";

import { prefixedId } from "@/core/id";
import fs from "node:fs";
import path from "node:path";

// ── 类型与常量 re-export ─────────────────────────────────────────
/** re-export */
export type { TodoItem, TodoItemTree, TodoPhase, TodoStore } from "./todoTypes";
export { PRIORITY_ORDER } from "./todoTypes";

// ── 锁机制 re-export ─────────────────────────────────────────────
export { getTodoFilePath, getTodoTmpPath, withTodoStoreLock } from "./todoLock";

// ── Ultra handler re-export ──────────────────────────────────────
export {
  ultraAdvancePhase,
  ultraAddItem,
  ultraAddPhase,
  ultraAddSubtask,
  ultraCompletePhase,
  ultraDeleteItem,
  ultraGet,
  ultraUpdateItem,
} from "./todoUltra";

import type { TodoStore } from "./todoTypes";
import { getTodoFilePath, getTodoTmpPath, withTodoStoreLock } from "./todoLock";
import {
  ultraAdvancePhase,
  ultraAddItem,
  ultraAddPhase,
  ultraAddSubtask,
  ultraCompletePhase,
  ultraDeleteItem,
  ultraGet,
  ultraUpdateItem,
} from "./todoUltra";
import { handleCreate, handleRead, handleUpdate, handleDelete, handleList, handleScan } from "./todoHandlers";

// ── Store 辅助 ───────────────────────────────────────────────────

const MAX_MEMORY_STORES = MAX_TODO_STORES;
const memoryStore = new Map<string, TodoStore>();

function trimMemoryStore(): void {
  if (memoryStore.size <= MAX_MEMORY_STORES) {
    return;
  }
  const firstKey = memoryStore.keys().next().value;
  if (firstKey) {
    memoryStore.delete(firstKey);
  }
}

/** 获取 Todo 存储实例，支持项目级持久化和内存缓存 */
export function getStore(projectDir?: string): TodoStore {
  if (projectDir) {
    const filePath = getTodoFilePath(projectDir);
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return data as TodoStore;
      }
    } catch (error: unknown) {
      log.debug(`读取 TODO 文件失败: ${filePath}`, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  const key = projectDir ?? "__memory__";
  if (!memoryStore.has(key)) {
    trimMemoryStore();
    memoryStore.set(key, { items: [], updatedAt: new Date().toISOString() });
  }
  return memoryStore.get(key)!;
}

/** 保存 Todo 存储到磁盘并发布同步事件 */
export function saveStore(store: TodoStore, projectDir?: string): void {
  store.updatedAt = new Date().toISOString();
  if (projectDir) {
    const filePath = getTodoFilePath(projectDir);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = getTodoTmpPath(projectDir);
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  }
  globalBus.publish(AppEvent.TodoSync, { items: store.items });
}

/** 生成 Todo 条目 ID */
export function generateId(): string {
  return prefixedId("todo");
}

const log = createLogger("tool:todo");

// ── Ultra Todo 工具 ──────────────────────────────────────────────

/** 统一 Todo 管理工具，支持阶段式 Ultra Todo、父子任务树和普通 CRUD */
export const todoUltraTool = defineTool({
  description:
    "统一 Todo 管理工具。支持阶段式 Ultra Todo、父子任务树、普通 CRUD/list/scan、阶段完成门禁和自动推进。" +
    "阶段操作:get、add_phase、add_item、add_subtask、update_item、complete_phase、advance_phase、delete_item。" +
    "普通任务操作:create、read、update、delete、list、scan。" +
    "阶段完成门禁:complete_phase 要求阶段内所有父任务和子任务已完成；advance_phase 支持 force=true 跳过门禁。",
  execute: async ({
    action,
    title,
    content,
    id,
    phaseId,
    status,
    priority,
    parentId,
    deleteChildren,
    filter,
    sortBy,
    page,
    pageSize,
    scanProject,
    force,
    projectDir,
  }) => {
    const cwd = projectDir ?? process.cwd();

    try {
      return withTodoStoreLock(cwd, () => {
        const store = getStore(cwd);
        switch (action) {
          case "get": {
            return ultraGet(store, cwd);
          }
          case "add_phase": {
            const r = ultraAddPhase(store, title!, cwd);
            saveStore(store, cwd);
            return r;
          }
          case "add_item": {
            const r = ultraAddItem(store, content!, phaseId, cwd, priority);
            saveStore(store, cwd);
            return r;
          }
          case "add_subtask": {
            const r = ultraAddSubtask(store, content!, id!, cwd, priority);
            saveStore(store, cwd);
            return r;
          }
          case "update_item": {
            const r = ultraUpdateItem(store, id!, status, content, cwd);
            saveStore(store, cwd);
            return r;
          }
          case "delete_item": {
            const r = ultraDeleteItem(store, id!, cwd);
            saveStore(store, cwd);
            return r;
          }
          case "complete_phase": {
            const r = ultraCompletePhase(store, phaseId, cwd);
            saveStore(store, cwd);
            return r;
          }
          case "advance_phase": {
            const r = ultraAdvancePhase(store, force, cwd);
            saveStore(store, cwd);
            return r;
          }
          case "create": {
            return handleCreate(store, generateId, saveStore, content, priority, cwd, parentId);
          }
          case "read": {
            return handleRead(store, id);
          }
          case "update": {
            return handleUpdate(store, saveStore, id, status, priority, content, cwd);
          }
          case "delete": {
            return handleDelete(store, saveStore, id, cwd, deleteChildren);
          }
          case "list": {
            return handleList(store, filter, sortBy, page, pageSize, cwd, scanProject, parentId);
          }
          case "scan": {
            return handleScan(cwd);
          }
          default: {
            return { error: `未知操作: ${action}`, success: false };
          }
        }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Ultra Todo 操作失败: ${action}`, { error: msg });
      return { error: msg, success: false };
    }
  },
  name: "todo-ultra",
  parameters: z.object({
    action: z
      .enum([
        "get",
        "add_phase",
        "add_item",
        "add_subtask",
        "update_item",
        "complete_phase",
        "advance_phase",
        "delete_item",
        "create",
        "read",
        "update",
        "delete",
        "list",
        "scan",
      ])
      .describe(
        "操作类型。阶段式操作:get/add_phase/add_item/add_subtask/update_item/complete_phase/advance_phase/delete_item；普通任务操作:create/read/update/delete/list/scan",
      ),
    content: z.string().optional().describe("任务内容(add_item/add_subtask/create/update 时使用)"),
    deleteChildren: z.boolean().optional().describe("delete 时是否级联删除子任务(默认 false，有子任务时阻止删除)"),
    filter: z.enum(["pending", "in_progress", "completed", "all"]).optional().describe("过滤状态(list 时使用)"),
    force: z.boolean().optional().describe("advance_phase 是否强制推进(跳过未完成检查)"),
    id: z
      .string()
      .optional()
      .describe("任务 ID(read/update/delete/update_item/delete_item 时必填，add_subtask 时为父任务 ID)"),
    page: z.number().optional().describe("页码(list 时使用，从 1 开始，默认 1)"),
    pageSize: z.number().optional().describe("每页数量(list 时使用，默认 20，最大 100)"),
    parentId: z.string().optional().describe("父任务 ID(create 创建子任务；list 按父任务过滤)"),
    phaseId: z.string().optional().describe("阶段 ID(add_item/complete_phase 时可选，默认当前阶段)"),
    priority: z
      .enum(["low", "medium", "high"])
      .optional()
      .describe("任务优先级(create/update/list/add_item/add_subtask 时使用)"),
    projectDir: z.string().optional().describe("项目目录(默认当前工作目录)"),
    scanProject: z.boolean().optional().describe("list 时是否合并项目代码里的 TODO/FIXME/HACK 注释"),
    sortBy: z
      .enum(["priority", "created", "updated"])
      .optional()
      .describe("排序方式(list 时使用):priority/created/updated"),
    status: z.enum(["pending", "in_progress", "completed"]).optional().describe("任务状态(update/update_item 时使用)"),
    title: z.string().optional().describe("阶段标题(add_phase 时必填)"),
  }),
  permission: "fs.edit",
  builtin: true,
});

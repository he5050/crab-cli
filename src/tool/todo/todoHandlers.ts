/**
 * TODO CRUD 处理函数 — 创建、读取、更新、删除、列表、扫描。
 */
import { createLogger } from "@/core/logging/logger";
import { iconError, iconLoading, iconTasks, iconWarning, symEmpty } from "@/core/icons/icon";
import { scanProjectTodos } from "@/core/scanning";
import { PRIORITY_ORDER } from "./todoTypes";
import type { TodoItem, TodoStore } from "./todoTypes";

const log = createLogger("tool:todo");

/** 有效的优先级值映射 */
const PRIORITY_MAP: Record<string, TodoItem["priority"]> = { high: "high", low: "low", medium: "medium" };
/** 有效的状态值映射（不包含 failed，仅接受已定义的三种状态） */
const STATUS_MAP: Record<string, TodoItem["status"]> = {
  completed: "completed",
  in_progress: "in_progress",
  pending: "pending",
};

/** 将字符串映射为 Todo 优先级，无效值返回 undefined */
export function toTodoPriority(value: string): TodoItem["priority"] | undefined {
  return PRIORITY_MAP[value];
}

/** 将字符串映射为 Todo 状态，无效值返回 undefined */
export function toTodoStatus(value: string): TodoItem["status"] | undefined {
  return STATUS_MAP[value];
}

// ── 树形辅助 ────────────────────────────────────────────────────

/** 收集所有后代 ID */
export function collectTodoDescendantIds(store: TodoStore, parentId: string): Set<string> {
  const descendants = new Set<string>();
  function walk(id: string): void {
    for (const item of store.items) {
      if (item.parentId === id && !descendants.has(item.id)) {
        descendants.add(item.id);
        walk(item.id);
      }
    }
  }
  walk(parentId);
  return descendants;
}

/** 查找未完成的后代项 */
export function findIncompleteTodoDescendants(store: TodoStore, parentId: string): TodoItem[] {
  const descendantIds = collectTodoDescendantIds(store, parentId);
  return store.items.filter((item) => descendantIds.has(item.id) && item.status !== "completed");
}

// ── CRUD handler ─────────────────────────────────────────────────

/** 创建 TODO 条目 */
export function handleCreate(
  store: TodoStore,
  generateId: () => string,
  saveStore: (store: TodoStore, cwd?: string) => void,
  content?: string,
  priority?: string,
  cwd?: string,
  parentId?: string,
): Record<string, unknown> {
  if (!content) {
    return { error: "创建 TODO 需要提供 content", success: false };
  }
  if (parentId && !store.items.some((item) => item.id === parentId)) {
    return { error: `父任务不存在: ${parentId}`, success: false };
  }

  const now = new Date().toISOString();
  const item: TodoItem = {
    id: generateId(),
    content,
    status: "pending",
    ...(priority && { priority: toTodoPriority(priority) }),
    ...(parentId && { parentId }),
    createdAt: now,
    updatedAt: now,
  };

  store.items.push(item);
  saveStore(store, cwd);

  log.info(`TODO 已创建: ${item.id} - ${content}`);

  return {
    action: "create",
    item,
    success: true,
    total: store.items.length,
  };
}

/** 读取指定 TODO 条目 */
export function handleRead(store: TodoStore, id?: string): Record<string, unknown> {
  if (!id) {
    return { error: "读取 TODO 需要提供 id", success: false };
  }

  const item = store.items.find((i) => i.id === id);
  if (!item) {
    return { error: `TODO 不存在: ${id}`, success: false };
  }

  return { action: "read", item, success: true };
}

/** 更新 TODO 条目的状态、优先级或内容 */
export function handleUpdate(
  store: TodoStore,
  saveStore: (store: TodoStore, cwd?: string) => void,
  id?: string,
  status?: string,
  priority?: string,
  content?: string,
  cwd?: string,
): Record<string, unknown> {
  if (!id) {
    return { error: "更新 TODO 需要提供 id", success: false };
  }

  const idx = store.items.findIndex((i) => i.id === id);
  if (idx === -1) {
    return { error: `TODO 不存在: ${id}`, success: false };
  }

  const item = store.items[idx]!;
  if (status === "completed") {
    const incompleteDescendants = findIncompleteTodoDescendants(store, id);
    if (incompleteDescendants.length > 0) {
      return {
        error: `TODO ${id} 有 ${incompleteDescendants.length} 个未完成子任务，请先完成子任务再完成父任务`,
        incompleteItems: incompleteDescendants,
        success: false,
      };
    }
  }
  if (status) {
    item.status = toTodoStatus(status) ?? item.status;
  }
  if (priority) {
    item.priority = toTodoPriority(priority) ?? item.priority;
  }
  if (content) {
    item.content = content;
  }
  item.updatedAt = new Date().toISOString();

  saveStore(store, cwd);

  log.info(`TODO 已更新: ${id} → ${status ?? "内容已修改"}`);

  return { action: "update", item, success: true };
}

/** 删除 TODO 条目，支持级联删除子任务 */
export function handleDelete(
  store: TodoStore,
  saveStore: (store: TodoStore, cwd?: string) => void,
  id?: string,
  cwd?: string,
  deleteChildren?: boolean,
): Record<string, unknown> {
  if (!id) {
    return { error: "删除 TODO 需要提供 id", success: false };
  }

  const idx = store.items.findIndex((i) => i.id === id);
  if (idx === -1) {
    return { error: `TODO 不存在: ${id}`, success: false };
  }

  const descendants = collectTodoDescendantIds(store, id);
  if (descendants.size > 0 && !deleteChildren) {
    return {
      childIds: [...descendants],
      error: `TODO ${id} 有 ${descendants.size} 个子任务，请先删除子任务或设置 deleteChildren=true`,
      success: false,
    };
  }

  for (const childId of descendants) {
    const childIdx = store.items.findIndex((i) => i.id === childId);
    if (childIdx !== -1) {
      store.items.splice(childIdx, 1);
    }
  }
  const nextIdx = store.items.findIndex((i) => i.id === id);
  const removed = store.items.splice(nextIdx, 1)[0]!;
  saveStore(store, cwd);

  log.info(`TODO 已删除: ${id}`);

  return { action: "delete", cascadedCount: descendants.size, item: removed, success: true, total: store.items.length };
}

/** 列出 TODO 条目，支持过滤、排序、分页和代码扫描 */
export function handleList(
  store: TodoStore,
  filter?: string,
  sortBy?: string,
  page?: number,
  pageSize?: number,
  projectDir?: string,
  scanProject?: boolean,
  parentId?: string,
): Record<string, unknown> {
  const scannedItems =
    scanProject && projectDir
      ? scanProjectTodos(projectDir).map<TodoItem>((item) => ({
          content: item.content,
          createdAt: new Date(0).toISOString(),
          filePath: item.filePath,
          id: item.id,
          keyword: item.keyword,
          line: item.line,
          priority: item.priority,
          source: "scan",
          status: "pending",
          updatedAt: new Date(0).toISOString(),
        }))
      : [];

  // 过滤
  let items = [...store.items, ...scannedItems];
  if (parentId) {
    items = items.filter((i) => i.parentId === parentId);
  }
  if (filter && filter !== "all") {
    items = items.filter((i) => i.status === filter);
  }

  // 排序
  if (sortBy === "priority") {
    items = [...items].toSorted(
      (a, b) => (PRIORITY_ORDER[b.priority ?? "medium"] ?? 2) - (PRIORITY_ORDER[a.priority ?? "medium"] ?? 2),
    );
  } else if (sortBy === "updated") {
    items = [...items].toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } else {
    // 默认按创建时间
    items = [...items].toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // 分页
  const effectivePageSize = Math.min(Math.max(pageSize ?? 20, 1), 100);
  const effectivePage = Math.max(page ?? 1, 1);
  const totalPages = Math.max(1, Math.ceil(items.length / effectivePageSize));
  const startIdx = (effectivePage - 1) * effectivePageSize;
  const pagedItems = items.slice(startIdx, startIdx + effectivePageSize);

  const pending = items.filter((i) => i.status === "pending");
  const inProgress = items.filter((i) => i.status === "in_progress");
  const completed = items.filter((i) => i.status === "completed");

  // 格式化输出(仅输出当前页)
  const lines: string[] = [];
  if (inProgress.length > 0) {
    lines.push("## 进行中");
    for (const item of pagedItems.filter((i) => i.status === "in_progress")) {
      lines.push(`- ${iconLoading} ${item.content}${formatLocation(item)} (${item.id})`);
    }
  }
  if (pending.length > 0) {
    lines.push("## 待办");
    for (const item of pagedItems.filter((i) => i.status === "pending")) {
      const prio = item.priority === "high" ? `${iconError} ` : item.priority === "medium" ? `${iconWarning} ` : "";
      lines.push(`- ${symEmpty} ${prio}${item.content}${formatLocation(item)} (${item.id})`);
    }
  }
  if (completed.length > 0) {
    lines.push("## 已完成");
    for (const item of pagedItems.filter((i) => i.status === "completed")) {
      lines.push(`- ${iconTasks} ~~${item.content}~~${formatLocation(item)} (${item.id})`);
    }
  }

  return {
    action: "list",
    completed: completed.length,
    content: lines.length > 0 ? lines.join("\n") : "任务列表为空",
    inProgress: inProgress.length,
    items: pagedItems,
    page: effectivePage,
    pageSize: effectivePageSize,
    pending: pending.length,
    scannedCount: scannedItems.length,
    success: true,
    todos: pagedItems,
    total: items.length,
    totalPages,
  };
}

/** 扫描项目代码中的 TODO/FIXME/HACK 注释 */
export function handleScan(projectDir: string): Record<string, unknown> {
  const scanned = scanProjectTodos(projectDir);
  return {
    action: "scan",
    content:
      scanned.length > 0
        ? scanned.map((item) => `- [${item.keyword}] ${item.content} (${item.filePath}:${item.line})`).join("\n")
        : "未扫描到 TODO 注释",
    success: true,
    todos: scanned,
    total: scanned.length,
  };
}

function formatLocation(item: TodoItem): string {
  if (!item.filePath) {
    return "";
  }
  const line = item.line ? `:${item.line}` : "";
  return ` [${item.filePath}${line}]`;
}

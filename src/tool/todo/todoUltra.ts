/**
 * TODO 工具 — Ultra Todo 阶段管理 handler。
 *
 * 包含 Ultra 模式下的阶段 CRUD、任务管理、完成门禁和自动推进逻辑。
 */

import { createLogger } from "@/core/logging/logger";
import { iconLoading, iconTasks, symEmpty } from "@/core/icons/icon";
import { prefixedId } from "@/core/id";
import type { TodoItem, TodoPhase, TodoStore, TodoItemTree } from "./todoTypes";
import { toTodoPriority, toTodoStatus } from "./todoHandlers";

// ── logger ──────────────────────────────────────────────────────

const log = createLogger("tool:todo:ultra");

// ── 辅助函数 ────────────────────────────────────────────────────

/** 生成阶段 ID */
export function generatePhaseId(): string {
  return prefixedId("phase");
}

/** 确保 store 处于 Ultra 模式 */
function ensureUltraStore(store: TodoStore): void {
  if (!store.ultraMode) {
    store.ultraMode = true;
  }
  if (!store.phases) {
    store.phases = [];
  }
}

// ── 查找未完成后代 ──────────────────────────────────────────────
// 注意：findIncompleteTodoDescendants 定义在 index.ts 中，
// 此处通过参数注入以保持单向依赖。

/** 查找指定 ID 下所有未完成的后代项 */
function findIncompleteDescendants(store: TodoStore, parentId: string): TodoItem[] {
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
  return store.items.filter((item) => descendants.has(item.id) && item.status !== "completed");
}

// ── Ultra handler ──────────────────────────────────────────────

/** 获取 Ultra 模式总览 */
export function ultraGet(store: TodoStore, _cwd?: string): Record<string, unknown> {
  ensureUltraStore(store);
  const phases = store.phases!;
  const currentPhase = phases.find((p) => p.id === store.currentPhaseId);
  const phaseItems = (phaseId: string) => store.items.filter((i) => i.phaseId === phaseId && !i.parentId);
  const childItems = (parentId: string) => store.items.filter((i) => i.parentId === parentId);

  const lines: string[] = [];
  lines.push(`Ultra Todo 模式 | 当前阶段: ${currentPhase?.title ?? "无"}`);
  lines.push(`阶段总数: ${phases.length}`);
  lines.push("");

  const pushItemLine = (item: TodoItem, indent: number): void => {
    const icon = item.status === "completed" ? iconTasks : item.status === "in_progress" ? iconLoading : symEmpty;
    const prefix = indent === 0 ? "" : "↳ ";
    lines.push(`${" ".repeat(4 + indent * 2)}${icon} ${prefix}${item.content} (${item.id})`);
    for (const child of childItems(item.id)) {
      pushItemLine(child, indent + 1);
    }
  };

  const buildItemTree = (item: TodoItem): TodoItemTree => ({
    ...item,
    subtasks: childItems(item.id).map((child) => buildItemTree(child)),
  });

  for (const phase of phases) {
    const items = phaseItems(phase.id);
    const completedCount = items.filter((i) => i.status === "completed").length;
    const marker = phase.id === store.currentPhaseId ? "▸ " : "  ";
    const statusIcon =
      phase.status === "completed" ? iconTasks : phase.status === "inProgress" ? iconLoading : symEmpty;
    lines.push(`${marker}${statusIcon} [${phase.title}] (${completedCount}/${items.length}) ${phase.id}`);

    if (phase.id === store.currentPhaseId) {
      for (const item of items) {
        pushItemLine(item, 0);
      }
    }
  }

  return {
    action: "get",
    content: lines.join("\n"),
    currentPhaseId: store.currentPhaseId ?? null,
    phases: phases.map((p) => {
      const pItems = phaseItems(p.id);
      return {
        id: p.id,
        itemCount: pItems.length,
        items: pItems.map((i) => buildItemTree(i)),
        status: p.status,
        title: p.title,
      };
    }),
    success: true,
    ultraMode: true,
  };
}

/** 添加阶段 */
export function ultraAddPhase(store: TodoStore, title: string, cwd: string): Record<string, unknown> {
  ensureUltraStore(store);
  if (!title) {
    return { error: "阶段标题不能为空", success: false };
  }

  const now = new Date().toISOString();
  const phase: TodoPhase = { createdAt: now, id: generatePhaseId(), status: "pending", title, updatedAt: now };
  store.phases!.push(phase);

  // 首个阶段自动设为当前阶段
  if (!store.currentPhaseId) {
    store.currentPhaseId = phase.id;
  }

  log.info(`Ultra 阶段已创建: ${phase.id} - ${title}`);
  return { action: "add_phase", phase, success: true };
}

/** 在阶段中添加任务 */
export function ultraAddItem(
  store: TodoStore,
  content: string,
  phaseId?: string,
  cwd?: string,
  priority?: string,
): Record<string, unknown> {
  ensureUltraStore(store);
  if (!content) {
    return { error: "任务内容不能为空", success: false };
  }

  const targetPhaseId = phaseId ?? store.currentPhaseId;
  if (!targetPhaseId) {
    return { error: "无当前阶段，请先创建阶段或指定 phaseId", success: false };
  }
  if (!store.phases!.find((p) => p.id === targetPhaseId)) {
    return { error: `阶段不存在: ${targetPhaseId}`, success: false };
  }

  const now = new Date().toISOString();
  const item: TodoItem = {
    id: prefixedId("todo"),
    content,
    status: "pending",
    phaseId: targetPhaseId,
    ...(priority && { priority: toTodoPriority(priority) }),
    createdAt: now,
    updatedAt: now,
  };
  store.items.push(item);

  log.info(`Ultra 任务已创建: ${item.id} → 阶段 ${targetPhaseId}`);
  return { action: "add_item", item, success: true };
}

/** 添加子任务 */
export function ultraAddSubtask(
  store: TodoStore,
  content: string,
  parentId: string,
  cwd?: string,
  priority?: string,
): Record<string, unknown> {
  ensureUltraStore(store);
  if (!content) {
    return { error: "子任务内容不能为空", success: false };
  }

  const parent = store.items.find((i) => i.id === parentId);
  if (!parent) {
    return { error: `父任务不存在: ${parentId}`, success: false };
  }
  if (!parent.phaseId) {
    return { error: `父任务未关联阶段: ${parentId}`, success: false };
  }

  const now = new Date().toISOString();
  const item: TodoItem = {
    id: prefixedId("todo"),
    content,
    status: "pending",
    phaseId: parent.phaseId,
    parentId,
    ...(priority && { priority: toTodoPriority(priority) }),
    createdAt: now,
    updatedAt: now,
  };
  store.items.push(item);

  log.info(`Ultra 子任务已创建: ${item.id} → 父任务 ${parentId}`);
  return { action: "add_subtask", item, success: true };
}

/** 更新任务状态/内容 */
export function ultraUpdateItem(
  store: TodoStore,
  id: string,
  status?: string,
  content?: string,
  cwd?: string,
): Record<string, unknown> {
  ensureUltraStore(store);
  const idx = store.items.findIndex((i) => i.id === id);
  if (idx === -1) {
    return { error: `任务不存在: ${id}`, success: false };
  }

  const item = store.items[idx]!;
  if (status === "completed") {
    const incompleteDescendants = findIncompleteDescendants(store, id);
    if (incompleteDescendants.length > 0) {
      return {
        error: `任务 ${id} 有 ${incompleteDescendants.length} 个未完成子任务，请先完成子任务再完成父任务`,
        incompleteItems: incompleteDescendants,
        success: false,
      };
    }
  }
  if (status) {
    item.status = toTodoStatus(status) ?? item.status;
  }
  if (content) {
    item.content = content;
  }
  item.updatedAt = new Date().toISOString();

  return { action: "update_item", item, success: true };
}

/** 删除任务（级联删除后代） */
export function ultraDeleteItem(store: TodoStore, id: string, cwd?: string): Record<string, unknown> {
  ensureUltraStore(store);
  const idx = store.items.findIndex((i) => i.id === id);
  if (idx === -1) {
    return { error: `任务不存在: ${id}`, success: false };
  }

  // 递归收集所有后代 ID
  const descendants = new Set<string>();
  function collectDescendants(parentId: string): void {
    for (const item of store.items) {
      if (item.parentId === parentId && !descendants.has(item.id)) {
        descendants.add(item.id);
        collectDescendants(item.id);
      }
    }
  }
  collectDescendants(id);

  // 删除后代
  for (const descId of descendants) {
    const descIdx = store.items.findIndex((i) => i.id === descId);
    if (descIdx !== -1) {
      store.items.splice(descIdx, 1);
    }
  }

  // 删除目标本身
  const removed = store.items.splice(idx, 1)[0]!;

  return { action: "delete_item", cascadedCount: descendants.size, item: removed, success: true };
}

/** 完成阶段（需所有任务和子任务均已完成） */
export function ultraCompletePhase(store: TodoStore, phaseId?: string, cwd?: string): Record<string, unknown> {
  ensureUltraStore(store);
  const targetId = phaseId ?? store.currentPhaseId;
  if (!targetId) {
    return { error: "无当前阶段", success: false };
  }

  const phase = store.phases!.find((p) => p.id === targetId);
  if (!phase) {
    return { error: `阶段不存在: ${targetId}`, success: false };
  }

  const items = store.items.filter((i) => i.phaseId === targetId && !i.parentId);
  const incomplete = items.filter((i) => i.status !== "completed");

  // 检查子任务完成情况
  if (incomplete.length === 0) {
    const subtasks = store.items.filter((i) => i.phaseId === targetId && i.parentId);
    const incompleteSubs = subtasks.filter((s) => s.status !== "completed");
    if (incompleteSubs.length > 0) {
      const names = incompleteSubs.map((s) => s.content).join(", ");
      return {
        error: `阶段「${phase.title}」有 ${incompleteSubs.length} 个未完成子任务: ${names}。请先完成所有子任务或使用 advance_phase 强制推进。`,
        incompleteItems: incompleteSubs,
        success: false,
      };
    }
  }

  if (incomplete.length > 0) {
    const names = incomplete.map((i) => i.content).join(", ");
    return {
      error: `阶段「${phase.title}」有 ${incomplete.length} 个未完成任务: ${names}。请先完成所有任务或使用 advance_phase 强制推进。`,
      incompleteItems: incomplete,
      success: false,
    };
  }

  phase.status = "completed";
  phase.updatedAt = new Date().toISOString();

  return { action: "complete_phase", phase, success: true };
}

/** 推进到下一阶段 */
export function ultraAdvancePhase(store: TodoStore, force?: boolean, cwd?: string): Record<string, unknown> {
  ensureUltraStore(store);
  if (!store.currentPhaseId) {
    return { error: "无当前阶段", success: false };
  }

  const currentIdx = store.phases!.findIndex((p) => p.id === store.currentPhaseId);
  if (currentIdx === -1) {
    return { error: `当前阶段不存在: ${store.currentPhaseId}`, success: false };
  }

  const currentPhase = store.phases![currentIdx]!;

  // 非强制模式下检查未完成项
  if (!force) {
    const items = store.items.filter((i) => i.phaseId === currentPhase.id);
    const incomplete = items.filter((i) => i.status !== "completed");
    if (incomplete.length > 0) {
      const names = incomplete.map((i) => i.content).join(", ");
      return {
        error: `阶段「${currentPhase.title}」有 ${incomplete.length} 个未完成任务: ${names}。使用 force=true 强制推进。`,
        incompleteItems: incomplete,
        success: false,
      };
    }
  }

  // 标记当前阶段完成
  currentPhase.status = "completed";
  currentPhase.updatedAt = new Date().toISOString();

  // 推进到下一个阶段
  if (currentIdx + 1 < store.phases!.length) {
    const nextPhase = store.phases![currentIdx + 1]!;
    nextPhase.status = "inProgress";
    nextPhase.updatedAt = new Date().toISOString();
    store.currentPhaseId = nextPhase.id;

    log.info(`Ultra 阶段推进: ${currentPhase.title} → ${nextPhase.title}`);
    return {
      action: "advance_phase",
      completedPhase: currentPhase,
      currentPhase: nextPhase,
      currentPhaseId: nextPhase.id,
      success: true,
    };
  }

  // 已是最后一个阶段
  log.info(`Ultra 所有阶段已完成`);

  return {
    action: "advance_phase",
    allCompleted: true,
    completedPhase: currentPhase,
    currentPhaseId: null,
    success: true,
  };
}

/**
 * TODO 工具 — 类型定义与常量。
 */

// ── 接口 ────────────────────────────────────────────────────────

/** TODO 项 */
export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority?: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
  source?: "manual" | "scan";
  filePath?: string;
  line?: number;
  keyword?: "TODO" | "FIXME" | "HACK";
  phaseId?: string;
  parentId?: string;
}

/** Ultra Todo 阶段 */
export interface TodoPhase {
  id: string;
  title: string;
  status: "pending" | "inProgress" | "completed";
  createdAt: string;
  updatedAt: string;
}

/** 存储结构 */
export interface TodoStore {
  items: TodoItem[];
  updatedAt: string;
  ultraMode?: boolean;
  phases?: TodoPhase[];
  currentPhaseId?: string;
}

/** TodoItem 的树形视图（含子任务） */
export type TodoItemTree = TodoItem & { subtasks: TodoItemTree[] };

// ── 常量 ────────────────────────────────────────────────────────

/** 优先级排序映射 */
export const PRIORITY_ORDER: Record<string, number> = { high: 3, low: 1, medium: 2 };

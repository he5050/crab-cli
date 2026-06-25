/**
 * TODO 上下文预处理器 — 将 TODO 列表格式化为注入对话上下文的 markdown
 *
 *
 */

// ─── 类型 ──────────────────────────────────────────────────

export type TodoStatus = "pending" | "inProgress" | "completed";

export interface FormattableTodo {
  id: string;
  content: string;
  status: TodoStatus;
}

// ─── 状态符号 ─────────────────────────────────────────────

const STATUS_SYMBOL: Record<TodoStatus, string> = {
  pending: "[ ]",
  inProgress: "[~]",
  completed: "[x]",
};

// ─── 公开 API ──────────────────────────────────────────────

/** 将 TODO 列表格式化为 markdown 上下文块，用于注入 AI 系统提示词 */
export function formatTodoContext(todos: FormattableTodo[]): string {
  if (!todos.length) return "";

  const lines: string[] = [];
  lines.push("## Current TODO List");
  lines.push("");

  for (const todo of todos) {
    const symbol = STATUS_SYMBOL[todo.status] ?? "[ ]";
    lines.push(`${symbol} ${todo.content} (ID: ${todo.id})`);
  }

  lines.push("");
  lines.push("**Important**: Update TODO status immediately after completing each task.");

  return lines.join("\n");
}

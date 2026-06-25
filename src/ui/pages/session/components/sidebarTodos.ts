/**
 * 会话待办事项管理 — 待办项提取、规范化、排序和汇总。
 *
 * 职责:
 *   - 从聊天消息中提取待办事项
 *   - 规范化待办项数据格式
 *   - 排序和去重待办列表
 *   - 统计待办项摘要
 *
 * 模块功能:
 *   - SessionTodoStatus: 待办状态类型
 *   - SessionTodoSource: 待办来源类型
 *   - SessionTodoItem: 待办项数据结构
 *   - TodoSummary: 待办统计摘要
 *   - normalizeTodoItem: 规范化待办项
 *   - sortSessionTodos: 排序待办列表
 *   - summarizeTodos: 统计待办摘要
 *   - extractTodosFromMessages: 从消息提取待办
 *
 * 使用场景:
 *   - 会话侧边栏待办展示
 *   - 会话历史中的待办提取
 *   - 待办项的增删改查
 *
 * 边界:
 *   1. 仅处理数据提取和规范化，不涉及 UI 渲染
 *   2. 支持多种 todo 工具输出格式
 *   3. 自动推断待办来源(tool/goal/scan/manual)
 *   4. 排序优先级:状态 > 优先级 > 更新时间
 *
 * 流程:
 *   1. 从聊天消息中查找 todo 相关工具调用
 *   2. 解析工具输出的待办数据
 *   3. 规范化数据格式(支持多种字段名)
 *   4. 去重和排序
 *   5. 生成统计摘要
 */
import type { ChatMessage } from "@/ui/contexts/chat";

export type SessionTodoStatus = "pending" | "in_progress" | "completed";
export type SessionTodoSource = "tool" | "goal" | "scan" | "manual";

export interface SessionTodoItem {
  id: string;
  content: string;
  status: SessionTodoStatus;
  priority?: "low" | "medium" | "high";
  source: SessionTodoSource;
  sessionId?: string;
  parentId?: string;
  phaseId?: string;
  filePath?: string;
  line?: number;
  updatedAt?: string;
}

export interface TodoSummary {
  total: number;
  active: number;
  pending: number;
  inProgress: number;
  completed: number;
}

export function normalizeTodoStatus(status: unknown): SessionTodoStatus {
  if (status === "inProgress" || status === "in_progress" || status === "running") {
    return "in_progress";
  }
  if (status === "completed" || status === "done") {
    return "completed";
  }
  return "pending";
}

export function normalizeTodoItem(raw: unknown, source: SessionTodoSource = "tool"): SessionTodoItem | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const item = raw as Record<string, unknown>;
  const content =
    typeof item.content === "string"
      ? item.content
      : typeof item.text === "string"
        ? item.text
        : typeof item.title === "string"
          ? item.title
          : "";
  if (!content.trim()) {
    return undefined;
  }

  const id = typeof item.id === "string" && item.id.trim() ? item.id : `todo_${source}_${hashTodoContent(content)}`;

  return {
    content,
    filePath: typeof item.filePath === "string" ? item.filePath : undefined,
    id,
    line: typeof item.line === "number" ? item.line : undefined,
    parentId: typeof item.parentId === "string" ? item.parentId : undefined,
    phaseId: typeof item.phaseId === "string" ? item.phaseId : undefined,
    priority: normalizePriority(item.priority),
    sessionId: typeof item.sessionId === "string" ? item.sessionId : undefined,
    source: normalizeSource(item.source, source),
    status: normalizeTodoStatus(item.status),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined,
  };
}

export function sortSessionTodos(todos: SessionTodoItem[]): SessionTodoItem[] {
  const priorityRank: Record<string, number> = { high: 0, low: 2, medium: 1 };
  const statusRank: Record<SessionTodoStatus, number> = {
    completed: 2,
    in_progress: 0,
    pending: 1,
  };

  const sorted = [...dedupeTodos(todos)].toSorted((a, b) => {
    const statusDiff = statusRank[a.status] - statusRank[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    const priorityDiff = (priorityRank[a.priority ?? ""] ?? 3) - (priorityRank[b.priority ?? ""] ?? 3);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
  return flattenTodoTree(sorted);
}

export function summarizeTodos(todos: SessionTodoItem[]): TodoSummary {
  const pending = todos.filter((todo) => todo.status === "pending").length;
  const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
  const completed = todos.filter((todo) => todo.status === "completed").length;
  return {
    active: pending + inProgress,
    completed,
    inProgress,
    pending,
    total: todos.length,
  };
}

export function extractTodosFromMessages(messages: ChatMessage[], sessionId?: string): SessionTodoItem[] {
  const todos: SessionTodoItem[] = [];

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== "tool") {
        continue;
      }
      if (!isTodoTool(part.tool)) {
        continue;
      }
      todos.push(...extractTodosFromToolPart(part, sessionId));
    }
  }

  return sortSessionTodos(todos);
}

function extractTodosFromToolPart(
  part: Extract<NonNullable<ChatMessage["parts"]>[number], { type: "tool" }>,
  sessionId?: string,
): SessionTodoItem[] {
  const candidates: unknown[] = [];
  collectTodoCandidates(part.metadata, candidates);
  collectTodoCandidates(parseJson(part.output), candidates);
  collectTodoCandidates(part.input, candidates);

  return candidates
    .map((candidate) => normalizeTodoItem(candidate, inferTodoSource(candidate)))
    .filter((todo): todo is SessionTodoItem => Boolean(todo))
    .map((todo) => ({ ...todo, sessionId: todo.sessionId ?? sessionId }));
}

function collectTodoCandidates(value: unknown, out: unknown[]): void {
  if (!value || typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;

  for (const key of ["todos", "items"]) {
    const list = record[key];
    if (Array.isArray(list)) {
      out.push(...list);
    }
  }
  const { phases } = record;
  if (Array.isArray(phases)) {
    for (const phase of phases) {
      collectPhaseTodoCandidates(phase, out);
    }
  }
  if (record.item) {
    out.push(record.item);
  }
}

function collectPhaseTodoCandidates(value: unknown, out: unknown[]): void {
  if (!value || typeof value !== "object") {
    return;
  }
  const phase = value as Record<string, unknown>;
  const phaseId = typeof phase.id === "string" ? phase.id : undefined;
  const items = Array.isArray(phase.items) ? phase.items : [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record: Record<string, unknown> = { ...(item as Record<string, unknown>), ...(phaseId && { phaseId }) };
    out.push(record);
    const subtasks = Array.isArray(record.subtasks) ? record.subtasks : [];
    for (const subtask of subtasks) {
      if (!subtask || typeof subtask !== "object") {
        continue;
      }
      out.push({ ...(subtask as Record<string, unknown>), ...(phaseId && { phaseId }) });
    }
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function isTodoTool(tool: string): boolean {
  const name = tool.toLowerCase();
  return name === "todowrite" || name === "todo-write" || name.startsWith("todo-");
}

function dedupeTodos(todos: SessionTodoItem[]): SessionTodoItem[] {
  const byId = new Map<string, SessionTodoItem>();
  for (const todo of todos) {
    byId.set(todo.id, todo);
  }
  return [...byId.values()];
}

function flattenTodoTree(todos: SessionTodoItem[]): SessionTodoItem[] {
  const byId = new Map(todos.map((todo) => [todo.id, todo]));
  const children = new Map<string | undefined, SessionTodoItem[]>();
  for (const todo of todos) {
    const parentKey = todo.parentId && byId.has(todo.parentId) ? todo.parentId : undefined;
    const list = children.get(parentKey) ?? [];
    list.push(todo);
    children.set(parentKey, list);
  }

  const out: SessionTodoItem[] = [];
  const visited = new Set<string>();
  const walk = (todo: SessionTodoItem) => {
    if (visited.has(todo.id)) {
      return;
    }
    visited.add(todo.id);
    out.push(todo);
    for (const child of children.get(todo.id) ?? []) {
      walk(child);
    }
  };
  for (const root of children.get(undefined) ?? []) {
    walk(root);
  }
  for (const todo of todos) {
    if (!visited.has(todo.id)) {
      walk(todo);
    }
  }
  return out;
}

function normalizePriority(priority: unknown): SessionTodoItem["priority"] {
  return priority === "high" || priority === "medium" || priority === "low" ? priority : undefined;
}

function normalizeSource(source: unknown, fallback: SessionTodoSource): SessionTodoSource {
  return source === "goal" || source === "scan" || source === "manual" || source === "tool" ? source : fallback;
}

function inferTodoSource(candidate: unknown): SessionTodoSource {
  if (!candidate || typeof candidate !== "object") {
    return "tool";
  }
  const { source } = candidate as Record<string, unknown>;
  return normalizeSource(source, "tool");
}

function hashTodoContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 31 + content.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

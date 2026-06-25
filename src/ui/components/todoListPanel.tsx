import { checkboxIcon, todoStatusIcon } from "@/core/icons/iconDerived";
/**
 * TodoListPanel 组件
 *
 * 职责:
 *   - 提供 TODO 列表管理界面，支持查看、标记、删除 TODO 项
 *   - 支持层级结构的 TODO 展示
 *
 * 模块功能:
 *   - 显示 TODO 列表，支持父子层级缩进展示
 *   - 三种状态:pending / inProgress / completed
 *   - 支持 Space 键标记/取消标记待删除项
 *   - 支持 D 键删除标记项(需确认)
 *   - 滚动窗口显示，支持大量 TODO 项
 *
 * 使用场景:
 *   - 用户需要查看当前所有 TODO 时
 *   - 需要批量删除已完成或不需要的 TODO 时
 *   - 需要了解 TODO 完成进度时
 *
 * 边界:
 *   1. 状态图标:✓ completed / • inProgress / 空格 pending
 *   2. 最大可见项数 8 条，超出时显示滚动提示
 *   3. 标记后需按 D 确认删除，Y 确认/N 取消
 *   4. 支持层级结构展示(└─ 缩进)
 *
 * 流程:
 *   1. 加载 TODO 列表，构建扁平化层级结构
 *   2. 上下键导航，Space 标记/取消标记
 *   3. D 键触发删除确认
 *   4. Y 确认删除，N/Esc 取消
 *   5. 调用 onDelete 回调删除标记项
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";

// ─── 类型 ──────────────────────────────────────────────────

export type TodoStatus = "pending" | "inProgress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  parentId?: string;
  phaseId?: string;
}

interface FlattenedTodoItem extends TodoItem {
  depth: number;
  hasChildren: boolean;
}

// ─── 工具函数(已迁 @core/iconDerived) ─────────────────────────────

function getStatusFg(status: TodoStatus, colors: { success: string; warning: string; muted: string }): string {
  if (status === "completed") {
    return colors.success;
  }
  if (status === "inProgress") {
    return colors.warning;
  }
  return colors.muted;
}

function buildFlattenedTodos(todos: TodoItem[]): FlattenedTodoItem[] {
  const byId = new Map(todos.map((todo) => [todo.id, todo]));
  const childrenMap = new Map<string | undefined, TodoItem[]>();

  for (const todo of todos) {
    const parentKey = todo.parentId && byId.has(todo.parentId) ? todo.parentId : undefined;
    const siblings = childrenMap.get(parentKey) ?? [];
    siblings.push(todo);
    childrenMap.set(parentKey, siblings);
  }

  const flattened: FlattenedTodoItem[] = [];
  const visited = new Set<string>();

  const walk = (todo: TodoItem, depth: number) => {
    if (visited.has(todo.id)) {
      return;
    }
    visited.add(todo.id);
    const children = childrenMap.get(todo.id) ?? [];
    flattened.push({ ...todo, depth, hasChildren: children.length > 0 });
    for (const child of children) {
      walk(child, depth + 1);
    }
  };

  for (const rootTodo of childrenMap.get(undefined) ?? []) {
    walk(rootTodo, 0);
  }
  for (const todo of todos) {
    if (!visited.has(todo.id)) {
      walk(todo, 0);
    }
  }

  return flattened;
}

// ─── Props ─────────────────────────────────────────────────

export interface TodoListPanelProps {
  onClose: () => void;
  todos?: TodoItem[];
  onDelete?: (ids: string[]) => void;
}

// ─── TodoListPanel ─────────────────────────────────────────

export function TodoListPanel(props: TodoListPanelProps) {
  const theme = useTheme();

  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [markedIds, setMarkedIds] = createSignal<Set<string>>(new Set<string>());
  const [pendingDelete, setPendingDelete] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  const todos = () => props.todos || [];
  const flattened = createMemo(() => buildFlattenedTodos(todos()));
  const completedCount = createMemo(() => todos().filter((t) => t.status === "completed").length);

  const maxVisible = 8;

  const displayWindow = createMemo(() => {
    const items = flattened();
    const sel = selectedIndex();
    if (items.length <= maxVisible) {
      return { items, startIndex: 0 };
    }
    let start = Math.max(0, sel - Math.floor(maxVisible / 2));
    const end = Math.min(items.length, start + maxVisible);
    if (end - start < maxVisible) {
      start = Math.max(0, end - maxVisible);
    }
    return { items: items.slice(start, end), startIndex: start };
  });

  const hiddenAbove = () => displayWindow().startIndex;
  const hiddenBelow = () => Math.max(0, flattened().length - (displayWindow().startIndex + maxVisible));

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    if (event.name === "escape") {
      if (pendingDelete()) {
        setPendingDelete(false);
        return;
      }
      props.onClose();
      return;
    }

    if (deleting()) {
      return;
    }

    if (pendingDelete()) {
      if (event.name === "return" || event.name === "enter" || event.name === "y") {
        doDelete();
        return;
      }
      if (event.name === "n") {
        setPendingDelete(false);
        return;
      }
      return;
    }

    if (event.name === "up") {
      setSelectedIndex((i) => (i > 0 ? i - 1 : Math.max(0, flattened().length - 1)));
      return;
    }
    if (event.name === "down") {
      const max = Math.max(0, flattened().length - 1);
      setSelectedIndex((i) => (i < max ? i + 1 : 0));
      return;
    }

    if (event.name === " ") {
      const current = flattened()[selectedIndex()];
      if (current) {
        setMarkedIds((prev) => {
          const next = new Set<string>(prev);
          if (next.has(current.id)) {
            next.delete(current.id);
          } else {
            next.add(current.id);
          }
          return next;
        });
        setPendingDelete(false);
      }
      return;
    }

    if (event.name === "d") {
      if (markedIds().size > 0) {
        setPendingDelete(true);
      }
    }
  });

  async function doDelete() {
    setDeleting(true);
    try {
      props.onDelete?.([...markedIds()]);
    } finally {
      setDeleting(false);
      setMarkedIds(new Set<string>());
      setPendingDelete(false);
    }
  }

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.colors.text}>
          <b>{"TODO 列表"}</b>
          <span style={{ fg: theme.colors.muted }}>{` (${completedCount()}/${todos().length})`}</span>
        </text>
        <text fg={theme.colors.muted}>{"esc 返回"}</text>
      </box>

      {/* 空列表 */}
      <Show when={flattened().length === 0}>
        <text fg={theme.colors.muted}>{"暂无 TODO 项"}</text>
      </Show>

      {/* TODO 列表 */}
      <Show when={flattened().length > 0}>
        <box flexDirection="column">
          <For each={displayWindow().items}>
            {(todo, index) => {
              const originalIndex = () => displayWindow().startIndex + index();
              const isSelected = () => originalIndex() === selectedIndex();
              const isMarked = () => markedIds().has(todo.id);
              const indent = "  ".repeat(todo.depth);
              const branch = todo.depth > 0 ? "└─ " : "";

              return (
                <box
                  flexDirection="row"
                  gap={1}
                  backgroundColor={isSelected() ? theme.colors.primary : undefined}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={isSelected() ? theme.colors.text : theme.colors.muted} flexShrink={0}>
                    {checkboxIcon(isMarked())}
                  </text>
                  <text fg={getStatusFg(todo.status, theme.colors)} flexShrink={0}>
                    {indent + branch + todoStatusIcon(todo.status)}
                  </text>
                  <text fg={isSelected() ? theme.colors.text : theme.colors.muted} flexGrow={1} wrapMode="word">
                    {todo.content}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
      </Show>

      {/* 滚动提示 */}
      <Show when={flattened().length > maxVisible}>
        <text fg={theme.colors.muted}>
          {(hiddenAbove() > 0 ? "上方 " + hiddenAbove() + " 项" : "") +
            (hiddenAbove() > 0 && hiddenBelow() > 0 ? " · " : "") +
            (hiddenBelow() > 0 ? "下方 " + hiddenBelow() + " 项" : "")}
        </text>
      </Show>

      {/* 删除确认 */}
      <Show when={pendingDelete() && markedIds().size > 0}>
        <text fg={theme.colors.warning}>{`确认删除 ${markedIds().size} 项? (Y/n)`}</text>
      </Show>

      {/* 删除中 */}
      <Show when={deleting()}>
        <text fg={theme.colors.info}>{"删除中..."}</text>
      </Show>

      {/* 标记计数 */}
      <Show when={markedIds().size > 0}>
        <text fg={theme.colors.info}>{`已标记 ${markedIds().size} 项`}</text>
      </Show>

      <text fg={theme.colors.muted}>{"↑↓ 导航 · Space 标记 · D 删除 · Esc 返回"}</text>
    </box>
  );
}

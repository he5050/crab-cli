/**
 * DialogSelect
 *
 * 职责:
 *   - 提供通用选择弹窗功能
 *   - 支持选项列表展示和搜索过滤
 *   - 处理键盘导航和鼠标选择
 *
 * 模块功能:
 *   - DialogSelect: 通用选择弹窗(支持搜索、键盘导航)
 *   - DialogConfirm: 确认弹窗(确认/取消)
 *   - DialogAlert: 警告提示弹窗
 *   - DialogHelp: 快捷键帮助弹窗
 *   - 支持选项分组和描述展示
 *
 * 使用场景:
 *   - 需要从多个选项中选择一项时
 *   - 需要用户确认操作时
 *   - 显示警告或提示信息时
 *   - 展示快捷键帮助时
 *
 * 边界:
 *   1. 选项数据通过 props 传入，组件不管理选项状态
 *   2. 搜索过滤在组件内部完成，不触发外部请求
 *   3. 选择结果通过 onSelect 回调返回
 *   4. 使用 DialogOverlay 作为基础容器
 *
 * 流程:
 *   1. 接收选项列表和标题配置
 *   2. 渲染搜索框和选项列表
 *   3. 用户输入时实时过滤选项
 *   4. 键盘导航选择，回车确认
 *   5. 调用 onSelect 或 onClose 回调
 */
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { DialogHeader, DialogOverlay, type DialogSize } from "@/ui/components/dialogUi";
import type { KeyboardEventLike } from "@/ui/types";
import { actionSelect, iconRunning, iconSearch } from "@/ui/utils/icon";

/** 选择选项 */
export interface SelectOption<T = string> {
  title: string;
  description?: string;
  category?: string;
  value: T;
  current?: boolean;
  disabled?: boolean;
  keywords?: string[];
  marker?: string;
  meta?: string;
  preview?: string[];
  onSelect?: () => void;
}

/** DialogSelect 属性 */
interface DialogSelectProps<T = string> {
  title: string;
  options: SelectOption<T>[];
  onSelect: (option: SelectOption<T>) => void;
  onClose: () => void;
  placeholder?: string;
  footer?: string;
  emptyText?: string;
  size?: DialogSize;
  maxVisible?: number;
  onHighlight?: (option: SelectOption<T> | undefined) => void;
  onCancel?: () => void;
}

export function DialogSelect<T = string>(props: DialogSelectProps<T>) {
  const theme = useTheme();
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(
    Math.max(
      0,
      props.options.findIndex((option) => option.current),
    ),
  );

  /** 过滤后的选项 */
  const filtered = createMemo(() => {
    const q = query().toLowerCase();
    if (!q) {
      return props.options;
    }
    return props.options.filter(
      (opt) =>
        opt.title.toLowerCase().includes(q) ||
        opt.description?.toLowerCase().includes(q) ||
        opt.category?.toLowerCase().includes(q) ||
        opt.meta?.toLowerCase().includes(q) ||
        opt.keywords?.some((keyword) => keyword.toLowerCase().includes(q)),
    );
  });

  createEffect(() => {
    const items = filtered();
    if (selectedIndex() > items.length - 1) {
      setSelectedIndex(Math.max(0, items.length - 1));
    }
    props.onHighlight?.(items[selectedIndex()]);
  });

  const selectOption = (option: SelectOption<T> | undefined) => {
    if (!option || option.disabled) {
      return;
    }
    option.onSelect?.();
    props.onSelect(option);
  };

  const cancel = () => {
    props.onCancel?.();
    props.onClose();
  };

  /** 处理键盘事件 */
  function handleKeyDown(event: KeyboardEventLike) {
    const items = filtered();
    if (event.name === "up" || (event.ctrl && event.name === "p")) {
      event.stopPropagation?.();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (event.name === "down" || (event.ctrl && event.name === "n")) {
      event.stopPropagation?.();
      setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (event.name === "pageup") {
      event.stopPropagation?.();
      setSelectedIndex((i) => Math.max(0, i - (props.maxVisible ?? 14)));
    } else if (event.name === "pagedown") {
      event.stopPropagation?.();
      setSelectedIndex((i) => Math.min(items.length - 1, i + (props.maxVisible ?? 14)));
    } else if (event.name === "home") {
      event.stopPropagation?.();
      setSelectedIndex(0);
    } else if (event.name === "end") {
      event.stopPropagation?.();
      setSelectedIndex(Math.max(0, items.length - 1));
    } else if (event.name === "return" || event.name === "enter") {
      event.stopPropagation?.();
      selectOption(items[selectedIndex()]);
    } else if (event.name === "escape") {
      event.stopPropagation?.();
      cancel();
    } else if (event.name === "backspace" || event.name === "delete") {
      event.stopPropagation?.();
      setQuery((q) => q.slice(0, -1));
      setSelectedIndex(0);
    } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta && !event.alt) {
      event.stopPropagation?.();
      setQuery((q) => q + event.name);
      setSelectedIndex(0);
    }
  }

  useKeyboard(handleKeyDown);

  const viewWindow = createMemo(() => {
    const items = filtered();
    const maxVisible = props.maxVisible ?? 14;
    const selected = selectedIndex();
    if (items.length <= maxVisible) {
      return { items, start: 0 };
    }
    let start = Math.max(0, selected - Math.floor(maxVisible / 2));
    const end = Math.min(items.length, start + maxVisible);
    if (end - start < maxVisible) {
      start = Math.max(0, end - maxVisible);
    }
    return { items: items.slice(start, start + maxVisible), start };
  });
  const visible = createMemo(() => viewWindow().items);
  const previousCategory = (index: number) => visible()[index - 1]?.category;

  return (
    <DialogOverlay onClose={cancel} size={props.size ?? "medium"}>
      <DialogHeader title={props.title} />
      <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <text fg={query() ? theme.colors.text : theme.colors.muted}>
          {iconSearch} {query() || props.placeholder || "搜索..."}
        </text>
      </box>
      <box paddingLeft={1} paddingRight={1} flexDirection="column" maxHeight={props.maxVisible ?? 14}>
        <Show when={filtered().length === 0}>
          <text fg={theme.colors.muted}>{props.emptyText ?? "没有匹配的选项"}</text>
        </Show>
        <For each={visible()}>
          {(option, index) => (
            <>
              <Show when={option.category && option.category !== previousCategory(index())}>
                <text fg={theme.colors.muted}>{option.category}</text>
              </Show>
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={
                  viewWindow().start + index() === selectedIndex() ? theme.extended.bg.element : undefined
                }
                onMouseDown={() => {
                  setSelectedIndex(viewWindow().start + index());
                  selectOption(option);
                }}
              >
                <text
                  fg={
                    viewWindow().start + index() === selectedIndex()
                      ? theme.colors.primary
                      : option.current
                        ? theme.colors.success
                        : theme.colors.text
                  }
                >
                  {viewWindow().start + index() === selectedIndex()
                    ? `${actionSelect} `
                    : option.current
                      ? `${iconRunning} `
                      : "  "}
                  {option.marker ? `${option.marker} ` : ""}
                  {option.title}
                </text>
                <Show when={option.description}>
                  <text fg={theme.colors.muted}> — {option.description}</text>
                </Show>
                <Show when={option.preview?.length}>
                  <text fg={theme.colors.muted}> </text>
                  <For each={option.preview}>{(color) => <text fg={color}>■</text>}</For>
                </Show>
                <Show when={option.meta}>
                  <text fg={theme.colors.muted}> {option.meta}</text>
                </Show>
              </box>
            </>
          )}
        </For>
      </box>
      <box paddingLeft={1} paddingRight={1} paddingTop={1}>
        <text fg={theme.colors.muted}>{props.footer ?? "↑↓ 选择 · 输入搜索 · Enter 确认 · Esc 取消"}</text>
      </box>
    </DialogOverlay>
  );
}

/**
 * DialogConfirm — 确认弹窗。
 */
export function DialogConfirm(props: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  useKeyboard((event: KeyboardEventLike) => {
    if (event.name === "return" || event.name === "enter") {
      props.onConfirm();
      event.stopPropagation?.();
      return;
    }
    if (event.name === "escape") {
      props.onCancel();
      event.stopPropagation?.();
    }
  });

  return (
    <DialogOverlay onClose={props.onCancel} size="small">
      <DialogHeader title={props.title ?? "确认"} />
      <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <text>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingLeft={1} paddingRight={1} gap={2}>
        <text fg={theme.colors.muted} onMouseUp={props.onCancel}>
          {props.cancelLabel ?? "取消"}
        </text>
        <text fg={theme.colors.error} onMouseUp={props.onConfirm}>
          {props.confirmLabel ?? "确认"}
        </text>
      </box>
    </DialogOverlay>
  );
}

/**
 * DialogAlert — 警告弹窗。
 */
export function DialogAlert(props: { title?: string; message: string; onClose: () => void }) {
  const theme = useTheme();
  useKeyboard((event: KeyboardEventLike) => {
    if (event.name === "return" || event.name === "enter" || event.name === "escape") {
      props.onClose();
      event.stopPropagation?.();
    }
  });

  return (
    <DialogOverlay onClose={props.onClose} size="small">
      <DialogHeader title={props.title ?? "提示"} />
      <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <text>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingLeft={1} paddingRight={1}>
        <text fg={theme.colors.primary} onMouseUp={props.onClose}>
          确定
        </text>
      </box>
    </DialogOverlay>
  );
}

/**
 * DialogHelp — 帮助弹窗(显示快捷键列表)。
 */
export function DialogHelp(props: { shortcuts: { key: string; description: string }[]; onClose: () => void }) {
  const theme = useTheme();
  return (
    <DialogOverlay onClose={props.onClose} size="medium">
      <DialogHeader title="快捷键" />
      <box paddingLeft={1} paddingRight={1} flexDirection="column" maxHeight={20}>
        <For each={props.shortcuts}>
          {(shortcut) => (
            <box flexDirection="row">
              <text fg={theme.colors.primary}>{shortcut.key}</text>
              <text fg={theme.colors.muted}> — {shortcut.description}</text>
            </box>
          )}
        </For>
      </box>
      <box paddingLeft={1} paddingRight={1} paddingTop={1}>
        <text fg={theme.colors.muted}>按 Esc 关闭</text>
      </box>
    </DialogOverlay>
  );
}

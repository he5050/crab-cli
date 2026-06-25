/**
 * [Prompt 组件]
 *
 * 职责:
 *   - 接受用户输入(支持单行/多行)
 *   - `/` 前缀触发命令补全
 *   - Enter 提交消息 / Shift+Enter 换行
 *   - Placeholder 轮播提示展示
 *   - 提供 PromptRef 接口(focus/set/submit)
 *
 * 模块功能:
 *   - Prompt 组件:主输入框渲染与交互
 *   - Placeholder 轮播:每 5 秒自动切换提示文本
 *   - 键盘事件处理:Enter提交、Shift+Enter换行、Esc清空
 *   - PromptRef 接口:供父组件调用 focus/set/submit
 *
 * 使用场景:
 *   - TUI 聊天界面的主输入框
 *   - 需要命令补全提示的输入场景
 *   - 需要多行文本输入的场景
 *   - 需要程序化控制输入框的场景
 *
 * 边界:
 *   1. 输入框最大高度 5 行，最小高度 1 行
 *   2. Placeholder 轮播间隔固定为 5 秒
 *   3. 禁用状态下输入框不可编辑
 *   4. 依赖外部传入 onSubmit 回调处理提交
 *
 * 流程:
 *   1. 组件挂载时初始化 Placeholder 轮播定时器
 *   2. 用户输入时触发 onInput 回调通知父组件
 *   3. 用户按 Enter(非 Shift)时触发 submit() 提交
 *   4. 提交后清空输入框，等待下一次输入
 */
import { type JSX, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import type { PromptRef } from "@/ui/contexts/prompt";
import type { KeyboardEventLike } from "@/ui/types";

function DefaultHint(props: { color: string }) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={props.color}>Enter 发送</text>
      <text fg={props.color}>·</text>
      <text fg={props.color}>/ 命令</text>
    </box>
  );
}

/** Prompt 组件属性 */
export interface PromptProps {
  /** Ref 回调 */
  ref?: (ref: PromptRef | undefined) => void;
  /** Placeholder 列表(自动轮播) */
  placeholders?: string[];
  /** 是否禁用 */
  disabled?: boolean;
  /** 提交回调 */
  onSubmit?: (value: string) => void;
  /** 输入变化回调 */
  onInput?: (value: string) => void;
  /** 右侧附加内容 */
  right?: JSX.Element;
  /** 提示文字 */
  hint?: JSX.Element;
}

/** Prompt 左边框样式 */
const PromptLeftBorder = {
  bottomLeft: "╹",
  bottomRight: "",
  bottomT: "",
  cross: "",
  horizontal: " ",
  leftT: "",
  rightT: "",
  topLeft: "",
  topRight: "",
  topT: "",
  vertical: "│",
};

const EmptyBorder = {
  bottomLeft: "",
  bottomRight: "",
  bottomT: "",
  cross: "",
  horizontal: " ",
  leftT: "",
  rightT: "",
  topLeft: "",
  topRight: "",
  topT: "",
  vertical: "",
};

/** 随机选择 placeholder 索引 */
function randomIndex(count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.floor(Math.random() * count);
}

export function Prompt(props: PromptProps) {
  const theme = useTheme();
  const [value, setValue] = createSignal("");
  const [focused, setFocused] = createSignal(true);
  let inputRef: any = null;

  // Placeholder 轮播
  const placeholders = () =>
    props.placeholders ?? ["输入消息开始对话...", "试试 /help 查看可用命令", "试试 /mcp 管理 MCP 服务"];

  const [placeholderIdx, setPlaceholderIdx] = createSignal(randomIndex(placeholders().length));
  let placeholderTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    // 每 5 秒切换 placeholder
    placeholderTimer = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % placeholders().length);
    }, 5000);
  });

  onCleanup(() => {
    if (placeholderTimer) {
      clearInterval(placeholderTimer);
    }
  });

  const currentPlaceholder = createMemo(() => {
    const list = placeholders();
    return list[placeholderIdx() % list.length] ?? "输入消息...";
  });

  // PromptRef 实现
  const promptRef: PromptRef = {
    focus() {
      inputRef?.focus?.();
      setFocused(true);
    },
    set(val: string) {
      setValue(val);
      if (inputRef) {
        inputRef.value = val;
      }
    },
    submit() {
      const v = value().trim();
      if (v) {
        props.onSubmit?.(v);
        setValue("");
        if (inputRef) {
          inputRef.value = "";
        }
      }
    },
    get value() {
      return value();
    },
  };

  // 将 ref 传递给父组件
  onMount(() => {
    props.ref?.(promptRef);
  });
  onCleanup(() => {
    props.ref?.(undefined);
  });

  const borderColor = () => {
    if (props.disabled) {
      return theme.colors.muted;
    }
    return focused() ? theme.colors.primary : theme.extended.borderExt.subtle;
  };

  return (
    <box flexDirection="column" flexShrink={0}>
      <box border={["left"]} borderColor={borderColor()} customBorderChars={PromptLeftBorder}>
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexGrow={1}>
          {(() => {
            const textareaProps: any = {
              flexGrow: 1,
              focused: !props.disabled,
              maxHeight: 5,
              minHeight: 1,
              onBlur: () => setFocused(false),
              onContentChange: (val: any) => {
                const str = typeof val === "string" ? val : String(val);
                setValue(str);
                props.onInput?.(str);
              },
              onFocus: () => setFocused(true),
              onKeyDown: (event: KeyboardEventLike) => {
                if (event.name === "return" || event.name === "enter") {
                  if (event.shift) {
                    return;
                  }
                  event.stopPropagation?.();
                  promptRef.submit();
                } else if (event.name === "escape") {
                  event.stopPropagation?.();
                  setValue("");
                  if (inputRef) {
                    inputRef.value = "";
                  }
                }
              },
              placeholder: currentPlaceholder(),
              ref: (r: any) => {
                inputRef = r;
              },
              value: value(),
            };
            return <textarea {...textareaProps} />;
          })()}
        </box>
      </box>
      <box height={1} border={["left"]} borderColor={borderColor()} customBorderChars={EmptyBorder}>
        <box flexDirection="row" justifyContent="space-between" paddingLeft={2} flexGrow={1}>
          <box flexDirection="row">
            <Show when={props.hint} fallback={<DefaultHint color={theme.colors.muted} />}>
              {props.hint}
            </Show>
          </box>
          <Show when={props.right}>
            <box flexDirection="row">{props.right}</box>
          </Show>
        </box>
      </box>
    </box>
  );
}

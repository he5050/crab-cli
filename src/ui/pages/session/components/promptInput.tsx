/**
 * Prompt 输入框组件 — Prompt 输入和状态显示
 *
 * 职责:
 *   - 封装输入框的渲染和交互逻辑
 *   - 提供 Prompt 触发器检测功能
 *   - 显示输入状态和快捷键提示
 *   - 集成 Extmarks 虚拟文本系统(chip 标签 + 提交展开)
 *
 * 模块功能:
 *   - PromptInput: 主输入框组件
 *   - EmptyBorder: 空边框配置
 *   - PromptLeftBorder: 带左侧竖线的边框配置
 *   - ExtmarkChip: extmark 标签组件
 *
 * 使用场景:
 *   - 用户输入 Prompt 指令
 *   - 触发自动补全功能
 *   - 提交消息到 AI 处理
 *   - 显示 @文件/#Agent 引用和粘贴内容标签
 *
 * 边界:
 * 1. 纯展示组件，接收回调函数
 * 2. 不处理实际的提交逻辑
 * 3. 触发器检测委托给 promptParts 模块
 * 4. extmarks 状态由父组件管理，本组件仅展示和展开
 *
 * 流程:
 * 1. 用户输入文本
 * 2. 触发器检测(detectPromptTrigger)
 * 3. 调用 onTrigger 回调
 * 4. 用户按 Enter 提交
 * 5. 调用 expandExtmarks 展开虚拟文本
 * 6. 调用 onSubmit 回调(传入展开后的文本)
 */
import { type JSX, For, Show, createMemo, createSignal } from "solid-js";
import { FeedbackLine } from "@/ui/components/statusFeedback";
import type { ThemeColors } from "@/ui/contexts/theme";
import {
  CURSOR_ACTIVE,
  SCROLLBAR_FOREGROUND,
  SURFACE_INPUT,
  SURFACE_PANEL,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/ui/themes/sessionTokens";
import { type PromptTrigger, detectPromptTrigger } from "@/ui/pages/session/components/promptParts";
import {
  type Extmark,
  type ExtmarkStyle,
  expandExtmarks,
  removeExtmark,
} from "@/ui/pages/session/components/promptExtmarks";
import type { KeyboardEventLike } from "@/ui/types";

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

const PromptLeftBorder = {
  ...EmptyBorder,
  bottomLeft: "╹",
  vertical: "│",
};

/** Extmark 样式对应的颜色 */
function extmarkStyleColor(style: ExtmarkStyle, colors: ThemeColors): string {
  switch (style) {
    case "file":
      return colors.primary;
    case "agent":
      return colors.success ?? colors.primary;
    case "skill":
      return colors.warning ?? colors.primary;
    case "paste":
      return colors.muted;
    case "url":
      return colors.info ?? colors.primary;
    default:
      return colors.primary;
  }
}

/** Extmark 样式对应的前缀图标 */
function extmarkStyleIcon(style: ExtmarkStyle): string {
  switch (style) {
    case "file":
      return "📄";
    case "agent":
      return "🤖";
    case "skill":
      return "⚡";
    case "paste":
      return "📋";
    case "url":
      return "🔗";
    default:
      return "•";
  }
}

/** Extmark 标签组件 */
function ExtmarkChip(props: { extmark: Extmark; colors: ThemeColors; onRemove: (id: string) => void }) {
  const color = () => extmarkStyleColor(props.extmark.style, props.colors);
  const icon = () => extmarkStyleIcon(props.extmark.style);

  return (
    <box flexDirection="row" gap={0}>
      <text fg={color()} wrapMode="none">
        {icon()} {props.extmark.virtualText}
      </text>
      <text fg={props.colors.muted}> ✕</text>
    </box>
  );
}

export function PromptInput(props: {
  value: string;
  onInput: (val: string) => void;
  onSubmit: (val: string) => void;
  onTrigger?: (trigger: PromptTrigger, value: string) => void;
  onKeyDown?: (event: KeyboardEventLike) => boolean | void;
  onFocus?: () => void;
  onBlur?: () => void;
  loading: boolean;
  placeholder: string;
  colors: ThemeColors;
  ref: any;
  disabled?: boolean;
  meta?: string;
  rightHint?: string;
  right?: JSX.Element;
  /** Extmark 列表(由父组件管理) */
  extmarks?: Extmark[];
  /** 移除 extmark 回调 */
  onRemoveExtmark?: (id: string) => void;
}) {
  const [focused, setFocused] = createSignal(true);
  const borderColor = () =>
    props.loading ? SCROLLBAR_FOREGROUND : focused() ? props.colors.primary : props.colors.border;
  const inputBackground = () => SURFACE_INPUT;
  const footerBackground = () => SURFACE_PANEL;
  const sessionTextColor = () => TEXT_PRIMARY;
  const sessionMutedColor = () => TEXT_MUTED;
  let textareaRef: any = null;

  const extmarks = createMemo(() => props.extmarks ?? []);

  /** 检测是否为 Shell 模式(以 ! 开头) */
  const isShellMode = createMemo(() => {
    const val = props.value;
    return val.startsWith("!") && val.trim().length > 1;
  });

  const setInputRef = (ref: any) => {
    textareaRef = ref;
    if (typeof props.ref === "function") {
      props.ref(ref);
    }
  };

  const currentValue = () => {
    const refValue = textareaRef?.value;
    return typeof refValue === "string" ? refValue : props.value;
  };

  const submit = () => {
    const rawValue = currentValue();
    const expanded = expandExtmarks(rawValue, extmarks());
    props.onSubmit(expanded);
  };

  const updateValue = (val: unknown) => {
    const next = typeof val === "string" ? val : String(val ?? "");
    props.onInput(next);
    const trigger = detectPromptTrigger(next);
    if (trigger) {
      props.onTrigger?.(trigger, next);
    }
  };

  const handleRemoveExtmark = (id: string) => {
    props.onRemoveExtmark?.(id);
  };

  return (
    <box flexDirection="column" flexShrink={0}>
      {/* Extmark 标签列表 */}
      <Show when={extmarks().length > 0}>
        <box
          flexDirection="row"
          flexWrap="wrap"
          gap={1}
          paddingLeft={2}
          paddingRight={2}
          paddingBottom={0}
          paddingTop={0}
        >
          <For each={extmarks()}>
            {(extmark) => <ExtmarkChip extmark={extmark} colors={props.colors} onRemove={handleRemoveExtmark} />}
          </For>
        </box>
      </Show>

      <box
        border={["left"]}
        borderColor={borderColor()}
        customBorderChars={PromptLeftBorder}
        backgroundColor={inputBackground()}
      >
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexGrow={1}
          backgroundColor={inputBackground()}
        >
          {(() => {
            const textareaProps: any = {
              cursorColor: CURSOR_ACTIVE,
              flexGrow: 1,
              focused: !props.disabled && !props.loading,
              focusedTextColor: TEXT_PRIMARY,
              maxHeight: 5,
              minHeight: 1,
              onBlur: () => {
                setFocused(false);
                props.onBlur?.();
              },
              onContentChange: updateValue,
              onFocus: () => {
                setFocused(true);
                props.onFocus?.();
              },
              onKeyDown: (event: KeyboardEventLike) => {
                const handled = props.onKeyDown?.(event);
                if (handled) {
                  return;
                }
                if (event.name !== "return" && event.name !== "enter") {
                  return;
                }
                if (event.shift || event.ctrl || event.alt || event.meta) {
                  return;
                }
                event.stopPropagation?.();
                submit();
              },
              placeholder: props.loading ? "加载中..." : props.placeholder,
              ref: setInputRef,
              textColor: TEXT_PRIMARY,
              value: props.value,
            };
            return <textarea {...textareaProps} />;
          })()}
        </box>
      </box>
      <box
        height={1}
        border={["left"]}
        borderColor={borderColor()}
        customBorderChars={EmptyBorder}
        backgroundColor={footerBackground()}
      >
        <box
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={2}
          flexGrow={1}
          backgroundColor={footerBackground()}
        >
          <Show when={props.loading}>
            <box flexDirection="row" gap={1}>
              <FeedbackLine tone="loading" message="正在生成..." />
            </box>
          </Show>
          <Show when={!props.loading}>
            <Show when={isShellMode()}>
              <box flexDirection="row" gap={1}>
                <text fg={props.colors.warning}>SHELL MODE</text>
                <text fg={sessionMutedColor()}>· Enter 执行命令 · Esc 清除</text>
              </box>
            </Show>
            <Show when={!isShellMode()}>
              <text fg={sessionMutedColor()}>
                <span style={{ fg: props.colors.primary }}>构建</span>
                <span style={{ fg: sessionMutedColor() }}>
                  {" "}
                  · {props.meta ?? "代理 · 对话 · 模型"} · Enter 发送 · Shift/Ctrl/Alt+Enter 换行 · ↑↓ 历史 · / 命令 · @
                  上下文
                </span>
              </text>
            </Show>
          </Show>
          <Show
            when={props.right}
            fallback={
              <text fg={sessionMutedColor()}>
                <span style={{ fg: sessionTextColor() }}>{props.rightHint ?? "esc"} </span>
                <span style={{ fg: sessionMutedColor() }}>{props.rightHint ? "" : "中断"}</span>
              </text>
            }
          >
            <box flexDirection="row">{props.right}</box>
          </Show>
        </box>
      </box>
    </box>
  );
}

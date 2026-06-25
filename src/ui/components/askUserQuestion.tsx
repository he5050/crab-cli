/**
 * AskUserQuestion
 *
 * 职责:
 *   - 提供多选项问题、自由输入、多选等用户交互功能
 *   - 处理键盘导航和选择逻辑
 *   - 支持选项高亮和描述展示
 *
 * 模块功能:
 *   - 渲染问题文本和选项列表
 *   - 支持单选/多选模式切换
 *   - 支持自由输入模式
 *   - 键盘导航(上下箭头、空格、回车)
 *
 * 使用场景:
 *   - 需要用户从多个选项中选择时
 *   - 需要用户输入自定义文本时
 *   - 需要多选确认时
 *
 * 边界:
 *   1. 选项数据通过 props 传入，组件不管理选项状态
 *   2. 选择结果通过 onAnswer 回调返回
 *   3. 不依赖 i18n，使用硬编码中文
 *
 * 流程:
 *   1. 渲染问题和选项列表
 *   2. 监听键盘事件处理导航和选择
 *   3. 根据模式(单选/多选/输入)处理用户输入
 *   4. 调用 onAnswer 或 onCancel 回调
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { resolveEscape } from "../escBehavior";
import { actionHint } from "@/ui/utils/icon";

// ─── 类型 ──────────────────────────────────────────────────

export interface QuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface AskUserQuestionProps {
  question: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  allowFreeInput?: boolean;
  placeholder?: string;
  onAnswer: (answer: string | string[]) => void;
  onCancel?: () => void;
}

// ─── AskUserQuestion ───────────────────────────────────────

export function AskUserQuestion(props: AskUserQuestionProps) {
  const theme = useTheme();

  const [focusIndex, setFocusIndex] = createSignal(0);
  const [selectedIndices, setSelectedIndices] = createSignal<Set<number>>(new Set<number>());
  const [inputMode, setInputMode] = createSignal(false);
  const [inputValue, setInputValue] = createSignal("");

  const hasOptions = createMemo(() => (props.options?.length ?? 0) > 0);
  const optionList = () => props.options || [];

  const displayOptions = createMemo(() => {
    const items = [...optionList()];
    if (props.allowFreeInput) {
      items.push({ label: "✏ 自由输入...", value: "__free_input__" });
    }
    return items;
  });

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    // 自由输入模式
    if (inputMode()) {
      if (event.name === "escape") {
        const a = resolveEscape({ lastInputMode: "askFreeInput" });
        if (a.kind === "popInputMode") {
          setInputMode(false);
          setInputValue("");
        }
      } else if (event.name === "return" || event.name === "enter") {
        const val = inputValue().trim();
        if (val) {
          props.onAnswer(val);
        }
      } else if (event.name === "backspace") {
        setInputValue((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setInputValue((v) => v + event.name);
      }
      return;
    }

    if (event.name === "escape") {
      const a = resolveEscape({ openDialog: true });
      if (a.kind === "closeTopDialog") {
        props.onCancel?.();
        return;
      }
    }

    if (event.name === "up") {
      setFocusIndex((i) => (i > 0 ? i - 1 : displayOptions().length - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => (i < displayOptions().length - 1 ? i + 1 : 0));
      return;
    }

    // 空格多选
    if (event.name === " " && props.multiSelect && hasOptions()) {
      const idx = focusIndex();
      const opt = displayOptions()[idx];
      if (opt?.value === "__free_input__") {
        setInputMode(true);
        return;
      }
      setSelectedIndices((prev) => {
        const next = new Set<number>(prev);
        if (next.has(idx)) {
          next.delete(idx);
        } else {
          next.add(idx);
        }
        return next;
      });
      return;
    }

    // Enter
    if (event.name === "return" || event.name === "enter") {
      if (!hasOptions() && !props.allowFreeInput) {
        return;
      }

      if (props.multiSelect) {
        const values = [...selectedIndices()]
          .map((i) => displayOptions()[i]?.value)
          .filter((v): v is string => Boolean(v) && v !== "__free_input__");
        props.onAnswer(values);
      } else {
        const opt = displayOptions()[focusIndex()];
        if (!opt) {
          return;
        }
        if (opt.value === "__free_input__") {
          setInputMode(true);
          return;
        }
        props.onAnswer(opt.value);
      }
    }
  });

  // ─── 渲染 ────────────────────────────────────────────

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 问题 */}
      <text fg={theme.colors.accent}>{`${actionHint} ${props.question}`}</text>

      {/* 自由输入 */}
      <Show when={inputMode()}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.info}>{"请输入:"}</text>
          <text fg={theme.colors.accent}>{`❯ ${inputValue()}_`}</text>
          <text fg={theme.colors.muted}>{"Enter 确认 · Esc 取消"}</text>
        </box>
      </Show>

      {/* 无选项自由输入 */}
      <Show when={!hasOptions() && props.allowFreeInput && !inputMode()}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.info}>{props.placeholder || "请输入回复:"}</text>
          <text fg={theme.colors.accent}>{`❯ ${inputValue()}_`}</text>
        </box>
      </Show>

      {/* 选项列表 */}
      <Show when={hasOptions() && !inputMode()}>
        <box flexDirection="column">
          <For each={displayOptions()}>
            {(option, index) => {
              const isSelected = () => index() === focusIndex();
              const isMultiSelected = () => selectedIndices().has(index());
              const prefix = props.multiSelect ? (isMultiSelected() ? "[✓] " : "[ ] ") : isSelected() ? "❯ " : "  ";

              return (
                <box
                  flexDirection="column"
                  backgroundColor={isSelected() ? theme.colors.primary : undefined}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={isSelected() ? theme.colors.text : theme.colors.muted}>{prefix + option.label}</text>
                  <Show when={option.description && isSelected()}>
                    <text fg={theme.colors.muted}>{`  ${option.description}`}</text>
                  </Show>
                </box>
              );
            }}
          </For>
        </box>

        <text fg={theme.colors.muted}>
          {props.multiSelect ? "↑↓ 导航 · Space 切换 · Enter 确认 · Esc 取消" : "↑↓ 导航 · Enter 选择 · Esc 取消"}
        </text>
      </Show>
    </box>
  );
}

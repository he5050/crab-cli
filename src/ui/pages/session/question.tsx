/**
 * 问题确认组件
 *
 * 职责:
 *   - 在 Session 内部渲染用户问题交互界面
 *   - 支持单选/多选模式
 *   - 处理用户选择和自定义输入
 *
 * 模块功能:
 *   - 渲染问题标题和选项列表
 *   - 支持单选(直接确认)和多选(切换选择)
 *   - 键盘导航(上下选择、Enter 确认、Esc 取消)
 *   - 显示选项描述信息
 *
 * 使用场景:
 *   - AI 需要向用户提问时(如 ask-user 工具)
 *   - 需要用户从多个选项中选择时
 *
 * 边界:
 *   1. 纯交互组件，不存储选择状态
 *   2. 选择结果通过 onAnswer 回调传递
 *   3. 支持取消操作(onDismiss)
 *
 * 流程:
 *   1. 接收问题和选项配置
 *   2. 渲染选项列表并处理键盘导航
 *   3. 用户确认后通过回调返回选择结果
 */
import { createStore } from "solid-js/store";
import { createEffect, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";

export interface QuestionOption {
  label: string;
  description?: string;
  value: string;
}

export interface QuestionStep {
  id?: string;
  title: string;
  question: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  defaultValue?: string;
  allowFreeInput?: boolean;
  placeholder?: string;
}

export interface QuestionPromptProps {
  request?: () => {
    question: string;
    options: QuestionOption[];
    multiSelect?: boolean;
    defaultValue?: string;
    allowFreeInput?: boolean;
    placeholder?: string;
    steps?: QuestionStep[];
  } | null;
  active?: boolean;
  question?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  defaultValue?: string;
  allowFreeInput?: boolean;
  placeholder?: string;
  steps?: QuestionStep[];
  onAnswer: (answer: string | string[]) => void;
  onDismiss: () => void;
}

export const QUESTION_OPTION_SLOTS = Array.from({ length: 12 }, (_, idx) => idx);
export const QUESTION_STEP_SLOTS = Array.from({ length: 6 }, (_, idx) => idx);

export type QuestionPromptAction = "move_up" | "move_down" | "dismiss" | "toggle" | "confirm" | "free_input";

export function resolveQuestionPromptAction(
  event: { name?: string },
  multiSelect = false,
): QuestionPromptAction | null {
  switch (event.name) {
    case "up": {
      return "move_up";
    }
    case "down": {
      return "move_down";
    }
    case "escape": {
      return "dismiss";
    }
    case "space": {
      return multiSelect ? "toggle" : null;
    }
    case "tab": {
      return "free_input";
    }
    case "return":
    case "enter": {
      return "confirm";
    }
    default: {
      return null;
    }
  }
}

export { QuestionPromptEventBridge } from "./questionEventBridge";

export function QuestionPrompt(props: QuestionPromptProps) {
  const theme = useTheme();
  const [store, setStore] = createStore({
    answers: [] as string[],
    selected: 0,
  });
  const [stepIndex, setStepIndex] = createSignal(0);
  const [inputMode, setInputMode] = createSignal(false);
  const [inputValue, setInputValue] = createSignal("");
  const [stepAnswers, setStepAnswers] = createSignal<Record<string, string | string[]>>({});

  const request = () => props.request?.() ?? null;
  const steps = () => {
    const req = request();
    const configured = req?.steps ?? props.steps;
    if (configured?.length) {
      return configured;
    }
    return [
      {
        allowFreeInput: req?.allowFreeInput ?? props.allowFreeInput,
        defaultValue: req?.defaultValue ?? props.defaultValue,
        multiSelect: req?.multiSelect ?? props.multiSelect ?? false,
        options: req?.options ?? props.options ?? [],
        placeholder: req?.placeholder ?? props.placeholder,
        question: req?.question ?? props.question ?? "",
        title: "确认",
      },
    ];
  };
  const currentStep = () => steps()[stepIndex()] ?? steps()[0]!;
  const question = () => currentStep().question;
  const options = () => currentStep().options ?? [];
  const active = () => (props.request ? Boolean(request()) : (props.active ?? true));
  const multi = () => currentStep().multiSelect ?? false;
  const allowFreeInput = () => currentStep().allowFreeInput ?? false;
  const stepKey = () => currentStep().id ?? currentStep().title ?? String(stepIndex());
  const optionCount = () => Math.min(QUESTION_OPTION_SLOTS.length, options().length + (allowFreeInput() ? 1 : 0));

  createEffect(() => {
    if (!active()) {
      return;
    }
    void question();
    void options().length;
    void stepIndex();
    setStore("selected", 0);
    setStore("answers", []);
    setInputMode(false);
    setInputValue(currentStep().defaultValue ?? "");
  });

  function completeCurrent(value: string | string[]) {
    const allSteps = steps();
    if (allSteps.length <= 1) {
      props.onAnswer(value);
      return;
    }

    const key = stepKey();
    const nextAnswers = { ...stepAnswers(), [key]: value };
    setStepAnswers(nextAnswers);
    if (stepIndex() < allSteps.length - 1) {
      setStepIndex((idx) => idx + 1);
      return;
    }
    props.onAnswer(JSON.stringify(nextAnswers));
  }

  function pick(value: string) {
    if (!active()) {
      return;
    }
    if (multi()) {
      const next = [...store.answers];
      const idx = next.indexOf(value);
      if (idx !== -1) {
        next.splice(idx, 1);
      } else {
        next.push(value);
      }
      setStore("answers", next);
    } else {
      setStore("answers", [value]);
      completeCurrent(value);
    }
  }

  function selectCurrent() {
    if (allowFreeInput() && store.selected >= options().length) {
      setInputMode(true);
      return;
    }
    const opt = options()[store.selected];
    if (opt) {
      pick(opt.value);
    }
  }

  const isSelected = (idx: number) => idx === store.selected;
  const isPicked = (value: string) => store.answers.includes(value);

  useKeyboard((event) => {
    if (!active()) {
      return;
    }
    if (inputMode()) {
      if (event.name === "escape") {
        setInputMode(false);
        event.stopPropagation?.();
        return;
      }
      if (event.name === "backspace") {
        setInputValue((value) => value.slice(0, -1));
        event.stopPropagation?.();
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        const answer = inputValue().trim();
        if (answer) {
          completeCurrent(answer);
        }
        event.stopPropagation?.();
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setInputValue((value) => value + event.name);
        event.stopPropagation?.();
      }
      return;
    }

    const action = resolveQuestionPromptAction(event, multi());
    switch (action) {
      case "move_up": {
        setStore("selected", (current) => (current > 0 ? current - 1 : Math.max(0, optionCount() - 1)));
        event.stopPropagation?.();
        return;
      }
      case "move_down": {
        setStore("selected", (current) => (current < optionCount() - 1 ? current + 1 : 0));
        event.stopPropagation?.();
        return;
      }
      case "dismiss": {
        props.onDismiss();
        event.stopPropagation?.();
        return;
      }
      case "toggle": {
        selectCurrent();
        event.stopPropagation?.();
        return;
      }
      case "free_input": {
        if (allowFreeInput()) {
          setInputMode(true);
          event.stopPropagation?.();
        }
        return;
      }
      case "confirm": {
        if (allowFreeInput() && store.selected >= options().length) {
          setInputMode(true);
          event.stopPropagation?.();
          return;
        }
        if (multi()) {
          if (store.answers.length === 0) {
            selectCurrent();
          }
          completeCurrent(store.answers.length > 0 ? [...store.answers] : []);
        } else {
          selectCurrent();
        }
        event.stopPropagation?.();
        return;
      }
      default: {
        return;
      }
    }
  });

  return (
    <box
      visible={active()}
      backgroundColor={theme.extended.bg.panel}
      border={["left"]}
      borderColor={theme.colors.accent}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="column" gap={1}>
        {/* 多阶段 Tab */}
        <box flexDirection="row" gap={2} paddingLeft={1} visible={steps().length > 1}>
          {QUESTION_STEP_SLOTS.map((idx) => {
            const step = () => steps()[idx];
            const current = () => idx === stepIndex();
            const answered = () => {
              const item = step();
              if (!item) {
                return false;
              }
              return Object.hasOwn(stepAnswers(), item.id ?? item.title ?? String(idx));
            };
            return (
              <text
                visible={Boolean(step())}
                fg={current() ? theme.colors.text : answered() ? theme.colors.success : theme.colors.muted}
                bg={current() ? theme.colors.primary : undefined}
              >
                {step()?.title ?? ""}
              </text>
            );
          })}
        </box>

        {/* 问题 */}
        <box paddingLeft={1}>
          <text fg={theme.colors.text}>
            {question()}
            {multi() ? " (可多选)" : ""}
          </text>
        </box>

        {/* 选项列表 */}
        <box paddingLeft={1} gap={1}>
          {QUESTION_OPTION_SLOTS.map((idx) => {
            const opt = () =>
              options()[idx] ??
              (allowFreeInput() && idx === options().length
                ? { label: "输入自定义回答", value: "__free_input__" }
                : undefined);
            const rowVisible = () => Boolean(opt());
            const activeRow = () => isSelected(idx);
            const picked = () => {
              const current = opt();
              return current ? isPicked(current.value) : false;
            };
            return (
              <box
                visible={rowVisible()}
                onMouseOver={() => {
                  if (opt()) {
                    setStore("selected", idx);
                  }
                }}
                onMouseUp={() => {
                  const current = opt();
                  if (!current) {
                    return;
                  }
                  setStore("selected", idx);
                  if (current.value === "__free_input__") {
                    setInputMode(true);
                  } else {
                    selectCurrent();
                  }
                }}
              >
                <box flexDirection="row">
                  <box backgroundColor={activeRow() ? theme.extended.bg.element : undefined} paddingRight={1}>
                    <text fg={activeRow() ? theme.colors.primary : theme.colors.muted}>
                      {rowVisible() ? `${idx + 1}.` : ""}
                    </text>
                  </box>
                  <box backgroundColor={activeRow() ? theme.extended.bg.element : undefined}>
                    <text fg={activeRow() ? theme.colors.primary : picked() ? theme.colors.success : theme.colors.text}>
                      {rowVisible()
                        ? multi()
                          ? `[${picked() ? asciiCheck : " "}] ${opt()!.label}`
                          : opt()!.label
                        : ""}
                    </text>
                  </box>
                  <text fg={theme.colors.success}>{!multi() && picked() ? " ✓" : ""}</text>
                </box>
                <box paddingLeft={3} visible={Boolean(opt()?.description)}>
                  <text fg={theme.colors.muted}>{opt()?.description ?? ""}</text>
                </box>
              </box>
            );
          })}
        </box>

        <box flexDirection="column" paddingLeft={1} visible={inputMode()}>
          <text fg={theme.colors.muted}>{currentStep().placeholder ?? "输入自定义回答"}</text>
          <text fg={theme.colors.primary}>{`${inputValue()}_`}</text>
        </box>

        {/* 提示 */}
        <box flexDirection="row" gap={2} paddingLeft={1}>
          <box flexDirection="row">
            <text fg={theme.colors.text}>↑↓ </text>
            <text fg={theme.colors.muted}>选择</text>
          </box>
          <box flexDirection="row">
            <text fg={theme.colors.text}>enter </text>
            <text fg={theme.colors.muted}>确认</text>
          </box>
          <box flexDirection="row" visible={multi()}>
            <text fg={theme.colors.text}>space </text>
            <text fg={theme.colors.muted}>切换</text>
          </box>
          <box flexDirection="row" visible={allowFreeInput()}>
            <text fg={theme.colors.text}>tab </text>
            <text fg={theme.colors.muted}>自定义</text>
          </box>
          <box flexDirection="row">
            <text fg={theme.colors.text}>esc </text>
            <text fg={theme.colors.muted}>取消</text>
          </box>
        </box>
      </box>
    </box>
  );
}

import { asciiCheck } from "@/core/icons/icon";

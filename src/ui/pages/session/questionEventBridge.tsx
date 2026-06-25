/**
 * 问题事件桥 — 监听 QuestionPrompt 事件，挂载 overlay 并响应键盘。
 *
 * 职责:
 *   - 桥接 AppEvent.QuestionPrompt* 到 QuestionPrompt 组件
 *   - 提供最大/最小化切换的键盘监听
 */
import { onCleanup } from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { useTheme } from "@/ui/contexts/theme";
import {
  QUESTION_OPTION_SLOTS,
  QUESTION_STEP_SLOTS,
  type QuestionOption,
  type QuestionPromptProps,
  resolveQuestionPromptAction,
} from "@/ui/pages/session/question";

import type { MutableBoxRenderable, MutableTextRenderable } from "@/ui/types/renderable";

export function QuestionPromptEventBridge() {
  const eventBus = useEventBus();
  const theme = useTheme();
  const renderer = useRenderer();
  let currentRequest:
    | (NonNullable<ReturnType<NonNullable<QuestionPromptProps["request"]>>> & { requestId: string })
    | null = null;
  let stepIndex = 0;
  let selected = 0;
  let inputMode = false;
  let inputValue = "";
  let selectedValues = new Set<string>();
  let stepAnswers: Record<string, string | string[]> = {};
  let pendingSync: Timer | undefined;

  let rootBox: MutableBoxRenderable | undefined;
  let stepTabs: MutableBoxRenderable | undefined;
  let questionText: MutableTextRenderable | undefined;
  const stepTexts: MutableTextRenderable[] = [];
  const optionRows: MutableBoxRenderable[] = [];
  const indexBoxes: MutableBoxRenderable[] = [];
  const indexTexts: MutableTextRenderable[] = [];
  const labelBoxes: MutableBoxRenderable[] = [];
  const labelTexts: MutableTextRenderable[] = [];
  const pickedTexts: MutableTextRenderable[] = [];
  const descBoxes: MutableBoxRenderable[] = [];
  const descTexts: MutableTextRenderable[] = [];
  let disposed = false;

  // 该桥接组件服务于 OpenTUI imperative renderable；事件来自全局总线，
  // 因此需要缓存 renderable 引用并手动同步可见状态与文本内容。
  const detachRenderableRefs = () => {
    rootBox = undefined;
    stepTabs = undefined;
    questionText = undefined;
    stepTexts.length = 0;
    optionRows.length = 0;
    indexBoxes.length = 0;
    indexTexts.length = 0;
    labelBoxes.length = 0;
    labelTexts.length = 0;
    pickedTexts.length = 0;
    descBoxes.length = 0;
    descTexts.length = 0;
  };

  const isDestroyedRenderableError = (error: unknown) =>
    error instanceof Error && error.message.includes("TextBuffer is destroyed");

  const steps = () => {
    if (!currentRequest) {
      return [];
    }
    if (currentRequest.steps?.length) {
      return currentRequest.steps;
    }
    return [
      {
        allowFreeInput: currentRequest.allowFreeInput,
        defaultValue: currentRequest.defaultValue,
        multiSelect: currentRequest.multiSelect,
        options: currentRequest.options,
        placeholder: currentRequest.placeholder,
        question: currentRequest.question,
        title: "确认",
      },
    ];
  };
  const currentStep = () => steps()[stepIndex] ?? steps()[0];
  const options = () => currentStep()?.options ?? [];
  const multi = () => currentStep()?.multiSelect ?? false;
  const allowFreeInput = () => currentStep()?.allowFreeInput ?? false;
  const optionCount = () => Math.min(QUESTION_OPTION_SLOTS.length, options().length + (allowFreeInput() ? 1 : 0));
  const stepKey = () => currentStep()?.id ?? currentStep()?.title ?? String(stepIndex);

  const optionAt = (idx: number): QuestionOption | undefined => {
    const configured = options()[idx];
    if (configured) {
      return configured;
    }
    if (allowFreeInput() && idx === options().length) {
      return {
        label: inputMode ? `自定义回答: ${inputValue}` : "输入自定义回答",
        value: "__free_input__",
      };
    }
    return undefined;
  };

  const scheduleSync = () => {
    if (disposed) {
      return;
    }
    if (pendingSync) {
      return;
    }
    pendingSync = setTimeout(() => {
      pendingSync = undefined;
      if (disposed) {
        return;
      }
      syncView();
    }, 0);
  };

  const resetInteraction = () => {
    stepIndex = 0;
    selected = 0;
    inputMode = false;
    inputValue = currentStep()?.defaultValue ?? "";
    selectedValues = new Set<string>();
    stepAnswers = {};
  };

  const setActiveRequest = (request: typeof currentRequest) => {
    currentRequest = request;
    resetInteraction();
    scheduleSync();
  };

  const clearActiveRequest = () => {
    currentRequest = null;
    resetInteraction();
    scheduleSync();
  };

  const publishAnswer = (answer: string | string[]) => {
    if (!currentRequest) {
      return;
    }
    eventBus.publish(AppEvent.UserInput, {
      answer: Array.isArray(answer) ? JSON.stringify(answer) : answer,
      requestId: currentRequest.requestId,
    });
    clearActiveRequest();
  };

  const publishCancel = () => {
    if (!currentRequest) {
      return;
    }
    eventBus.publish(AppEvent.UserInput, {
      cancelled: true,
      requestId: currentRequest.requestId,
    });
    clearActiveRequest();
  };

  const completeCurrent = (value: string | string[]) => {
    const allSteps = steps();
    if (allSteps.length <= 1) {
      publishAnswer(value);
      return;
    }
    const key = stepKey();
    const nextAnswers = { ...stepAnswers, [key]: value };
    stepAnswers = nextAnswers;
    if (stepIndex < allSteps.length - 1) {
      stepIndex += 1;
      selected = 0;
      inputMode = false;
      inputValue = currentStep()?.defaultValue ?? "";
      selectedValues = new Set<string>();
      syncView();
      return;
    }
    publishAnswer(JSON.stringify(nextAnswers));
  };

  const selectOption = (idx: number) => {
    if (!currentRequest) {
      return;
    }
    const opt = optionAt(idx);
    if (!opt) {
      return;
    }
    selected = idx;
    if (opt.value === "__free_input__") {
      inputMode = true;
      syncView();
      return;
    }
    if (multi()) {
      if (selectedValues.has(opt.value)) {
        selectedValues.delete(opt.value);
      } else {
        selectedValues.add(opt.value);
      }
      syncView();
      return;
    }
    selectedValues = new Set([opt.value]);
    syncView();
    completeCurrent(opt.value);
  };

  const confirmCurrent = () => {
    if (allowFreeInput() && selected >= options().length) {
      inputMode = true;
      syncView();
      return;
    }
    if (multi()) {
      if (selectedValues.size === 0) {
        selectOption(selected);
      }
      completeCurrent([...selectedValues]);
      return;
    }
    selectOption(selected);
  };

  const syncView = () => {
    if (disposed) {
      return;
    }
    try {
      const active = Boolean(currentRequest);
      if (rootBox) {
        rootBox.visible = active;
      }
      if (!active) {
        renderer.requestRender();
        return;
      }

      const allSteps = steps();
      if (stepTabs) {
        stepTabs.visible = allSteps.length > 1;
      }
      for (const idx of QUESTION_STEP_SLOTS) {
        const text = stepTexts[idx];
        if (!text) {
          continue;
        }
        const step = allSteps[idx];
        text.visible = Boolean(step);
        text.content = step?.title ?? "";
        const answered = step ? Object.hasOwn(stepAnswers, step.id ?? step.title ?? String(idx)) : false;
        text.fg = idx === stepIndex ? theme.colors.text : answered ? theme.colors.success : theme.colors.muted;
        text.bg = idx === stepIndex ? theme.colors.primary : undefined;
      }

      if (questionText) {
        const suffix = multi() ? " (可多选)" : "";
        questionText.content = `${currentStep()?.question ?? ""}${suffix}`;
      }

      for (const idx of QUESTION_OPTION_SLOTS) {
        const opt = optionAt(idx);
        const row = optionRows[idx];
        const indexBox = indexBoxes[idx];
        const indexText = indexTexts[idx];
        const labelBox = labelBoxes[idx];
        const labelText = labelTexts[idx];
        const pickedText = pickedTexts[idx];
        const descBox = descBoxes[idx];
        const descText = descTexts[idx];
        const visible = Boolean(opt);
        const activeRow = selected === idx;
        const isPicked = opt ? selectedValues.has(opt.value) : false;

        if (row) {
          row.visible = visible;
        }
        if (indexBox) {
          indexBox.backgroundColor = activeRow ? theme.extended.bg.element : undefined;
        }
        if (labelBox) {
          labelBox.backgroundColor = activeRow ? theme.extended.bg.element : undefined;
        }
        if (indexText) {
          indexText.content = visible ? `${idx + 1}.` : "";
          indexText.fg = activeRow ? theme.colors.primary : theme.colors.muted;
        }
        if (labelText) {
          labelText.content = visible ? (multi() ? `[${isPicked ? "✓" : " "}] ${opt!.label}` : opt!.label) : "";
          labelText.fg = activeRow ? theme.colors.primary : isPicked ? theme.colors.success : theme.colors.text;
        }
        if (pickedText) {
          pickedText.content = !multi() && isPicked ? " ✓" : "";
        }
        if (descBox) {
          descBox.visible = Boolean(opt?.description);
        }
        if (descText) {
          descText.content = opt?.description ?? "";
        }
      }
      renderer.requestRender();
    } catch (error) {
      if (!isDestroyedRenderableError(error)) {
        throw error;
      }
      detachRenderableRefs();
    }
  };

  const unsubQuestion = eventBus.subscribe(AppEvent.UserInputRequested, (evt) => {
    setActiveRequest({
      allowFreeInput: evt.properties.allowFreeInput,
      defaultValue: evt.properties.defaultValue,
      multiSelect: evt.properties.multiSelect,
      options: evt.properties.options ?? [],
      placeholder: evt.properties.placeholder,
      question: evt.properties.question,
      requestId: evt.properties.requestId,
      steps: evt.properties.steps,
    });
  });

  useKeyboard((event) => {
    if (!currentRequest) {
      return;
    }
    if (inputMode) {
      if (event.name === "escape") {
        inputMode = false;
        syncView();
        event.stopPropagation?.();
        return;
      }
      if (event.name === "backspace") {
        inputValue = inputValue.slice(0, -1);
        syncView();
        event.stopPropagation?.();
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        const answer = inputValue.trim();
        if (answer) {
          completeCurrent(answer);
        }
        event.stopPropagation?.();
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        inputValue += event.name;
        syncView();
        event.stopPropagation?.();
      }
      return;
    }

    const action = resolveQuestionPromptAction(event, multi());
    switch (action) {
      case "move_up": {
        selected = selected > 0 ? selected - 1 : Math.max(0, optionCount() - 1);
        syncView();
        event.stopPropagation?.();
        return;
      }
      case "move_down": {
        selected = selected < optionCount() - 1 ? selected + 1 : 0;
        syncView();
        event.stopPropagation?.();
        return;
      }
      case "dismiss": {
        publishCancel();
        event.stopPropagation?.();
        return;
      }
      case "toggle": {
        selectOption(selected);
        event.stopPropagation?.();
        return;
      }
      case "free_input": {
        if (allowFreeInput()) {
          inputMode = true;
          syncView();
          event.stopPropagation?.();
        }
        return;
      }
      case "confirm": {
        confirmCurrent();
        event.stopPropagation?.();
        return;
      }
      default: {
        return;
      }
    }
  });

  onCleanup(() => {
    disposed = true;
    currentRequest = null;
    unsubQuestion();
    if (pendingSync) {
      clearTimeout(pendingSync);
    }
    detachRenderableRefs();
  });

  return (
    <box
      ref={(node) => {
        rootBox = node as MutableBoxRenderable;
      }}
      visible={false}
      backgroundColor={theme.extended.bg.panel}
      border={["left"]}
      borderColor={theme.colors.accent}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="column" gap={1}>
        <box
          ref={(node) => {
            stepTabs = node as MutableBoxRenderable;
          }}
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          visible={false}
        >
          {QUESTION_STEP_SLOTS.map((idx) => (
            <text
              ref={(node) => {
                stepTexts[idx] = node as MutableTextRenderable;
              }}
              visible={false}
              content=""
            />
          ))}
        </box>
        <box paddingLeft={1}>
          <text
            ref={(node) => {
              questionText = node as MutableTextRenderable;
            }}
            fg={theme.colors.text}
            content=""
          />
        </box>
        <box paddingLeft={1} gap={1}>
          {QUESTION_OPTION_SLOTS.map((idx) => (
            <box
              ref={(node) => {
                optionRows[idx] = node as MutableBoxRenderable;
              }}
              visible={false}
              onMouseOver={() => {
                if (!optionAt(idx)) {
                  return;
                }
                selected = idx;
                syncView();
              }}
              onMouseUp={() => selectOption(idx)}
            >
              <box flexDirection="row">
                <box
                  ref={(node) => {
                    indexBoxes[idx] = node as MutableBoxRenderable;
                  }}
                  paddingRight={1}
                >
                  <text
                    ref={(node) => {
                      indexTexts[idx] = node as MutableTextRenderable;
                    }}
                    fg={theme.colors.muted}
                    content=""
                  />
                </box>
                <box
                  ref={(node) => {
                    labelBoxes[idx] = node as MutableBoxRenderable;
                  }}
                >
                  <text
                    ref={(node) => {
                      labelTexts[idx] = node as MutableTextRenderable;
                    }}
                    fg={theme.colors.text}
                    content=""
                  />
                </box>
                <text
                  ref={(node) => {
                    pickedTexts[idx] = node as MutableTextRenderable;
                  }}
                  fg={theme.colors.success}
                  content=""
                />
              </box>
              <box
                ref={(node) => {
                  descBoxes[idx] = node as MutableBoxRenderable;
                }}
                paddingLeft={3}
                visible={false}
              >
                <text
                  ref={(node) => {
                    descTexts[idx] = node as MutableTextRenderable;
                  }}
                  fg={theme.colors.muted}
                  content=""
                />
              </box>
            </box>
          ))}
        </box>
      </box>
    </box>
  );
}

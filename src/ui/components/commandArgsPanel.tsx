/**
 * CommandArgsPanel
 *
 * 职责:
 *   - 显示命令参数列表并支持编辑
 *   - 提供参数补全和枚举值选择
 *   - 处理参数值的输入和验证
 *
 * 模块功能:
 *   - 渲染命令参数表单(名称、描述、类型、必填标记)
 *   - 支持字符串、数字、布尔值、数组、枚举等多种参数类型
 *   - 提供参数值补全列表(completions)
 *   - 处理键盘导航(↑↓ 切换参数，Enter 编辑，Esc 返回)
 *   - 提交完整的参数值集合
 *
 * 使用场景:
 *   - 执行需要参数的命令时显示参数输入面板
 *   - 为复杂命令提供结构化的参数配置界面
 *   - 支持枚举类型参数的快捷选择
 *
 * 边界:
 *   1. 仅支持预定义的 CommandArg 类型参数
 *   2. 输入模式为单行文本，不支持多行输入
 *   3. 依赖外部提供参数补全数据
 *
 * 流程:
 *   1. 接收命令参数定义列表
 *   2. 渲染参数列表，高亮当前选中项
 *   3. 进入输入模式或选择模式编辑参数值
 *   4. 所有参数填写完成后提交
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { resolveEscape } from "../escBehavior";

export interface CommandArg {
  name: string;
  description: string;
  type: "string" | "number" | "boolean" | "array" | "enum";
  required?: boolean;
  default?: unknown;
  enumValues?: string[];
  placeholder?: string;
}

export interface ArgCompletion {
  value: string;
  label: string;
  description?: string;
}

export interface CommandArgsPanelProps {
  args: CommandArg[];
  values: Record<string, string>;
  completions?: Record<string, ArgCompletion[]>;
  onValueChange: (name: string, value: string) => void;
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
}

export function CommandArgsPanel(props: CommandArgsPanelProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [inputMode, setInputMode] = createSignal<string | null>(null);
  const [inputValue, setInputValue] = createSignal("");
  const [selectArg, setSelectArg] = createSignal<string | null>(null);
  const [selectIndex, setSelectIndex] = createSignal(0);

  const args = () => props.args;
  const currentArg = () => args()[focusIndex()];

  // 选择模式的补全列表
  const completions = createMemo(() => {
    const argName = selectArg();
    if (!argName) {
      return [];
    }
    return props.completions?.[argName] ?? [];
  });

  useKeyboard((event) => {
    // 输入模式
    if (inputMode()) {
      if (event.name === "escape") {
        const a = resolveEscape({ lastInputMode: "freeInput" });
        if (a.kind === "popInputMode") {
          setInputMode(null);
          setInputValue("");
          return;
        }
      }
      if (event.name === "return" || event.name === "enter") {
        props.onValueChange(inputMode()!, inputValue());
        setInputMode(null);
        setInputValue("");
        return;
      }
      if (event.name === "backspace") {
        setInputValue((v) => v.slice(0, -1));
        return;
      }
      if (event.name === "tab") {
        const comps = completions();
        if (comps.length > 0) {
          setInputValue(comps[selectIndex()]?.value ?? "");
          return;
        }
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setInputValue((v) => v + event.name);
      }
      return;
    }

    // 补全选择模式
    if (selectArg()) {
      if (event.name === "escape") {
        const a = resolveEscape({ lastInputMode: "selectArg" });
        if (a.kind === "popInputMode") {
          setSelectArg(null);
          return;
        }
      }
      if (event.name === "return" || event.name === "enter") {
        const comp = completions()[selectIndex()];
        if (comp) {
          props.onValueChange(selectArg()!, comp.value);
          setSelectArg(null);
        }
        return;
      }
      if (event.name === "up") {
        setSelectIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (event.name === "down") {
        setSelectIndex((i) => Math.min(completions().length - 1, i + 1));
        return;
      }
      return;
    }

    // 列表模式
    if (event.name === "escape") {
      const a = resolveEscape({ openDialog: true });
      if (a.kind === "closeTopDialog") {
        props.onClose();
        return;
      }
    }
    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(args().length, i + 1));
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      const arg = currentArg();
      if (!arg) {
        // 超出列表 = 提交
        props.onSubmit(props.values);
        return;
      }
      if (arg.enumValues && arg.enumValues.length > 0) {
        // 枚举选择
        setSelectArg(arg.name);
        setSelectIndex(0);
      } else {
        setInputMode(arg.name);
        setInputValue(props.values[arg.name] ?? String(arg.default ?? ""));
      }
      return;
    }
  });

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={c.text}>
          <b>{"命令参数"}</b>
        </text>
        <text fg={c.muted}>{"esc 返回"}</text>
      </box>

      {/* 参数列表 */}
      <box flexDirection="column">
        <For each={args()}>
          {(arg, index) => {
            const isFocused = () => index() === focusIndex();
            const value = () => props.values[arg.name] ?? "";
            const required = arg.required ? " *" : "";
            return (
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isFocused() ? c.primary : undefined}
                {...({} as any)}
              >
                <text fg={isFocused() ? c.text : c.muted} flexShrink={0}>
                  {isFocused() ? "❯ " : "  "}
                </text>
                <text fg={arg.required ? c.warning : c.text} flexShrink={0}>
                  {arg.name + required}
                </text>
                <text fg={c.muted} flexGrow={1}>
                  {arg.description}
                </text>
                <text fg={value() ? c.accent : c.muted} flexShrink={0}>
                  {value() || arg.placeholder || "—"}
                </text>
              </box>
            );
          }}
        </For>
        {/* 提交行 */}
        <box
          flexDirection="row"
          gap={1}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={focusIndex() === args().length ? c.primary : undefined}
          {...({} as any)}
        >
          <text fg={focusIndex() === args().length ? c.text : c.muted}>
            {focusIndex() === args().length ? "❯ " : "  "}
          </text>
          <text fg={c.success}>{"✓ 执行命令"}</text>
        </box>
      </box>

      {/* 输入模式 */}
      <Show when={inputMode() !== null}>
        <box flexDirection="column" gap={1}>
          <text fg={c.info}>{`输入 ${inputMode()}:`}</text>
          <text fg={c.accent}>{`❯ ${inputValue()}_`}</text>
          <text fg={c.muted}>{"Enter 确认 · Esc 取消"}</text>
        </box>
      </Show>

      {/* 补全选择 */}
      <Show when={selectArg() !== null && completions().length > 0}>
        <box flexDirection="column" gap={1}>
          <text fg={c.info}>{`选择 ${selectArg()}:`}</text>
          <For each={completions()}>
            {(comp, idx) => {
              const isSel = () => idx() === selectIndex();
              return (
                <text
                  fg={isSel() ? c.text : c.muted}
                  backgroundColor={isSel() ? c.primary : undefined}
                  {...({} as any)}
                >
                  {isSel() ? "❯ " : "  "}
                  {comp.label}
                </text>
              );
            }}
          </For>
        </box>
      </Show>

      <text fg={c.muted}>{"↑↓ 导航 · Enter 编辑 · Esc 返回"}</text>
    </box>
  );
}

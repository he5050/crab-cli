/**
 * CustomCommandPanel
 *
 * 职责:
 *   - 管理和执行用户自定义命令
 *   - 支持添加、删除、执行自定义命令
 *   - 提供分步向导式添加流程
 *
 * 模块功能:
 *   - 渲染自定义命令列表(名称、描述)
 *   - 添加命令向导(名称 → 命令 → 描述)
 *   - 键盘导航(上下箭头、回车执行、Delete 删除)
 *   - 支持命令执行回调
 *
 * 使用场景:
 *   - 用户需要管理常用自定义命令时
 *   - 快速执行预定义的复杂命令时
 *   - 需要添加新的自定义命令时
 *
 * 边界:
 *   1. 命令数据通过 props 传入，组件不管理持久化
 *   2. 实际的命令执行由父组件通过 onRun 处理
 *   3. 添加命令为分步表单，不支持一步完成
 *   4. 命令描述可选，名称和命令内容必填
 *
 * 流程:
 *   1. 渲染命令列表，支持键盘导航
 *   2. 选择"添加命令"进入添加流程
 *   3. 分步输入:命令名称 → 命令内容 → 描述
 *   4. 每步可 Esc 返回上一步
 *   5. 完成添加后返回列表并刷新
 *   6. 选择命令后回车执行，Delete 删除
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { resolveEscape } from "../escBehavior";
import { actionSelect, toolBash } from "@/ui/utils/icon";

export interface CustomCommand {
  id: string;
  name: string;
  description: string;
  command: string;
  args?: string[];
  workingDir?: string;
  env?: Record<string, string>;
}

interface CustomCommandPanelProps {
  commands: CustomCommand[];
  onRun?: (id: string) => void;
  onAdd?: (cmd: Omit<CustomCommand, "id">) => void;
  onEdit?: (id: string, cmd: Partial<CustomCommand>) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

export function CustomCommandPanel(props: CustomCommandPanelProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [screen, setScreen] = createSignal<"list" | "add-name" | "add-cmd" | "add-desc">("list");
  const [inputName, setInputName] = createSignal("");
  const [inputCmd, setInputCmd] = createSignal("");
  const [inputDesc, setInputDesc] = createSignal("");

  const commands = () => props.commands;

  const listOptions = createMemo(() => [
    ...commands().map((cmd) => ({ cmd, type: "cmd" as const })),
    { type: "sep" as const },
    { type: "add" as const },
    { type: "back" as const },
  ]);

  useKeyboard((event) => {
    // 添加流程
    if (screen() === "add-name") {
      if (event.name === "escape") {
        const a = resolveEscape({ lastInputMode: "screenSubView" });
        if (a.kind === "popInputMode") {
          setScreen("list");
          setInputName("");
          return;
        }
      }
      if (event.name === "return" || event.name === "enter") {
        if (inputName().trim()) {
          setScreen("add-cmd");
        }
        return;
      }
      if (event.name === "backspace") {
        setInputName((v) => v.slice(0, -1));
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setInputName((v) => v + event.name);
      }
      return;
    }

    if (screen() === "add-cmd") {
      if (event.name === "escape") {
        const a = resolveEscape({ lastInputMode: "screenSubView" });
        if (a.kind === "popInputMode") {
          setScreen("add-name");
          setInputCmd("");
          return;
        }
      }
      if (event.name === "return" || event.name === "enter") {
        if (inputCmd().trim()) {
          setScreen("add-desc");
        }
        return;
      }
      if (event.name === "backspace") {
        setInputCmd((v) => v.slice(0, -1));
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setInputCmd((v) => v + event.name);
      }
      return;
    }

    if (screen() === "add-desc") {
      if (event.name === "escape") {
        const a = resolveEscape({ lastInputMode: "screenSubView" });
        if (a.kind === "popInputMode") {
          setScreen("add-cmd");
          setInputDesc("");
          return;
        }
      }
      if (event.name === "return" || event.name === "enter") {
        props.onAdd?.({ command: inputCmd().trim(), description: inputDesc().trim(), name: inputName().trim() });
        setScreen("list");
        setInputName("");
        setInputCmd("");
        setInputDesc("");
        return;
      }
      if (event.name === "backspace") {
        setInputDesc((v) => v.slice(0, -1));
        return;
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setInputDesc((v) => v + event.name);
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
      setFocusIndex((i) => Math.min(listOptions().length - 1, i + 1));
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      const opt = listOptions()[focusIndex()];
      if (!opt) {
        return;
      }
      if (opt.type === "cmd") {
        props.onRun?.(opt.cmd.id);
      } else if (opt.type === "add") {
        setScreen("add-name");
        setInputName("");
        setInputCmd("");
        setInputDesc("");
      }
    }
    if (event.name === "delete" || (event.ctrl && event.name === "d")) {
      const opt = listOptions()[focusIndex()];
      if (opt?.type === "cmd") {
        props.onDelete?.(opt.cmd.id);
      }
    }
  });

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={c.text}>
          <b>{`${toolBash} 自定义命令`}</b>
        </text>
        <text fg={c.muted}>{"esc 返回"}</text>
      </box>

      {/* 添加流程 */}
      <Show when={screen() === "add-name"}>
        <box flexDirection="column" gap={1}>
          <text fg={c.info}>{"输入命令名称:"}</text>
          <text fg={c.accent}>{`${actionSelect} ${inputName()}_`}</text>
          <text fg={c.muted}>{"Enter 继续 · Esc 取消"}</text>
        </box>
      </Show>
      <Show when={screen() === "add-cmd"}>
        <box flexDirection="column" gap={1}>
          <text fg={c.info}>{"输入命令内容:"}</text>
          <text fg={c.accent}>{`${actionSelect} ${inputCmd()}_`}</text>
          <text fg={c.muted}>{"Enter 继续 · Esc 返回"}</text>
        </box>
      </Show>
      <Show when={screen() === "add-desc"}>
        <box flexDirection="column" gap={1}>
          <text fg={c.info}>{"输入描述(可选):"}</text>
          <text fg={c.accent}>{`${actionSelect} ${inputDesc()}_`}</text>
          <text fg={c.muted}>{"Enter 创建 · Esc 返回"}</text>
        </box>
      </Show>

      {/* 列表 */}
      <Show when={screen() === "list"}>
        <box flexDirection="column">
          <For each={listOptions()}>
            {(opt, index) => {
              const isFocused = () => index() === focusIndex();
              if (opt.type === "sep") {
                return <text fg={c.muted}>{"─".repeat(30)}</text>;
              }
              if (opt.type === "add") {
                return (
                  <text
                    fg={isFocused() ? c.text : c.success}
                    backgroundColor={isFocused() ? c.primary : undefined}
                    {...({} as any)}
                  >
                    {isFocused() ? `${actionSelect} ` : "  "}
                    {"+ 添加命令"}
                  </text>
                );
              }
              if (opt.type === "back") {
                return (
                  <text
                    fg={isFocused() ? c.text : c.muted}
                    backgroundColor={isFocused() ? c.primary : undefined}
                    {...({} as any)}
                  >
                    {isFocused() ? `${actionSelect} ` : "  "}
                    {"← 返回"}
                  </text>
                );
              }
              const { cmd } = opt;
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
                    {isFocused() ? `${actionSelect} ` : "  "}
                  </text>
                  <text fg={isFocused() ? c.text : c.text} flexShrink={0}>
                    {cmd.name}
                  </text>
                  <text fg={c.muted} flexGrow={1}>
                    {cmd.description.length > 30 ? `${cmd.description.slice(0, 30)}...` : cmd.description}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
        <text fg={c.muted}>{"↑↓ 导航 · Enter 执行 · Delete 删除 · Esc 返回"}</text>
      </Show>
    </box>
  );
}

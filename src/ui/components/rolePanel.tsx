/**
 * RolePanel 组件
 *
 * 职责:
 *   - 提供角色管理界面，支持查看、创建、删除角色
 *   - 区分内置角色和自定义角色
 *
 * 模块功能:
 *   - 显示角色列表，区分内置角色(◆)和自定义角色(◇)
 *   - 支持创建新角色(三步流程:名称→描述→系统提示词)
 *   - 支持删除自定义角色(Ctrl+D 或 Delete 键)
 *   - 多屏幕状态管理:列表、创建-名称、创建-描述、创建-提示词
 *
 * 使用场景:
 *   - 用户需要创建自定义角色时
 *   - 需要管理已有角色时
 *   - 需要为角色配置系统提示词时
 *
 * 边界:
 *   1. 内置角色不可删除
 *   2. 创建角色时名称和描述不能为空
 *   3. 系统提示词为可选项
 *   4. 创建流程支持 Esc 返回上一步
 *
 * 流程:
 *   1. 列表模式:上下导航，Enter 选择，Ctrl+D/Delete 删除
 *   2. 创建流程:
 *      - 输入名称 → Enter 继续
 *      - 输入描述 → Enter 继续
 *      - 输入系统提示词(可选)→ Enter 完成创建
 *   3. 每步可按 Esc 返回上一步或取消
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { actionSelect, iconBuiltin, iconCustom, iconError } from "@/ui/utils/icon";

// ─── 类型 ──────────────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  isBuiltin?: boolean;
}

export interface RolePanelProps {
  onClose: () => void;
  roles?: Role[];
  onCreateRole?: (name: string, description: string, systemPrompt?: string) => void;
  onDeleteRole?: (id: string) => void;
}

// ─── RolePanel ─────────────────────────────────────────────

export function RolePanel(props: RolePanelProps) {
  const theme = useTheme();

  const [screen, setScreen] = createSignal<"list" | "create-name" | "create-desc" | "create-prompt">("list");
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal("");

  const [newName, setNewName] = createSignal("");
  const [newDesc, setNewDesc] = createSignal("");
  const [newPrompt, setNewPrompt] = createSignal("");

  const roles = () => props.roles || [];

  const listOptions = createMemo(() => {
    const items = roles().map((role) => ({
      label: `${(role.isBuiltin ? iconBuiltin + " " : iconCustom + " ") + role.name} — ${role.description}`,
      role,
      value: role.id,
    }));
    return [
      ...items,
      { label: "─".repeat(30), role: null as any, value: "__sep__" },
      { label: "+ 创建新角色", role: null as any, value: "__create__" },
      { label: "← 返回", role: null as any, value: "__back__" },
    ];
  });

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    // 创建流程
    if (screen() === "create-name") {
      if (event.name === "escape") {
        setScreen("list");
        setFocusIndex(0);
        setNewName("");
      } else if (event.name === "return" || event.name === "enter") {
        if (newName().trim()) {
          setScreen("create-desc");
          setErrorMessage("");
        }
      } else if (event.name === "backspace") {
        setNewName((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setNewName((v) => v + event.name);
      }
      return;
    }

    if (screen() === "create-desc") {
      if (event.name === "escape") {
        setScreen("create-name");
        setNewDesc("");
      } else if (event.name === "return" || event.name === "enter") {
        if (newDesc().trim()) {
          setScreen("create-prompt");
          setErrorMessage("");
        }
      } else if (event.name === "backspace") {
        setNewDesc((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setNewDesc((v) => v + event.name);
      }
      return;
    }

    if (screen() === "create-prompt") {
      if (event.name === "escape") {
        setScreen("create-desc");
        setNewPrompt("");
      } else if (event.name === "return" || event.name === "enter") {
        props.onCreateRole?.(newName().trim(), newDesc().trim(), newPrompt().trim() || undefined);
        setScreen("list");
        setFocusIndex(0);
        setNewName("");
        setNewDesc("");
        setNewPrompt("");
      } else if (event.name === "backspace") {
        setNewPrompt((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setNewPrompt((v) => v + event.name);
      }
      return;
    }

    // 列表模式
    if (event.name === "escape") {
      props.onClose();
      return;
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
      const idx = focusIndex();
      const opt = listOptions()[idx];
      if (!opt) {
        return;
      }
      if (opt.value === "__back__") {
        props.onClose();
      } else if (opt.value === "__create__") {
        setScreen("create-name");
        setNewName("");
        setNewDesc("");
        setNewPrompt("");
      } else if (opt.value === "__sep__") {
        /* Skip */
      }
    }

    // Ctrl+D 删除
    if (event.ctrl && event.name === "d") {
      const opt = listOptions()[focusIndex()];
      if (opt?.role && !opt.role.isBuiltin) {
        props.onDeleteRole?.(opt.role.id);
      }
    }

    // Delete 键
    if (event.name === "delete") {
      const opt = listOptions()[focusIndex()];
      if (opt?.role && !opt.role.isBuiltin) {
        props.onDeleteRole?.(opt.role.id);
      }
    }
  });

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.colors.warning}>
          <b>{"角色管理"}</b>
        </text>
        <text fg={theme.colors.muted}>{"esc 返回"}</text>
      </box>

      <Show when={errorMessage()}>
        <text fg={theme.colors.error}>{`${iconError} ${errorMessage()}`}</text>
      </Show>

      {/* 创建流程 */}
      <Show when={screen() === "create-name"}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.info}>{"输入角色名称:"}</text>
          <text fg={theme.colors.accent}>{`${actionSelect} ${newName()}_`}</text>
          <text fg={theme.colors.muted}>{"Enter 继续 · Esc 取消"}</text>
        </box>
      </Show>

      <Show when={screen() === "create-desc"}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.info}>{`角色: ${newName()} — 输入描述:`}</text>
          <text fg={theme.colors.accent}>{`${actionSelect} ${newDesc()}_`}</text>
          <text fg={theme.colors.muted}>{"Enter 继续 · Esc 返回"}</text>
        </box>
      </Show>

      <Show when={screen() === "create-prompt"}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.info}>{`${newName()} — 输入系统提示词(可选):`}</text>
          <text fg={theme.colors.accent}>{`${actionSelect} ${newPrompt()}_`}</text>
          <text fg={theme.colors.muted}>{"Enter 创建 · Esc 返回"}</text>
        </box>
      </Show>

      {/* 列表 */}
      <Show when={screen() === "list"}>
        <box flexDirection="column">
          <For each={listOptions()}>
            {(option, index) => {
              const isSelected = () => index() === focusIndex();
              if (option.value === "__sep__") {
                return <text fg={theme.colors.muted}>{option.label}</text>;
              }
              return (
                <text
                  fg={isSelected() ? theme.colors.text : theme.colors.muted}
                  backgroundColor={isSelected() ? theme.colors.primary : undefined}
                  {...({} as any)}
                >
                  {isSelected() ? `${actionSelect} ` : "  "}
                  {option.label}
                </text>
              );
            }}
          </For>
        </box>
        <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 选择 · Delete 删除 · Esc 返回"}</text>
      </Show>
    </box>
  );
}

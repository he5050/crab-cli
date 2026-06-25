/**
 * 敏感命令配置页面
 *
 * 职责:
 *   - 管理敏感命令检测规则
 *   - 支持添加/删除/启用/禁用规则
 *   - 提供过滤和搜索功能
 *
 * 模块功能:
 *   - 列表视图:显示所有规则及状态
 *   - 添加模式:输入模式和描述
 *   - 详情视图:查看规则完整信息
 *   - 过滤器:全部/已启用/已禁用/预设/自定义
 *   - 统计信息:总数、启用数、预设数等
 *
 * 使用场景:
 *   - 配置需要确认的危险命令
 *   - 管理自定义敏感命令规则
 *
 * 边界:
 *   1. 预设规则不可删除，仅可禁用
 *   2. 支持通配符 * 匹配
 *   3. 修改即时生效
 *
 * 流程:
 *   1. 加载现有规则列表
 *   2. 显示规则列表和统计
 *   3. 处理添加/删除/切换操作
 *   4. 实时更新规则状态
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { checkboxIcon } from "@/core/icons/iconDerived";
import {
  type SensitiveCommand,
  addSensitiveCommand,
  getAllSensitiveCommands,
  resetSensitiveCommands,
  toggleSensitiveCommand,
} from "@/permission/security/sensitiveCommand";

// ─── 页面层级 ──────────────────────────────────────────────

type Screen = "list" | "add-pattern" | "add-description" | "detail";

// ─── Props ─────────────────────────────────────────────────

export interface SensitiveCommandConfigProps {
  onClose: () => void;
}

// ─── SensitiveCommandConfigPage 组件 ────────────────────────

export function SensitiveCommandConfigPage(props: SensitiveCommandConfigProps) {
  const theme = useTheme();

  // 页面状态
  const [screen, setScreen] = createSignal<Screen>("list");
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal("");

  // 命令列表
  const [commands, setCommands] = createSignal<SensitiveCommand[]>(getAllSensitiveCommands());

  // 添加表单
  const [newPattern, setNewPattern] = createSignal("");
  const [newDescription, setNewDescription] = createSignal("");

  // 选中命令详情
  const [selectedCmd, setSelectedCmd] = createSignal<SensitiveCommand | null>(null);

  // 过滤/搜索
  const [searchQuery] = createSignal("");
  const [filterMode, setFilterMode] = createSignal<"all" | "enabled" | "disabled" | "preset" | "custom">("all");

  // 过滤后的命令列表
  const filteredCommands = createMemo(() => {
    let list = commands();
    const q = searchQuery().toLowerCase();
    const mode = filterMode();

    if (q) {
      list = list.filter((cmd) => cmd.pattern.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q));
    }

    switch (mode) {
      case "enabled": {
        list = list.filter((cmd) => cmd.enabled);
        break;
      }
      case "disabled": {
        list = list.filter((cmd) => !cmd.enabled);
        break;
      }
      case "preset": {
        list = list.filter((cmd) => cmd.isPreset);
        break;
      }
      case "custom": {
        list = list.filter((cmd) => !cmd.isPreset);
        break;
      }
    }

    return list;
  });

  // 列表选项
  const listOptions = createMemo(() => {
    const cmdItems = filteredCommands().map((cmd) => ({
      command: cmd,
      label: `${cmd.enabled ? checkboxIcon(true) : checkboxIcon(false)} ${cmd.isPreset ? "◆ " : "◇ "}${cmd.pattern} — ${cmd.description}`,
      value: cmd.id,
    }));

    return [
      ...cmdItems,
      { command: null as any, label: "─".repeat(40), value: "__sep__" },
      { command: null as any, label: `过滤器: ${filterMode()}`, value: "__filter__" },
      { command: null as any, label: "+ 添加自定义规则", value: "__add__" },
      { command: null as any, label: "↺ 重置为默认预设", value: "__reset__" },
      { command: null as any, label: "← 返回", value: "__back__" },
    ];
  });

  // 统计
  const stats = createMemo(() => {
    const all = commands();
    const enabled = all.filter((c) => c.enabled).length;
    const disabled = all.length - enabled;
    const preset = all.filter((c) => c.isPreset).length;
    const custom = all.length - preset;
    return { custom, disabled, enabled, preset, total: all.length };
  });

  // ─── 刷新列表 ──────────────────────────────────────────

  function refreshCommands() {
    setCommands(getAllSensitiveCommands());
  }

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    // 添加模式 - 输入 pattern
    if (screen() === "add-pattern") {
      if (event.name === "escape") {
        setScreen("list");
        setNewPattern("");
        setErrorMessage("");
      } else if (event.name === "return" || event.name === "enter") {
        if (newPattern().trim()) {
          setScreen("add-description");
          setErrorMessage("");
        }
      } else if (event.name === "backspace") {
        setNewPattern((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setNewPattern((v) => v + event.name);
      }
      return;
    }

    // 添加模式 - 输入 description
    if (screen() === "add-description") {
      if (event.name === "escape") {
        setScreen("add-pattern");
        setNewDescription("");
      } else if (event.name === "return" || event.name === "enter") {
        const pattern = newPattern().trim();
        const desc = newDescription().trim() || pattern;
        try {
          addSensitiveCommand(pattern, desc);
          refreshCommands();
          setScreen("list");
          setNewPattern("");
          setNewDescription("");
          setErrorMessage("");
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "添加失败");
          setScreen("add-pattern");
        }
      } else if (event.name === "backspace") {
        setNewDescription((v) => v.slice(0, -1));
      } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setNewDescription((v) => v + event.name);
      }
      return;
    }

    // 详情模式
    if (screen() === "detail") {
      if (event.name === "escape" || event.name === "return" || event.name === "enter") {
        setScreen("list");
        setSelectedCmd(null);
        setFocusIndex(0);
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

    // T 切换启用
    if (event.name === "t" && !event.ctrl && !event.meta) {
      const idx = focusIndex();
      const opt = listOptions()[idx];
      if (opt && opt.command) {
        toggleSensitiveCommand(opt.command.id);
        refreshCommands();
      }
      return;
    }

    // F 切换过滤器
    if (event.name === "f" && !event.ctrl && !event.meta) {
      const modes: ("all" | "enabled" | "disabled" | "preset" | "custom")[] = [
        "all",
        "enabled",
        "disabled",
        "preset",
        "custom",
      ];
      const currentIdx = modes.indexOf(filterMode());
      const nextIdx = (currentIdx + 1) % modes.length;
      setFilterMode(modes[nextIdx]!);
      setFocusIndex(0);
      return;
    }

    // Enter 选择
    if (event.name === "return" || event.name === "enter") {
      const idx = focusIndex();
      const opt = listOptions()[idx];
      if (!opt) {
        return;
      }

      switch (opt.value) {
        case "__back__": {
          props.onClose();
          break;
        }
        case "__add__": {
          setScreen("add-pattern");
          setNewPattern("");
          setNewDescription("");
          setErrorMessage("");
          break;
        }
        case "__reset__": {
          resetSensitiveCommands();
          refreshCommands();
          break;
        }
        case "__filter__": {
          // F 键处理
          break;
        }
        case "__sep__": {
          break;
        }
        default: {
          if (opt.command) {
            setSelectedCmd(opt.command);
            setScreen("detail");
          }
        }
      }
    }
  });

  // ─── 渲染 ────────────────────────────────────────────

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题 */}
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"敏感命令配置"}</span>
      </box>

      {/* 错误 */}
      <Show when={errorMessage()}>
        <box marginBottom={1}>
          <text fg={theme.colors.error}>{`✗ ${errorMessage()}`}</text>
        </box>
      </Show>

      {/* 添加模式 - pattern */}
      <Show when={screen() === "add-pattern"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{"输入命令匹配模式(支持 * 通配符):"}</text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`❯ ${newPattern()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Enter 继续 · Esc 取消"}</text>
          </box>
        </box>
      </Show>

      {/* 添加模式 - description */}
      <Show when={screen() === "add-description"}>
        <box flexDirection="column" paddingLeft={1}>
          <text fg={theme.colors.info}>{`模式: ${newPattern()}`}</text>
          <text fg={theme.colors.info}>{"输入描述:"}</text>
          <box paddingLeft={1} marginTop={1}>
            <text fg={theme.colors.accent}>{`❯ ${newDescription()}_`}</text>
          </box>
          <box marginTop={1}>
            <text fg={theme.colors.muted}>{"Enter 确认添加 · Esc 返回"}</text>
          </box>
        </box>
      </Show>

      {/* 详情模式 */}
      <Show when={screen() === "detail" && selectedCmd()}>
        {(() => {
          const cmd = selectedCmd()!;
          return (
            <box flexDirection="column" paddingLeft={1}>
              <text fg={theme.colors.info}>{"命令详情:"}</text>
              <box flexDirection="column" paddingLeft={1} marginTop={1}>
                <text fg={theme.colors.text}>{`模式: ${cmd.pattern}`}</text>
                <text fg={theme.colors.text}>{`描述: ${cmd.description}`}</text>
                <text fg={cmd.enabled ? theme.colors.success : theme.colors.warning}>
                  {`状态: ${cmd.enabled ? "已启用" : "已禁用"}`}
                </text>
                <text fg={theme.colors.text}>{`类型: ${cmd.isPreset ? "预设" : "自定义"}`}</text>
                <text fg={theme.colors.text}>{`作用域: ${cmd.scope}`}</text>
              </box>
              <box marginTop={1}>
                <text fg={theme.colors.muted}>{"按任意键返回列表"}</text>
              </box>
            </box>
          );
        })()}
      </Show>

      {/* 列表模式 */}
      <Show when={screen() === "list"}>
        {/* 统计 */}
        <box marginBottom={1} paddingLeft={1}>
          <text fg={theme.colors.muted}>
            {`共 ${stats().total} 条规则 · ${stats().enabled} 启用 · ${stats().disabled} 禁用 · ${stats().preset} 预设 · ${stats().custom} 自定义`}
          </text>
        </box>

        {/* 命令列表 */}
        <box flexDirection="column" paddingLeft={1}>
          <For each={listOptions()}>
            {(option, index) => {
              const isSelected = () => index() === focusIndex();
              const isSeparator = option.value === "__sep__";
              if (isSeparator) {
                return <text fg={theme.colors.muted}>{option.label}</text>;
              }
              return (
                <text
                  fg={isSelected() ? theme.colors.text : theme.colors.muted}
                  backgroundColor={isSelected() ? theme.colors.primary : undefined}
                  {...({} as any)}
                >
                  {`${isSelected() ? "❯ " : "  "}${option.label}`}
                </text>
              );
            }}
          </For>
        </box>

        {/* 快捷键提示 */}
        <box marginTop={1}>
          <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 查看 · T 切换启用 · F 过滤 · Esc 返回"}</text>
        </box>
      </Show>
    </box>
  );
}

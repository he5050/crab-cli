/**
 * RoleSubagentPanel 组件
 *
 * 职责:
 *   - 管理 Role 关联的子代理配置
 *   - 支持添加和移除子代理
 *
 * 模块功能:
 *   - 显示当前 Role 已关联的子代理列表
 *   - 支持添加新子代理(从可用列表中选择)
 *   - 支持移除已关联的子代理(Delete 键或 Ctrl+D)
 *   - 双屏状态:列表模式、添加选择模式
 *
 * 使用场景:
 *   - 配置角色可用的子代理能力时
 *   - 需要为角色扩展功能时
 *   - 管理角色的子代理权限时
 *
 * 边界:
 *   1. 仅显示当前 Role 关联的子代理
 *   2. 添加时只显示未关联的可用子代理
 *   3. 子代理显示启用状态(● 启用 / ○ 禁用)
 *
 * 流程:
 *   1. 列表模式:显示已关联子代理，Enter 进入添加模式
 *   2. 添加模式:从可用列表中选择，Enter 添加
 *   3. Delete/Ctrl+D 移除选中的子代理
 *   4. Esc 返回或关闭面板
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { actionSelect, iconAgent, iconIdle, iconRunning } from "@/ui/utils/icon";

// 使用本地类型(避免导入不存在的 SubAgentDefinition)
export interface SubAgentEntry {
  id: string;
  name: string;
  description: string;
  enabled?: boolean;
}

interface RoleSubagentPanelProps {
  roleId: string;
  subagents: SubAgentEntry[];
  availableSubagents: SubAgentEntry[];
  onAddSubagent: (subagentId: string) => void;
  onRemoveSubagent: (subagentId: string) => void;
  onClose: () => void;
}

export function RoleSubagentPanel(props: RoleSubagentPanelProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [screen, setScreen] = createSignal<"list" | "add">("list");

  const listOptions = createMemo(() => {
    const items = props.subagents.map((sa) => ({ sa, type: "linked" as const }));
    return [...items, { type: "sep" as const }, { type: "add" as const }, { type: "back" as const }];
  });

  const addOptions = createMemo(() => {
    const linked = new Set(props.subagents.map((s) => s.id));
    return props.availableSubagents.filter((s) => !linked.has(s.id));
  });

  useKeyboard((event) => {
    // 添加子代理选择
    if (screen() === "add") {
      if (event.name === "escape") {
        setScreen("list");
        return;
      }
      if (event.name === "up") {
        setFocusIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (event.name === "down") {
        setFocusIndex((i) => Math.min(addOptions().length - 1, i + 1));
        return;
      }
      if (event.name === "return" || event.name === "enter") {
        const sa = addOptions()[focusIndex()];
        if (sa) {
          props.onAddSubagent(sa.id);
          setScreen("list");
        }
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
      const opt = listOptions()[focusIndex()];
      if (!opt) {
        return;
      }
      if (opt.type === "add") {
        setScreen("add");
        setFocusIndex(0);
      }
    }
    if (event.name === "delete" || (event.ctrl && event.name === "d")) {
      const opt = listOptions()[focusIndex()];
      if (opt?.type === "linked") {
        props.onRemoveSubagent(opt.sa.id);
      }
    }
  });

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={c.text}>
          <b>{`${iconAgent} Role 子代理`}</b>
        </text>
        <text fg={c.muted}>{"esc 返回"}</text>
      </box>

      {/* 添加选择 */}
      <Show when={screen() === "add"}>
        <text fg={c.info}>{"选择要添加的子代理:"}</text>
        <Show when={addOptions().length === 0}>
          <text fg={c.muted}>{"无可用子代理"}</text>
        </Show>
        <box flexDirection="column">
          <For each={addOptions()}>
            {(sa, index) => {
              const isFocused = () => index() === focusIndex();
              return (
                <text
                  fg={isFocused() ? c.text : c.muted}
                  backgroundColor={isFocused() ? c.primary : undefined}
                  {...({} as any)}
                >
                  {isFocused() ? `${actionSelect} ` : "  "}
                  {`${sa.name} — ${sa.description}`}
                </text>
              );
            }}
          </For>
        </box>
        <text fg={c.muted}>{"↑↓ 导航 · Enter 添加 · Esc 返回"}</text>
      </Show>

      {/* 列表 */}
      <Show when={screen() === "list"}>
        <text fg={c.muted}>{`Role: ${props.roleId} · ${props.subagents.length} 个子代理`}</text>
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
                    {"+ 添加子代理"}
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
              const { sa } = opt;
              return (
                <box
                  flexDirection="row"
                  gap={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isFocused() ? c.primary : undefined}
                  {...({} as any)}
                >
                  <text fg={c.muted} flexShrink={0}>
                    {isFocused() ? `${actionSelect} ` : "  "}
                  </text>
                  <text fg={sa.enabled !== false ? c.text : c.muted} flexShrink={0}>
                    {sa.enabled !== false ? iconRunning : iconIdle}
                    {sa.name}
                  </text>
                  <text fg={c.muted} flexGrow={1}>
                    {sa.description}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
        <text fg={c.muted}>{"↑↓ 导航 · Enter 选择 · Delete 移除 · Esc 返回"}</text>
      </Show>
    </box>
  );
}

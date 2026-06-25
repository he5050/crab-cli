/**
 * IdeSelectPanel 组件
 *
 * 职责:
 *   - 提供 IDE 选择面板，显示可用 IDE 列表并支持连接/断开
 *
 * 模块功能:
 *   - 显示 IDE 列表，包括安装状态、连接状态、版本信息
 *   - 支持搜索过滤 IDE
 *   - 支持 Enter 键连接/断开 IDE
 *   - 状态图标显示:● 已连接 / ○ 已安装 / ✗ 未安装
 *
 * 使用场景:
 *   - 用户需要连接 IDE 进行代码编辑时
 *   - 需要切换当前连接的 IDE 时
 *   - 需要查看可用 IDE 状态时
 *
 * 边界:
 *   1. 支持 8 种 IDE 类型:vscode、cursor、windsurf、trae、idea、pycharm、webstorm、custom
 *   2. 已连接的 IDE Enter 键断开，未连接的 Enter 键连接
 *   3. 支持实时搜索过滤
 *   4. 显示 IDE 版本号(如有)
 *
 * 流程:
 *   1. 加载 IDE 列表和状态
 *   2. 渲染 IDE 列表，显示状态和版本
 *   3. 上下键导航，Enter 连接/断开
 *   4. 直接输入字符进行搜索过滤
 *   5. Esc 关闭面板
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { iconError, iconIde, iconIdle, iconRunning } from "@/ui/utils/icon";

export type IDEType = "vscode" | "cursor" | "windsurf" | "trae" | "idea" | "pycharm" | "webstorm" | "custom";

export interface IDEInfo {
  id: string;
  type: IDEType;
  name: string;
  installed: boolean;
  connected: boolean;
  version?: string;
  path?: string;
  port?: number;
}

export interface IdeSelectPanelProps {
  ides: IDEInfo[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onClose: () => void;
}

export function IdeSelectPanel(props: IdeSelectPanelProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [filter, setFilter] = createSignal("");

  const filtered = createMemo(() => {
    const q = filter().toLowerCase();
    if (!q) {
      return props.ides;
    }
    return props.ides.filter((ide) => ide.name.toLowerCase().includes(q) || ide.type.toLowerCase().includes(q));
  });

  useKeyboard((event) => {
    if (event.name === "escape") {
      props.onClose();
      return;
    }
    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(filtered().length - 1, i + 1));
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      const ide = filtered()[focusIndex()];
      if (!ide) {
        return;
      }
      if (ide.connected) {
        props.onDisconnect?.(ide.id);
      } else {
        props.onConnect?.(ide.id);
      }
      return;
    }
    if (event.name === "backspace") {
      setFilter((f) => f.slice(0, -1));
      setFocusIndex(0);
      return;
    }
    if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
      setFilter((f) => f + event.name);
      setFocusIndex(0);
    }
  });

  const statusIcon = (ide: IDEInfo): string => {
    if (ide.connected) {
      return iconRunning;
    }
    if (ide.installed) {
      return iconIdle;
    }
    return iconError;
  };
  const statusFg = (ide: IDEInfo): string => {
    if (ide.connected) {
      return c.success;
    }
    if (ide.installed) {
      return c.muted;
    }
    return c.error;
  };

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={c.text}>
          <b>{`${iconIde} IDE 选择`}</b>
        </text>
        <text fg={c.muted}>{"esc 返回"}</text>
      </box>

      {/* 搜索 */}
      <Show when={filter()}>
        <text fg={c.info}>{`搜索: ${filter()}`}</text>
      </Show>

      {/* 列表 */}
      <Show when={filtered().length === 0}>
        <text fg={c.muted}>{"无可用 IDE"}</text>
      </Show>
      <box flexDirection="column">
        <For each={filtered()}>
          {(ide, index) => {
            const isFocused = () => index() === focusIndex();
            return (
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isFocused() ? c.primary : undefined}
                {...({} as any)}
              >
                <text fg={statusFg(ide)} flexShrink={0}>
                  {statusIcon(ide)}
                </text>
                <text fg={isFocused() ? c.text : c.text} flexShrink={0}>
                  {ide.name}
                </text>
                <text fg={c.muted} flexGrow={1}>
                  {ide.type + (ide.version ? " " + ide.version : "")}
                </text>
                <text fg={ide.connected ? c.success : c.muted} flexShrink={0}>
                  {ide.connected ? "已连接" : ide.installed ? "可用" : "未安装"}
                </text>
              </box>
            );
          }}
        </For>
      </box>

      <text fg={c.muted}>{"↑↓ 导航 · Enter 连接/断开 · 直接输入搜索 · Esc 返回"}</text>
    </box>
  );
}

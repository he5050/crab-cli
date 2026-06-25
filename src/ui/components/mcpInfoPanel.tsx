/**
 * McpInfoPanel
 *
 * 职责:
 *   - 展示 MCP 服务器连接状态和详细信息
 *   - 显示每个服务器的工具列表
 *   - 支持查看服务器详情和工具信息
 *
 * 模块功能:
 *   - 渲染 MCP 服务器列表(名称、状态、工具数量)
 *   - 支持双屏切换:服务器列表 / 工具详情
 *   - 键盘导航(上下箭头、回车查看、Esc 返回)
 *   - 状态图标展示(连接/断开/错误)
 *
 * 使用场景:
 *   - 用户需要查看 MCP 服务器连接状态时
 *   - 需要浏览某个服务器的可用工具时
 *   - 排查 MCP 连接问题时
 *
 * 边界:
 *   1. 服务器数据通过 props 传入，组件不管理连接逻辑
 *   2. 不处理实际的 MCP 连接操作，仅做展示
 *   3. 工具列表为只读，不支持调用
 *   4. 使用 useKeyboard 处理键盘事件
 *
 * 流程:
 *   1. 接收 MCP 服务器列表数据
 *   2. 渲染服务器列表，显示状态和工具数量
 *   3. 用户选择服务器后进入工具详情屏
 *   4. 工具详情屏显示该服务器的所有工具
 *   5. Esc 返回服务器列表或关闭面板
 */

import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { actionSelect, iconCustom, iconError, iconIdle, iconRunning } from "@/ui/utils/icon";

// ─── 类型 ──────────────────────────────────────────────────

interface McpServerInfo {
  name: string;
  status: "connected" | "disconnected" | "error";
  toolCount: number;
  tools: string[];
  error?: string;
}

// ─── Props ─────────────────────────────────────────────────

export interface McpInfoPanelProps {
  onClose: () => void;
  servers?: McpServerInfo[];
}

// ─── McpInfoPanel 组件 ─────────────────────────────────────

export function McpInfoPanel(props: McpInfoPanelProps) {
  const theme = useTheme();

  const [focusIndex, setFocusIndex] = createSignal(0);
  const [screen, setScreen] = createSignal<"servers" | "tools">("servers");
  const [selectedServer, setSelectedServer] = createSignal<McpServerInfo | null>(null);

  // 默认空服务器列表
  const servers = () => props.servers || [];

  // 服务器列表选项
  const serverOptions = createMemo(() => {
    const items = servers().map((server) => {
      const statusIcon = server.status === "connected" ? iconRunning : server.status === "error" ? iconError : iconIdle;
      const statusColor =
        server.status === "connected"
          ? theme.colors.success
          : server.status === "error"
            ? theme.colors.error
            : theme.colors.muted;

      return {
        label: `${statusIcon} ${server.name} — ${server.toolCount} 工具${server.error ? ` (${server.error})` : ""}`,
        server,
        statusColor,
        value: server.name,
      };
    });

    return [...items, { label: "← 返回", server: null as any, statusColor: theme.colors.muted, value: "__back__" }];
  });

  // 工具列表选项
  const toolOptions = createMemo(() => {
    const server = selectedServer();
    if (!server) {
      return [];
    }

    const tools = server.tools.map((tool) => ({
      label: `${iconCustom} ${tool}`,
      value: tool,
    }));

    return [...tools, { label: "← 返回服务器列表", value: "__back__" }];
  });

  const currentOptions = createMemo(() => (screen() === "servers" ? serverOptions() : toolOptions()));

  // ─── 键盘处理 ────────────────────────────────────────

  useKeyboard((event) => {
    if (event.name === "escape") {
      if (screen() === "tools") {
        setScreen("servers");
        setFocusIndex(0);
      } else {
        props.onClose();
      }
      return;
    }

    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(currentOptions().length - 1, i + 1));
      return;
    }

    if (event.name === "return" || event.name === "enter") {
      const idx = focusIndex();

      if (screen() === "servers") {
        const opt = serverOptions()[idx];
        if (!opt) {
          return;
        }
        if (opt.value === "__back__") {
          props.onClose();
        } else if (opt.server) {
          setSelectedServer(opt.server);
          setScreen("tools");
          setFocusIndex(0);
        }
      } else {
        const opt = toolOptions()[idx];
        if (!opt) {
          return;
        }
        if (opt.value === "__back__") {
          setScreen("servers");
          setFocusIndex(0);
        }
      }
    }
  });

  // ─── 渲染 ────────────────────────────────────────────

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box marginBottom={1}>
        <span style={{ fg: theme.colors.warning, "font-weight": "bold" }}>{"MCP 服务器"}</span>
        <text fg={theme.colors.muted}>{` — ${servers().length} 个服务器`}</text>
      </box>

      <Show when={servers().length === 0 && screen() === "servers"}>
        <box paddingLeft={1}>
          <text fg={theme.colors.muted}>{"暂无 MCP 服务器连接"}</text>
        </box>
      </Show>

      <box flexDirection="column" paddingLeft={1}>
        <For each={currentOptions()}>
          {(option, index) => {
            const isSelected = () => index() === focusIndex();
            return (
              <text
                fg={isSelected() ? theme.colors.text : theme.colors.muted}
                backgroundColor={isSelected() ? theme.colors.primary : undefined}
                {...({} as any)}
              >
                {`${isSelected() ? `${actionSelect} ` : "  "}${option.label}`}
              </text>
            );
          }}
        </For>
      </box>

      {/* 服务器详情 */}
      <Show when={screen() === "tools" && selectedServer()}>
        <box marginTop={1} paddingLeft={1}>
          <text fg={theme.colors.info}>
            {`${selectedServer()!.name} — ${selectedServer()!.toolCount} 工具 — ${selectedServer()!.status}`}
          </text>
        </box>
      </Show>

      <box marginTop={1}>
        <text fg={theme.colors.muted}>{"↑↓ 导航 · Enter 选择 · Esc 返回"}</text>
      </box>
    </box>
  );
}

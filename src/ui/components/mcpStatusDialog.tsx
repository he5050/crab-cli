/**
 * McpStatusDialog 组件
 *
 * 职责:
 *   - 显示 MCP 服务器连接状态弹窗
 *   - 展示所有 MCP 服务器的连接状态和工具数量
 *
 * 模块功能:
 *   - 显示 MCP 服务器列表，包括名称、状态、类型、工具数量
 *   - 五种状态显示:connected / connecting / disconnected / error / disabled
 *   - 显示连接统计:已连接数、错误数、总数
 *   - 显示错误信息(如有)
 *
 * 使用场景:
 *   - 用户需要查看 MCP 服务连接状态时
 *   - 需要排查 MCP 连接问题时
 *   - 需要了解可用工具数量时
 *
 * 边界:
 *   1. 状态图标:● 已连接 / ◐ 连接中 / ○ 未连接 / ✗ 错误 / — 禁用
 *   2. 仅显示状态，不支持在弹窗内切换启用/禁用
 *   3. 已连接服务显示工具数量
 *   4. 错误状态显示详细错误信息
 *
 * 流程:
 *   1. 接收 servers 列表数据
 *   2. 计算连接统计信息
 *   3. 渲染服务器列表和状态
 *   4. Esc 关闭弹窗
 */
import { For, Show, createMemo } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { DialogHeader, DialogOverlay } from "@/ui/components/dialogUi";
import { createStatusColorMap } from "@/ui/utils/statusColors";
import { iconError, iconIdle, iconRunning } from "@/ui/utils/icon";

interface McpServerEntry {
  name: string;
  state: "connected" | "connecting" | "disconnected" | "error" | "disabled";
  toolCount: number;
  type: "stdio" | "sse" | "http";
  enabled: boolean;
  error?: string;
}

interface McpStatusDialogProps {
  servers: McpServerEntry[];
  onToggle: (name: string) => void;
  onClose: () => void;
}

function stateIcon(state: McpServerEntry["state"]): string {
  switch (state) {
    case "connected": {
      return iconRunning;
    }
    case "connecting": {
      return iconRunning;
    }
    case "disconnected": {
      return iconIdle;
    }
    case "error": {
      return iconError;
    }
    case "disabled": {
      return "—";
    }
  }
}

function stateColor(state: McpServerEntry["state"], colors: any): string {
  return createStatusColorMap<McpServerEntry["state"]>(
    {
      connected: colors.success,
      connecting: colors.warning,
      disabled: colors.muted,
      disconnected: colors.muted,
      error: colors.error,
    },
    colors.muted,
  )(state);
}

export function McpStatusDialog(props: McpStatusDialogProps) {
  const theme = useTheme();

  const connectedCount = createMemo(() => props.servers.filter((s) => s.state === "connected").length);

  const errorCount = createMemo(() => props.servers.filter((s) => s.state === "error").length);

  return (
    <DialogOverlay onClose={props.onClose} size="large">
      <DialogHeader title="MCP 服务状态" />
      <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <text fg={theme.colors.muted}>
          {connectedCount()} 已连接
          <Show when={errorCount() > 0}>
            <span style={{ fg: theme.colors.error }}> · {errorCount()} 错误</span>
          </Show>
          {` · 共 ${props.servers.length} 个服务`}
        </text>
      </box>
      <box paddingLeft={1} paddingRight={1} flexDirection="column" maxHeight={20}>
        <Show when={props.servers.length === 0}>
          <text fg={theme.colors.muted}>没有配置 MCP 服务</text>
        </Show>
        <For each={props.servers}>
          {(server) => (
            <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={1}>
              <box flexDirection="row" gap={1}>
                <text fg={stateColor(server.state, theme.colors)}>{stateIcon(server.state)}</text>
                <text fg={server.enabled ? theme.colors.text : theme.colors.muted}>{server.name}</text>
                <text fg={theme.colors.muted}>({server.type})</text>
                <Show when={server.state === "connected"}>
                  <text fg={theme.colors.success}>{server.toolCount} 工具</text>
                </Show>
              </box>
              <Show when={server.error}>
                <box paddingLeft={2}>
                  <text fg={theme.colors.error}>{server.error}</text>
                </box>
              </Show>
            </box>
          )}
        </For>
      </box>
      <box paddingLeft={1} paddingRight={1} paddingTop={1}>
        <text fg={theme.colors.muted}>Esc 关闭</text>
      </box>
    </DialogOverlay>
  );
}

/**
 * DialogStatus
 *
 * 职责:
 *   - 显示 MCP 服务器连接状态
 *   - 显示 Agent / 模型信息
 *   - 显示配置摘要
 *   - 按 Esc 关闭
 *
 * 模块功能:
 *   - 显示 Agent 名称和模型信息
 *   - 列出 MCP 服务状态(已配置、已连接、错误、禁用)
 *   - 根据状态显示不同颜色指示器
 *   - 显示服务详情和错误信息
 *
 * 使用场景:
 *   - 查看当前会话的配置状态
 *   - 检查 MCP 服务连接情况
 *   - 诊断连接问题
 *
 * 边界:
 *   1. 仅显示传入的状态数据，不主动获取
 *   2. 空列表时显示占位文本
 *   3. 关闭操作由外部回调处理
 *
 * 流程:
 *   1. 接收 MCP 服务列表和 Agent 信息
 *   2. 渲染状态分区(Agent 信息、MCP 服务)
 *   3. 根据状态应用颜色样式
 */
import { For, Show } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { createStatusColorMap } from "@/ui/utils/statusColors";

interface StatusItem {
  name: string;
  status: string;
  detail?: string;
  error?: string;
}

interface StatusSection {
  label: string;
  items: StatusItem[];
  emptyText: string;
}

interface DialogStatusProps {
  /** MCP 服务列表 */
  mcpServers?: StatusItem[];
  /** Agent 名称 */
  agentName?: string;
  /** 模型名称 */
  modelName?: string;
  /** 关闭回调 */
  onClose: () => void;
}

function statusColor(status: string, colors: any): string {
  return createStatusColorMap<string>(
    {
      configured: colors.success,
      connected: colors.success,
      disabled: colors.muted,
      error: colors.error,
      failed: colors.error,
    },
    colors.text,
  )(status);
}

export function DialogStatus(props: DialogStatusProps) {
  const theme = useTheme();

  const sections: StatusSection[] = [
    {
      emptyText: "没有配置 MCP 服务",
      items: props.mcpServers ?? [],
      label: "MCP 服务",
    },
  ];

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.colors.text}>
          <b>状态</b>
        </text>
        <text fg={theme.colors.muted} onMouseUp={() => props.onClose()}>
          esc
        </text>
      </box>

      {/* Agent 信息 */}
      <Show when={props.agentName}>
        <box>
          <text fg={theme.colors.text}>Agent</text>
          <box flexDirection="row" gap={1}>
            <text fg={theme.colors.success}>•</text>
            <text fg={theme.colors.text} wrapMode="word">
              <b>{props.agentName}</b>
              <Show when={props.modelName}>
                <text fg={theme.colors.muted}> {props.modelName}</text>
              </Show>
            </text>
          </box>
        </box>
      </Show>

      {/* 分区列表 */}
      <For each={sections}>
        {(section) => (
          <Show
            when={section.items.length > 0}
            fallback={
              <box>
                <text fg={theme.colors.text}>{section.label}</text>
                <text fg={theme.colors.muted}>{section.emptyText}</text>
              </box>
            }
          >
            <box>
              <text fg={theme.colors.text}>
                {section.label} ({section.items.length})
              </text>
              <For each={section.items}>
                {(item) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={statusColor(item.status, theme.colors)}>•</text>
                    <text fg={theme.colors.text} wrapMode="word">
                      <b>{item.name}</b>
                      <Show when={item.detail}>
                        <text fg={theme.colors.muted}> {item.detail}</text>
                      </Show>
                      <Show when={item.error}>
                        <text fg={theme.colors.error}> {item.error}</text>
                      </Show>
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        )}
      </For>
    </box>
  );
}

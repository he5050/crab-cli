/**
 * 使用量面板
 *
 * 职责:
 *   - 显示 Token 使用量统计
 *   - 展示会话历史记录
 *
 * 模块功能:
 *   - 显示总输入 Token 数
 *   - 显示总输出 Token 数
 *   - 显示合并 Token 总数
 *   - 列出最近会话记录(日期、输入/输出 Token、模型)
 *
 * 使用场景:
 *   - 查看 API 使用情况
 *   - 监控 Token 消耗
 *   - 分析历史会话
 *
 * 边界:
 *   1. 仅显示传入的统计数据
 *   2. 最多显示最近 10 条会话记录
 *   3. 不处理数据持久化
 *
 * 流程:
 *   1. 接收使用统计数据
 *   2. 渲染总统计信息
 *   3. 渲染会话历史列表
 */
import { For, Show } from "solid-js";
import type { ThemeColors } from "@/ui/contexts/theme";

export interface UsageEntry {
  date: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  sessionCount: number;
}

interface UsagePanelProps {
  colors: ThemeColors;
  entries: UsageEntry[];
  totalInput: number;
  totalOutput: number;
}

export function UsagePanel(props: UsagePanelProps) {
  return (
    <box flexDirection="column" padding={1}>
      <text fg={props.colors.accent}>Token 使用量</text>

      <box marginTop={1} flexDirection="column">
        <text fg={props.colors.muted}>输入 Token 总数: </text>
        <text fg={props.colors.accent}>{props.totalInput.toLocaleString()}</text>
      </box>

      <box flexDirection="column">
        <text fg={props.colors.muted}>输出 Token 总数: </text>
        <text fg={props.colors.accent}>{props.totalOutput.toLocaleString()}</text>
      </box>

      <box flexDirection="column">
        <text fg={props.colors.muted}>合计: </text>
        <text fg={props.colors.text}>{(props.totalInput + props.totalOutput).toLocaleString()}</text>
      </box>

      <Show when={props.entries.length > 0}>
        <box marginTop={1} flexDirection="column">
          <text fg={props.colors.text}>最近会话:</text>
          <For each={props.entries.slice(0, 10)}>
            {(entry) => (
              <box paddingLeft={2}>
                <text fg={props.colors.muted}>{entry.date}</text>
                <text fg={props.colors.text}>
                  {" "}
                  in:{entry.inputTokens} out:{entry.outputTokens} ({entry.model})
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  );
}

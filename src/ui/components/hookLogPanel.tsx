/**
 * HookLogPanel
 *
 * 职责:
 *   - 订阅 HookExecuted 事件实时更新
 *   - 显示 Hook 名称、事件、执行状态、时长
 *   - 成功绿色 ✓，失败红色 ✗
 *
 * 模块功能:
 *   - 监听 HookExecuted 事件获取执行记录
 *   - 维护最近 N 条日志条目(默认50条)
 *   - 格式化事件名称(PreToolUse → pre_invoke 等)
 *   - 显示执行时长(毫秒或秒)
 *   - 错误时显示错误信息摘要
 *
 * 使用场景:
 *   - 调试 Hook 执行流程
 *   - 监控 Hook 性能和错误
 *   - 查看 Hook 执行历史
 *
 * 边界:
 *   1. 仅显示通过 HookExecuted 事件报告的日志
 *   2. 超过最大条目数时自动丢弃旧记录
 *   3. 界面最多显示最近 10 条记录
 *
 * 流程:
 *   1. 订阅 HookExecuted 事件
 *   2. 将新记录添加到列表并限制数量
 *   3. 渲染日志列表(状态图标 + 事件 + Hook名 + 时长)
 */
import { For, Show, createSignal, onCleanup } from "solid-js";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import type { ThemeColors } from "@/ui/contexts/theme";
import { iconLsp } from "@/ui/utils/icon";
import { inlineSuccessIcon } from "@/core/icons/iconDerived";

/** Hook 日志条目 */
export interface HookLogEntry {
  hookName: string;
  event: string;
  success: boolean;
  decision: string;
  duration: number;
  error?: string;
  timestamp: number;
}

/** Hook 日志面板 Props */
export interface HookLogPanelProps {
  colors: ThemeColors;
  /** 最大显示条目数 */
  maxEntries?: number;
}

/** Hook 日志面板 */
export function HookLogPanel(props: HookLogPanelProps) {
  const eventBus = useEventBus();
  const maxEntries = props.maxEntries ?? 50;
  const [entries, setEntries] = createSignal<HookLogEntry[]>([]);

  // 订阅 HookExecuted 事件
  const unsub = eventBus.subscribe(AppEvent.HookExecuted, (payload) => {
    const { hookName, event, success, decision, duration, error } = payload.properties;
    setEntries((prev) => {
      const next = [
        ...prev,
        {
          decision,
          duration,
          error,
          event,
          hookName,
          success,
          timestamp: Date.now(),
        },
      ];
      return next.slice(-maxEntries);
    });
  });
  onCleanup(() => unsub());

  const formatEvent = (event: string) => {
    switch (event) {
      case "PreToolUse": {
        return "pre_invoke";
      }
      case "PostToolUse": {
        return "post_invoke";
      }
      case "Notification": {
        return "notify";
      }
      case "Stop": {
        return "停止";
      }
      case "SubAgentStart": {
        return "subagent_start";
      }
      case "SubAgentStop": {
        return "subagent_stop";
      }
      case "SessionStart": {
        return "session_start";
      }
      case "SessionEnd": {
        return "session_end";
      }
      default: {
        return event;
      }
    }
  };

  const statusIcon = (success: boolean) => inlineSuccessIcon(success);
  const statusColor = (success: boolean) => (success ? props.colors.success : props.colors.error);

  const durationStr = (ms: number) => {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <box flexDirection="column" paddingX={1} gap={0}>
      <text fg={props.colors.primary}>{iconLsp} Hook 日志</text>
      <box height={1}>
        <text fg={props.colors.border}>──────────────────────────</text>
      </box>
      <Show when={entries().length === 0}>
        <text fg={props.colors.muted}>暂无 Hook 执行记录</text>
      </Show>
      <For each={entries().slice(-10).toReversed()}>
        {(entry) => (
          <box flexDirection="row">
            <text fg={statusColor(entry.success)}>{statusIcon(entry.success)} </text>
            <text fg={props.colors.accent}>[{formatEvent(entry.event)}]</text>
            <text fg={props.colors.text}> {entry.hookName} </text>
            <text fg={props.colors.muted}>({durationStr(entry.duration)})</text>
            <Show when={entry.error}>
              <text fg={props.colors.error}> {entry.error!.slice(0, 40)}</text>
            </Show>
          </box>
        )}
      </For>
    </box>
  );
}

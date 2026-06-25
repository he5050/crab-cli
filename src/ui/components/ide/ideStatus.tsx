/**
 * [IDE 状态指示器]
 *
 * 职责:
 *   - 订阅 IDE 连接/断开事件
 *   - 显示连接状态图标和 VSCode 信息
 *   - 显示当前活动文件名
 *
 * 模块功能:
 *   - IDEStatusBar 组件:渲染状态栏中的 IDE 状态
 *   - 连接状态管理:connected/connecting/error/disconnected
 *   - 活动文件追踪:显示当前编辑的文件名
 *   - 状态图标映射:根据状态显示不同颜色和图标
 *
 * 使用场景:
 *   - TUI 状态栏显示 VSCode 连接状态
 *   - 需要实时查看 IDE 连接情况的场景
 *   - 需要追踪当前活动文件的场景
 *   - IDE 插件功能的状态反馈
 *
 * 边界:
 *   1. 仅在状态非 disconnected 时显示内容
 *   2. 依赖 vscodeConnection 获取连接状态和上下文
 *   3. 活动文件名从完整路径中提取文件名部分
 *   4. 连接断开时清空端口和活动文件信息
 *
 * 流程:
 *   1. 组件挂载时订阅 IDEConnected/IDEDisconnected 事件
 *   2. 订阅 vscodeConnection 的上下文更新获取活动文件
 *   3. 根据连接状态更新图标颜色(绿/黄/红/灰)
 *   4. 组件卸载时取消所有事件订阅
 */

import { Show, createSignal, onCleanup } from "solid-js";
import { useEventBus } from "@/ui/contexts/eventBus";
import { useTheme } from "@/ui/contexts/theme";
import { AppEvent } from "@bus";
import { vscodeConnection } from "@/ide/client";
import type { ConnectionStatus } from "@/ide/types";
import { connectionIcon } from "@/ui/utils/icon";

/**
 * IDE 连接状态片段 — 嵌入到 StatusBar 中。
 *
 * 显示格式:
 *   🟢 VSCode | 文件名.ts    (已连接)
 *   🔴 IDE 未连接             (断开)
 *   🔄 连接中...              (连接中)
 */
export function IDEStatusBar() {
  const eventBus = useEventBus();
  const theme = useTheme();
  const [status, setStatus] = createSignal<ConnectionStatus>(vscodeConnection.getStatus());
  const [activeFile, setActiveFile] = createSignal<string>("");

  // 订阅连接状态变更
  const unsubConnected = eventBus.subscribe(AppEvent.IDEConnected, () => {
    setStatus("connected");
  });
  onCleanup(() => unsubConnected());

  const unsubDisconnected = eventBus.subscribe(AppEvent.IDEDisconnected, () => {
    setStatus("disconnected");
  });
  onCleanup(() => unsubDisconnected());

  // 订阅编辑器上下文更新(获取活动文件名)
  const unsubContext = vscodeConnection.onContextUpdate((ctx) => {
    if (ctx.activeFile) {
      setActiveFile(ctx.activeFile.split(/[\\/]/).pop() ?? "");
    } else {
      setActiveFile("");
    }
  });
  onCleanup(() => unsubContext());

  const statusIcon = (): string => connectionIcon(status());

  const statusLabel = (): string => {
    switch (status()) {
      case "connected": {
        return activeFile() ? `VSCode:${activeFile()}` : "VSCode";
      }
      case "connecting": {
        return "连接中";
      }
      case "error": {
        return "错误";
      }
      case "disconnected": {
        return "";
      }
    }
  };

  const statusColor = (): string => {
    switch (status()) {
      case "connected": {
        return theme.colors.success;
      }
      case "connecting": {
        return theme.colors.warning;
      }
      case "error": {
        return theme.colors.error;
      }
      case "disconnected": {
        return theme.colors.muted;
      }
    }
  };

  return (
    <Show when={status() !== "disconnected"}>
      <text fg={statusColor()}>
        {statusIcon()} {statusLabel()}
      </text>
    </Show>
  );
}

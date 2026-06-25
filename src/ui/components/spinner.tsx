/**
 * Spinner 组件
 *
 * 职责:
 *   - 提供动画加载指示器，用于显示异步操作进行中
 *   - 支持自定义标签和颜色
 *
 * 模块功能:
 *   - 使用手动帧动画实现旋转效果(crab-cli 无 opentui-spinner 依赖)
 *   - 提供 SPINNER_FRAMES 帧序列供外部使用
 *   - 支持通过 props 自定义标签文本和颜色
 *
 * 使用场景:
 *   - 异步操作等待时的用户反馈
 *   - 数据加载、文件处理、网络请求等耗时操作
 *   - 需要轻量级加载指示器的场景
 *
 * 边界:
 *   1. 组件使用 setInterval 实现动画，需在 onCleanup 中清理
 *   2. 颜色默认使用主题色的 muted 色
 *   3. 帧动画间隔固定为 80ms
 *
 * 流程:
 *   1. 组件挂载时启动定时器，循环切换帧
 *   2. 组件卸载时清理定时器和 disposed 标志
 *   3. 渲染当前帧和可选标签
 */
import { Show, createSignal, onCleanup } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner(props: { label?: string; color?: string }) {
  const theme = useTheme();
  const color = () => props.color ?? theme.colors.muted;
  const [frame, setFrame] = createSignal(0);

  let disposed = false;
  const interval = setInterval(() => {
    if (disposed) {
      return;
    }
    setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
  }, 80);

  onCleanup(() => {
    disposed = true;
    clearInterval(interval);
  });

  return (
    <box flexDirection="row" gap={1}>
      <text fg={color()}>{SPINNER_FRAMES[frame()]}</text>
      <Show when={props.label}>
        <text fg={color()}>{props.label}</text>
      </Show>
    </box>
  );
}

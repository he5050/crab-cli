/**
 * BgPulse
 *
 * 职责:
 *   - 在 AI 处理中显示微妙的背景脉冲动画
 *   - 提供视觉反馈表示系统正在工作中
 *   - 支持颜色主题适配
 *
 * 模块功能:
 *   - 使用定时器切换背景色实现脉冲效果
 *   - 支持自定义脉冲颜色和动画速度
 *   - 提供 useBgPulse hook 供其他组件使用
 *   - 支持激活/停用状态控制
 *
 * 使用场景:
 *   - AI 生成回复时显示背景动画
 *   - 长时间操作时提供视觉反馈
 *   - 需要轻量级状态指示器时
 *
 * 边界:
 *   1. 使用 setInterval 实现简单闪烁，非 CSS 动画
 *   2. 背景色通过 rgba 实现半透明效果
 *   3. 组件卸载时自动清理定时器
 *   4. zIndex 设置为 -1 确保在内容下层
 *
 * 流程:
 *   1. 初始化时创建定时器切换 phase 状态
 *   2. 根据 phase 切换背景色实现脉冲效果
 *   3. active 为 false 时不渲染任何内容
 *   4. 组件卸载时清理定时器避免内存泄漏
 */
import { Show, createSignal, onCleanup } from "solid-js";
import { useKV } from "@/ui/contexts/kv";

interface BgPulseProps {
  /** 是否激活动画 */
  active: boolean;
  /** 脉冲颜色(默认使用 warning 色) */
  color?: string;
  /** 动画速度(ms)，默认 1200 */
  speed?: number;
}

/**
 * 获取脉冲背景色。
 * 在 OpenTUI 中，由于不支持 CSS 动画，我们通过信号切换实现简单的闪烁效果。
 */
export function useBgPulse(speed: number = 1200) {
  const [phase, setPhase] = createSignal(0);

  const timer = setInterval(() => {
    setPhase((p) => (p + 1) % 2);
  }, speed);

  onCleanup(() => clearInterval(timer));

  return { phase };
}

export function BgPulse(props: BgPulseProps) {
  // 检查 animations_enabled KV 配置，关闭时不渲染动画
  let animationsEnabled = true;
  try {
    const kv = useKV();
    const val = kv.get<boolean>("animations_enabled");
    animationsEnabled = val !== false;
  } catch {
    // KV context 不可用时默认启用
  }

  const { phase } = useBgPulse(props.speed ?? 1200);

  return (
    <Show when={props.active && animationsEnabled}>
      <box
        backgroundColor={phase() === 0 ? (props.color ?? "rgba(255,200,50,0.05)") : undefined}
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        zIndex={-1}
      />
    </Show>
  );
}

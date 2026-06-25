/**
 * FadeIn 组件 — 组件挂载时透明度 0→1 过渡动画。
 *
 * 职责:
 *   - 提供 createFadeIn() 工厂函数
 *   - 组件挂载时从透明度 0 渐变到 1
 *   - 使用 Solid createSignal + onMount 实现帧动画
 *   - 支持 animations_enabled 配置控制
 *
 * 模块功能:
 *   - createFadeIn: 创建淡入动画信号
 *   - FadeIn: 包裹子组件实现淡入效果
 *
 * 使用场景:
 *   - 消息列表新消息淡入
 *   - 弹窗/面板打开动画
 *   - 任何需要渐显效果的 UI 元素
 *
 * 边界:
 *   1. 使用 requestAnimationFrame 风格的 setInterval 帧动画
 *   2. 组件卸载时自动清理定时器
 *   3. animations_enabled 为 false 时直接显示(无动画)
 *
 * 流程:
 *   1. 组件挂载时 opacity=0
 *   2. onMount 启动帧动画逐帧增加 opacity
 *   3. 到达 opacity=1 时停止动画
 *   4. 组件卸载时清理定时器
 */
import { type JSX, type ParentProps, Show, createSignal, onCleanup, onMount } from "solid-js";
import { useKV } from "@/ui/contexts/kv";

/** 淡入动画配置 */
export interface FadeInOptions {
  /** 动画持续时间(ms)，默认 300 */
  duration?: number;
  /** 帧间隔(ms)，默认 16 */
  interval?: number;
  /** 是否启用动画(覆盖全局 animations_enabled) */
  enabled?: boolean;
}

/**
 * 创建淡入动画信号。
 *
 * 返回一个响应式 opacity 信号，从 0 渐变到 1。
 * 在组件卸载时自动清理定时器。
 *
 * @example
 * const opacity = createFadeIn({ duration: 500 });
 * return <text style={{ opacity: opacity() }}>Hello</text>;
 */
export function createFadeIn(options: FadeInOptions = {}): () => number {
  const duration = options.duration ?? 300;
  const interval = options.interval ?? 16;
  const [opacity, setOpacity] = createSignal(0);

  let timer: ReturnType<typeof setInterval> | null = null;
  const startTime = Date.now();

  onMount(() => {
    timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      setOpacity(progress);
      if (progress >= 1 && timer) {
        clearInterval(timer);
        timer = null;
      }
    }, interval);
  });

  onCleanup(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  return opacity;
}

/**
 * FadeIn 组件 — 包裹子元素实现淡入效果。
 *
 * 当 animations_enabled KV 配置为 false 时，直接显示子元素(无动画)。
 *
 * @example
 * <FadeIn duration={400}>
 *   <text>Hello World</text>
 * </FadeIn>
 */
export function FadeIn(props: ParentProps<FadeInOptions>): JSX.Element {
  let kv: ReturnType<typeof useKV> | undefined;
  try {
    kv = useKV();
  } catch {
    // KV context 不可用时默认启用动画
  }

  const animationsEnabled = () => {
    if (options.enabled !== undefined) return options.enabled;
    if (kv) {
      const val = kv.get<boolean>("animations_enabled");
      return val !== false;
    }
    return true;
  };

  const options = props;
  const opacity = createFadeIn({
    duration: options.duration,
    enabled: animationsEnabled() ? undefined : false,
    interval: options.interval,
  });

  return (
    <Show when={animationsEnabled()} fallback={props.children}>
      <box style={{ opacity: opacity() } as any}>{props.children}</box>
    </Show>
  );
}

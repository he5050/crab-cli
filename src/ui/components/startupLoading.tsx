/**
 * StartupLoading
 *
 * 职责:
 *   - 应用初始化时显示启动加载界面
 *   - 展示品牌 Logo 和加载动画
 *   - 显示加载状态消息
 *
 * 模块功能:
 *   - 渲染 Logo 和加载动画(Spinner)
 *   - 动态加载点动画(... 循环)
 *   - 支持自定义加载消息
 *   - 加载完成状态展示(✓ 就绪)
 *
 * 使用场景:
 *   - 应用启动时显示加载状态
 *   - 初始化配置和数据时
 *   - 需要展示品牌标识的加载过程
 *
 * 边界:
 *   1. 加载消息通过 props 传入
 *   2. 加载完成状态通过 done 属性控制
 *   3. 动画使用 setInterval 实现，组件卸载时自动清理
 *   4. 不处理实际的初始化逻辑，仅做展示
 *
 * 流程:
 *   1. 初始化时显示 Logo 和加载动画
 *   2. 启动定时器更新加载点动画
 *   3. 显示加载消息
 *   4. done 为 true 时显示完成状态
 *   5. 组件卸载时清理定时器
 */
import { Show, createSignal, onCleanup } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { Logo } from "@/ui/components/logo";
import { Spinner } from "@/ui/components/spinner";

interface StartupLoadingProps {
  /** 加载状态消息 */
  message?: string;
  /** 是否完成 */
  done?: boolean;
}

export function StartupLoading(props: StartupLoadingProps) {
  const theme = useTheme();
  const [dots, setDots] = createSignal(0);

  const timer = setInterval(() => {
    setDots((d) => (d + 1) % 4);
  }, 500);

  onCleanup(() => clearInterval(timer));

  const dotsStr = () => ".".repeat(dots());

  return (
    <box flexDirection="column" alignItems="center" flexGrow={1} paddingLeft={2} paddingRight={2}>
      <box flexGrow={1} minHeight={0} />
      <Show when={!props.done}>
        <Logo />
        <box height={2} />
        <Spinner label="" />
        <box height={1} />
        <text fg={theme.colors.muted}>
          {props.message ?? "初始化中"}
          {dotsStr()}
        </text>
      </Show>
      <Show when={props.done}>
        <Logo />
        <box height={1} />
        <text fg={theme.colors.success}>✓ 就绪</text>
      </Show>
      <box flexGrow={1} minHeight={0} />
    </box>
  );
}

/**
 * SubAgentDepthPanel 组件
 *
 * 职责:
 *   - 显示和配置子代理最大嵌套深度
 *   - 控制子代理的递归调用层级限制
 *
 * 模块功能:
 *   - 显示当前配置的子代理深度值
 *   - 提供深度配置说明(1-10，默认 3)
 *   - 支持通过 props 接收当前深度值
 *
 * 使用场景:
 *   - 需要限制子代理递归深度防止无限循环时
 *   - 需要调整子代理调用层级时
 *   - 查看当前子代理深度配置时
 *
 * 边界:
 *   1. 深度范围:1-10
 *   2. 默认值:3
 *   3. 当前为展示组件，深度调整通过外部 onDepthChange 回调
 *
 * 流程:
 *   1. 接收 props 中的当前深度值
 *   2. 显示当前深度配置
 *   3. 显示配置说明和范围提示
 */
import { createSignal } from "solid-js";
import type { ThemeColors } from "@/ui/contexts/theme";

interface SubAgentDepthPanelProps {
  colors: ThemeColors;
  currentDepth: number;
  onDepthChange?: (depth: number) => void;
}

export function SubAgentDepthPanel(props: SubAgentDepthPanelProps) {
  const [depth] = createSignal(props.currentDepth);

  return (
    <box flexDirection="column" padding={1}>
      <text fg={props.colors.accent}>子代理深度配置</text>
      <box marginTop={1}>
        <text fg={props.colors.muted}>当前最大派生深度: {depth()}</text>
      </box>
      <box marginTop={1}>
        <text fg={props.colors.muted}>控制子代理可嵌套的最大层级(1-10，默认 3)</text>
      </box>
    </box>
  );
}

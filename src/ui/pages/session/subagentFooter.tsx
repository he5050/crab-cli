/**
 * Subagent Footer 组件
 *
 * 职责:
 *   - 在子代理 Session 页底部显示子代理信息
 *   - 提供父子代理导航功能
 *   - 展示 Token 使用量统计
 *
 * 模块功能:
 *   - 显示子代理名称和索引(如 "Subagent (2 / 5)")
 *   - 显示 Token 使用量(上下文、成本)
 *   - 提供父级/上个/下个导航按钮
 *
 * 使用场景:
 *   - 子代理 Session 页面底部
 *   - 多层级代理嵌套时的导航
 *
 * 边界:
 *   1. 仅展示和导航，不处理代理逻辑
 *   2. 导航回调由父组件提供
 *   3. 支持悬停状态反馈
 *
 * 流程:
 *   1. 接收子代理信息和导航回调
 *   2. 渲染代理名称、索引、Token 信息
 *   3. 根据可用回调显示导航按钮
 */
import { Show, createSignal } from "solid-js";
import { BORDER_SUBTLE, SURFACE_HOVER, SURFACE_PANEL, TEXT_MUTED, TEXT_PRIMARY } from "@/ui/themes/sessionTokens";

interface SubagentFooterProps {
  label?: string;
  index?: number;
  total?: number;
  tokenUsage?: {
    context: string;
    cost?: string;
  };
  onParent?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export function SubagentFooter(props: SubagentFooterProps) {
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null);

  const label = () => props.label ?? "Subagent";
  const index = () => props.index ?? 0;
  const total = () => props.total ?? 0;

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        border={["left"]}
        borderColor={BORDER_SUBTLE}
        backgroundColor={SURFACE_PANEL}
        flexShrink={0}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexDirection="row" gap={1}>
            <text fg={TEXT_PRIMARY}>
              <b>{label()}</b>
            </text>
            <Show when={total() > 0}>
              <text fg={TEXT_MUTED}>
                ({index()} / {total()})
              </text>
            </Show>
            <Show when={props.tokenUsage}>
              <text fg={TEXT_MUTED}>
                {[props.tokenUsage!.context, props.tokenUsage!.cost].filter(Boolean).join(" · ")}
              </text>
            </Show>
          </box>
          <box flexDirection="row" gap={2}>
            <Show when={props.onParent}>
              <box
                onMouseOver={() => setHover("parent")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => props.onParent?.()}
                backgroundColor={hover() === "parent" ? SURFACE_HOVER : SURFACE_PANEL}
              >
                <text fg={TEXT_PRIMARY}>
                  父级 <span style={{ fg: TEXT_MUTED }}>↑</span>
                </text>
              </box>
            </Show>
            <Show when={props.onPrev}>
              <box
                onMouseOver={() => setHover("prev")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => props.onPrev?.()}
                backgroundColor={hover() === "prev" ? SURFACE_HOVER : SURFACE_PANEL}
              >
                <text fg={TEXT_PRIMARY}>
                  上个 <span style={{ fg: TEXT_MUTED }}>←</span>
                </text>
              </box>
            </Show>
            <Show when={props.onNext}>
              <box
                onMouseOver={() => setHover("next")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => props.onNext?.()}
                backgroundColor={hover() === "next" ? SURFACE_HOVER : SURFACE_PANEL}
              >
                <text fg={TEXT_PRIMARY}>
                  下个 <span style={{ fg: TEXT_MUTED }}>→</span>
                </text>
              </box>
            </Show>
          </box>
        </box>
      </box>
    </box>
  );
}

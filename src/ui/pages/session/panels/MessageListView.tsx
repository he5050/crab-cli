/**
 * 消息列表面板 — SessionInner 的消息区
 *
 * 职责:
 *   - 渲染空状态(FeedbackPanel + 模式提示)
 *   - 渲染消息列表(MessageItem 循环)
 *   - 渲染流式输出(StreamingOutput)
 *   - 渲染 BTW 旁路问答浮层
 *
 * 边界:
 *   1. 纯展示:所有交互由 props 传入
 *   2. 不管理消息状态，依赖 chat context
 *   3. 不处理滚动逻辑(scrollRef 由父组件持有)
 */
import { For, Show, createMemo } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { MouseButton, type ScrollBoxRenderable } from "@opentui/core";
import { FeedbackPanel } from "@/ui/components/statusFeedback";
import { BtwOverlay } from "@/ui/components/btwOverlay";
import { MessageItem, StreamingOutput } from "@/ui/pages/session/components/messages";
import { sessionMessageNodeId } from "@/ui/pages/session/components/sessionTimelineDialog";
import { SCROLLBAR_FOREGROUND, SCROLLBAR_TRACK, SURFACE_ROOT } from "@/ui/themes/sessionTokens";
import type { ExtendedThemeColors, ThemeColors } from "@/ui/contexts/theme";
import type { ChatMessage } from "@/ui/contexts/chat";
import { Selection } from "@/ui/utils/selection";
import { getScrollAcceleration } from "@/ui/utils/scrollAcceleration";
import { useEventBus } from "@/ui/contexts/eventBus";

export interface MessageListViewProps {
  scrollRef: (ref: ScrollBoxRenderable | null) => void;
  colors: ThemeColors;
  extended?: ExtendedThemeColors;
  messages: ChatMessage[];
  loading: boolean;
  streamingText: string;
  streamingReasoning: string;
  msgCount: () => number;
  sessionLabel: () => string;
  agentLabel: () => string;
  chatMode: () => string;
  yoloOverlay: () => boolean;
  conceal: () => boolean;
  showThinking: () => boolean;
  thinkingMode: () => "show" | "hide" | "auto";
  revertedCount: () => number;
  onReuseText: (text: string) => void;
  compact?: boolean;
}

export function MessageListView(props: MessageListViewProps) {
  const renderer = useRenderer();
  const eventBus = useEventBus();

  // 滚动加速器 — 根据连续滚动速度计算加速因子
  const scrollAccel = createMemo(() => getScrollAcceleration());

  /** 右键复制 — 触发选区复制 */
  const handleRightClick = () => {
    Selection.copy(renderer, undefined, eventBus);
  };

  return (
    <scrollbox
      ref={props.scrollRef}
      flexGrow={1}
      minHeight={0}
      backgroundColor={SURFACE_ROOT}
      stickyScroll={true}
      scrollAcceleration={scrollAccel()}
      verticalScrollbarOptions={{
        trackOptions: {
          backgroundColor: SCROLLBAR_TRACK,
          foregroundColor: SCROLLBAR_FOREGROUND,
        },
        visible: false,
      }}
      stickyStart="bottom"
      onMouseDown={(e) => {
        // 右键触发选区复制
        if (e.button === MouseButton.RIGHT) {
          handleRightClick();
        }
      }}
    >
      <box flexDirection="column" backgroundColor={SURFACE_ROOT}>
        <Show when={props.revertedCount() > 0}>
          <box flexDirection="row" paddingLeft={1} paddingBottom={0}>
            <text fg={props.colors.warning}>
              <span style={{ bold: true }}>↶ </span>
              已 Revert {props.revertedCount()} 条消息 (Ctrl+Shift+U 恢复)
            </text>
          </box>
        </Show>
        <Show when={props.msgCount() === 0 && !props.loading}>
          <box flexDirection="column" paddingTop={2} paddingLeft={1}>
            <FeedbackPanel
              tone="empty"
              title={`新对话 - ${props.sessionLabel()}`}
              message={props.compact ? "输入消息开始对话" : "输入消息开始对话"}
              hint={
                props.compact
                  ? undefined
                  : `Build · ${props.agentLabel()} · esc 中断 · /mcp 服务 · /agents 切换 Agent · /plan 计划 · /team 团队 · /yolo 自动执行`
              }
              width={props.compact ? 60 : 76}
            />
            <box height={1} />
            <Show when={props.chatMode() !== "chat"}>
              <text fg={props.colors.warning}>
                <span style={{ bold: true }}>▸ </span>模式: {props.chatMode()}
                <Show when={props.yoloOverlay()}>
                  <span style={{ fg: props.colors.error }}> +YOLO</span>
                </Show>
              </text>
              <box height={1} />
            </Show>
          </box>
        </Show>

        <For each={props.messages}>
          {(msg) => (
            <box id={sessionMessageNodeId(msg.id)} flexDirection="column" flexShrink={0}>
              <MessageItem
                msg={msg}
                colors={props.colors}
                extended={props.extended}
                streaming={props.loading}
                conceal={props.conceal()}
                thinkingMode={props.thinkingMode()}
                onReuseText={props.onReuseText}
              />
            </box>
          )}
        </For>

        <StreamingOutput
          colors={props.colors}
          extended={props.extended}
          streamingText={props.streamingText}
          streamingReasoning={props.streamingReasoning}
          loading={props.loading}
          conceal={props.conceal()}
          thinkingMode={props.thinkingMode()}
        />

        <BtwOverlay colors={props.colors} />
      </box>
    </scrollbox>
  );
}

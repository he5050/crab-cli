/**
 * PendingMessages
 *
 * 职责:
 *   - 显示排队等待发送的消息预览
 *   - 显示图片附件提示
 *   - 支持 ESC 取消提示
 *
 * 模块功能:
 *   - 显示待发送消息列表
 *   - 标记当前正在处理的消息
 *   - 格式化显示消息添加时间
 *   - 格式化显示图片附件大小
 *   - 支持取消单个消息或全部取消
 *   - 提供简洁版组件用于紧凑布局
 *
 * 使用场景:
 *   - 当用户快速输入多条消息时显示队列
 *   - 在对话界面中作为待发送提示
 *   - 状态栏显示待发送消息数量
 *
 * 边界:
 *   1. 仅显示消息预览，不处理实际发送逻辑
 *   2. 消息内容超过 100 字符时截断显示
 *   3. 已处理的消息显示为半透明
 *
 * 流程:
 *   1. 接收待处理消息列表
 *   2. 渲染消息列表(序号 + 时间 + 内容预览)
 *   3. 显示图片附件信息
 *   4. 处理取消操作
 */
import { For, Show } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { formatBytes } from "@/core/utilities/textUtils";
import { actionExpand, actionImage, iconLoading } from "@/ui/utils/icon";

/** 待处理消息项 */
export interface PendingMessage {
  /** 消息 ID */
  id: string;
  /** 消息内容 */
  content: string;
  /** 图片附件 */
  images?: {
    name: string;
    size: number;
  }[];
  /** 添加时间 */
  addedAt: number;
}

/** 组件属性 */
export interface PendingMessagesProps {
  /** 待处理消息列表 */
  messages: PendingMessage[];
  /** 当前正在处理的消息索引 */
  processingIndex?: number;
  /** 取消回调 */
  onCancel?: (id: string) => void;
  /** 取消全部回调 */
  onCancelAll?: () => void;
}

/**
 * 待处理消息组件。
 */
export function PendingMessages(props: PendingMessagesProps) {
  const theme = useTheme();
  const { colors } = theme;

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div
      style={{
        "border-color": colors.warning,
        "border-left": true,
        "margin-y": 1,
        padding: "0 1",
      }}
    >
      {/* 标题 */}
      <div
        style={{
          "align-items": "center",
          display: "flex",
          "justify-content": "space-between",
        }}
      >
        <div style={{ "align-items": "center", display: "flex", gap: 1 }}>
          <span style={{ color: colors.warning }}>{iconLoading}</span>
          <span style={{ color: colors.text, "font-weight": "bold" }}>待发送消息 ({props.messages.length})</span>
        </div>

        <Show when={props.onCancelAll}>
          <button
            onClick={props.onCancelAll}
            style={{
              color: colors.muted,
              cursor: "pointer",
              "font-size": "small",
            }}
          >
            [全部取消]
          </button>
        </Show>
      </div>

      {/* 消息列表 */}
      <div style={{ "margin-top": 1 }}>
        <For each={props.messages}>
          {(msg, index) => (
            <div
              style={{
                "border-color": index() === props.processingIndex ? colors.primary : "transparent",
                "border-left": index() === props.processingIndex,
                "margin-y": 1,
                opacity: index() < (props.processingIndex ?? 0) ? 0.5 : 1,
                padding: "0 1",
              }}
            >
              {/* 消息头部 */}
              <div
                style={{
                  "align-items": "center",
                  display: "flex",
                  "justify-content": "space-between",
                }}
              >
                <div style={{ "align-items": "center", display: "flex", gap: 1 }}>
                  <span style={{ color: colors.muted, "font-size": "small" }}>#{index() + 1}</span>

                  <Show when={index() === props.processingIndex}>
                    <span style={{ color: colors.primary }}>{actionExpand}</span>
                  </Show>

                  <span style={{ color: colors.muted, "font-size": "small" }}>{formatTime(msg.addedAt)}</span>
                </div>

                <Show when={props.onCancel && index() >= (props.processingIndex ?? 0)}>
                  <button
                    onClick={() => props.onCancel?.(msg.id)}
                    style={{
                      color: colors.muted,
                      cursor: "pointer",
                      "font-size": "small",
                    }}
                  >
                    [取消]
                  </button>
                </Show>
              </div>

              {/* 消息内容预览 */}
              <div
                style={{
                  color: colors.text,
                  "margin-top": 1,
                  "white-space": "pre-wrap",
                  "word-break": "break-word",
                }}
              >
                {msg.content.length > 100 ? `${msg.content.slice(0, 100)}...` : msg.content}
              </div>

              {/* 图片附件 */}
              <Show when={msg.images && msg.images.length > 0}>
                <div
                  style={{
                    display: "flex",
                    "flex-wrap": "wrap",
                    gap: 1,
                    "margin-top": 1,
                  }}
                >
                  <For each={msg.images}>
                    {(img) => (
                      <span
                        style={{
                          "background-color": colors.background,
                          color: colors.accent,
                          "font-size": "small",
                          padding: "0 1",
                        }}
                      >
                        {actionImage} {img.name} ({formatBytes(img.size)})
                      </span>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* 提示 */}
      <div
        style={{
          "border-color": colors.border,
          "border-top": true,
          color: colors.muted,
          "font-size": "small",
          "margin-top": 1,
          "padding-top": 1,
        }}
      >
        按 ESC 取消当前消息
      </div>
    </div>
  );
}

/**
 * 简洁版待处理消息(用于紧凑布局)。
 */
export function PendingMessagesCompact(props: Pick<PendingMessagesProps, "messages" | "processingIndex">) {
  const theme = useTheme();
  const { colors } = theme;

  const pendingCount = () => {
    const idx = props.processingIndex ?? 0;
    return Math.max(0, props.messages.length - idx);
  };

  return (
    <Show when={pendingCount() > 0}>
      <div
        style={{
          "align-items": "center",
          color: colors.warning,
          display: "flex",
          "font-size": "small",
          gap: 1,
        }}
      >
        <span>{iconLoading}</span>
        <span>待发送: {pendingCount()}</span>
      </div>
    </Show>
  );
}

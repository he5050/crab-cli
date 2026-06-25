/**
 * 会话时间线对话框 — 展示用户消息时间
 *
 * 职责:
 *   - 展示用户消息时间线
 *   - 移动高亮时跳转到对应消息
 *   - 提供消息操作面板(复用、复制)
 *
 * 模块功能:
 *   - SESSION_TIMELINE_NODE_PREFIX: 时间线节点前缀
 *   - TimelineEntry: 时间线条目类型
 *   - sessionMessageNodeId: 生成消息节点 ID
 *   - getTimelineMessageText: 提取消息文本
 *   - buildTimelineEntries: 构建时间线条目列表
 *   - buildTimelineOptions: 构建时间线选项
 *   - SessionTimelineDialog: 时间线对话框组件
 *
 * 使用场景:
 *   - 消息时间线导航
 *   - 消息快速跳转
 *   - 消息复用和复制
 *
 * 边界:
 * 1. 只处理 role 为 "user" 的消息
 * 2. 时间线按逆序排列(最新在前)
 * 3. Enter 进入消息操作面板
 *
 * 流程:
 * 1. 暂无(这是 UI 组件，无特定执行流程)
 */
import { createMemo, createSignal } from "solid-js";
import { useEventBus } from "@/ui/contexts/eventBus";
import { AppEvent } from "@bus";
import { DialogSelect, type SelectOption } from "@/ui/components/dialogSelect";
import { copyWithToast } from "@/ui/utils/clipboard";
import type { ChatMessage } from "@/ui/contexts/chat";

export const SESSION_TIMELINE_NODE_PREFIX = "session-message";

export interface TimelineEntry {
  id: string;
  text: string;
  createdAt?: number;
  index: number;
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized || "(empty message)";
  }
  return `${normalized.slice(0, max - 1)}…`;
}

function formatTime(ts?: number): string {
  if (!ts) {
    return "";
  }
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function sessionMessageNodeId(messageID: string): string {
  return `${SESSION_TIMELINE_NODE_PREFIX}-${messageID}`;
}

export function getTimelineMessageText(message: ChatMessage): string {
  if (message.content.trim()) {
    return message.content.trim();
  }
  const textParts = message.parts?.filter((part) => part.type === "text") ?? [];
  return textParts
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function buildTimelineEntries(messages: ChatMessage[]): TimelineEntry[] {
  return messages
    .map((message, index) => ({ index, message }))
    .filter(({ message }) => message.role === "user")
    .map(({ message, index }) => ({
      createdAt: (message as ChatMessage & { createdAt?: number }).createdAt,
      id: message.id,
      index,
      text: getTimelineMessageText(message),
    }))
    .toReversed();
}

function buildTimelineOptions(entries: TimelineEntry[]): SelectOption<TimelineEntry>[] {
  return entries.map((entry) => ({
    description: formatTime(entry.createdAt),
    keywords: [entry.id, entry.text],
    marker: symDot,
    meta: `#${entry.index + 1}`,
    title: truncate(entry.text, 72),
    value: entry,
  }));
}

export function SessionTimelineDialog(props: {
  messages: ChatMessage[];
  onClose: () => void;
  onMove: (messageID: string) => void;
  onReusePrompt: (text: string) => void;
}) {
  const eventBus = useEventBus();
  const [activeEntry, setActiveEntry] = createSignal<TimelineEntry | null>(null);
  const [highlightedId, setHighlightedId] = createSignal<string | null>(null);
  const entries = createMemo(() => buildTimelineEntries(props.messages));
  const timelineOptions = createMemo(() =>
    buildTimelineOptions(entries()).map((option) => ({
      ...option,
      current: option.value.id === highlightedId(),
    })),
  );
  const actionOptions = createMemo<SelectOption<"reuse" | "copy" | "back">[]>(() => [
    {
      description: "将消息文本放回输入框",
      title: "复用提示词",
      value: "reuse",
    },
    {
      description: "复制消息文本到剪贴板",
      title: "复制",
      value: "copy",
    },
    {
      description: "返回时间线",
      title: "返回",
      value: "back",
    },
  ]);

  const closeOrBack = () => {
    if (activeEntry()) {
      setActiveEntry(null);
      return;
    }
    props.onClose();
  };

  const runAction = (action: "reuse" | "copy" | "back") => {
    const entry = activeEntry();
    if (!entry || action === "back") {
      setActiveEntry(null);
      return;
    }
    if (action === "reuse") {
      props.onReusePrompt(entry.text);
      eventBus.publish(AppEvent.Toast, { message: "已将消息放回输入框", variant: "success" });
      props.onClose();
      return;
    }
    copyWithToast(entry.text, "已复制消息内容", eventBus);
    props.onClose();
  };

  if (activeEntry()) {
    return (
      <DialogSelect
        title="消息操作"
        options={actionOptions()}
        placeholder="选择消息操作..."
        footer="↑↓ 选择 · Enter 确认 · Esc 返回"
        onClose={closeOrBack}
        onSelect={(option) => runAction(option.value)}
      />
    );
  }

  return (
    <DialogSelect
      title="时间线"
      options={timelineOptions()}
      placeholder="搜索用户消息..."
      emptyText="没有可跳转的用户消息"
      footer="↑↓ 选择/跳转 · 输入搜索 · Enter 操作 · Esc 关闭"
      onHighlight={(option) => {
        if (option?.value.id) {
          setHighlightedId(option.value.id);
          props.onMove(option.value.id);
        }
      }}
      onClose={closeOrBack}
      onSelect={(option) => {
        setHighlightedId(option.value.id);
        props.onMove(option.value.id);
        setActiveEntry(option.value);
      }}
    />
  );
}

import { symDot } from "@/core/icons/icon";

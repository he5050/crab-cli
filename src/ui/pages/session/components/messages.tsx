/**
 * 消息渲染组件 — 用户消息、AI 消息、消息列表
 *
 * 职责:
 *   - 封装各类消息的渲染逻辑
 *   - 实现消息的 Part 分发(Thinking/Text/Tool)
 *   - 提供 Context 工具的分组折叠功能
 *
 * 模块功能:
 *   - UserMessagePart: 用户消息渲染组件
 *   - AssistantMessageView: AI 消息渲染组件
 *   - StreamingOutput: 流式输出区域渲染
 *   - MessageItem: 消息分发组件
 *   - PartView: Part 分发渲染函数
 *   - isContextToolPart: 判断是否为 context 类工具
 *   - findContextGroups: 查找连续的 context 工具分组
 *   - ContextToolGroupView: Context 工具分组渲染组件
 *
 * 使用场景:
 *   - 聊天会话页面的消息展示
 *   - 工具调用结果的渲染
 *   - 流式输出的实时显示
 *
 * 边界:
 * 1. 纯展示组件，依赖 ChatMessage 类型
 * 2. Context 工具折叠基于 read/glob/grep/list 工具识别
 * 3. 不处理消息的实际发送和接收逻辑
 *
 * 流程:
 * 1. 暂无(这是渲染组件库，无特定执行流程)
 */
import { For, Show, createSignal } from "solid-js";
import { FeedbackLine } from "@/ui/components/statusFeedback";
import type { ChatMessage, ChatMessagePart, ToolPart } from "@/ui/contexts/chat";
import type { ExtendedThemeColors, ThemeColors } from "@/ui/contexts/theme";
import {
  LeftBorder,
  TextPartView,
  ThinkingPartView,
  ToolPartView,
  createEnhancedSyntaxStyle,
  createSyntaxStyle,
  getRoleColors,
} from "@/ui/pages/session/components/messageParts";
import { SURFACE_PANEL_ALT, TEXT_MUTED, TEXT_PRIMARY } from "@/ui/themes/sessionTokens";
import { sanitizeMarkdownContent, simpleLatexToUnicode } from "@/ui/components/markdownRenderer";

const SESSION_MESSAGE_BG = SURFACE_PANEL_ALT;
const SESSION_TEXT_COLOR = TEXT_PRIMARY;
const SESSION_MUTED_COLOR = TEXT_MUTED;

// ─── Part 分发渲染 ─────────────────────────────────────────

function PartView(props: {
  part: ChatMessagePart;
  colors: ThemeColors;
  streaming: boolean;
  conceal?: boolean;
  thinkingMode?: "show" | "hide";
  onReuseText?: (text: string) => void;
}) {
  if (props.part.type === "thinking") {
    return (
      <ThinkingPartView
        part={props.part}
        colors={props.colors}
        streaming={props.streaming}
        conceal={props.conceal}
        thinkingMode={props.thinkingMode}
      />
    );
  }
  if (props.part.type === "text") {
    return (
      <TextPartView
        part={props.part}
        colors={props.colors}
        streaming={props.streaming}
        conceal={props.conceal}
        onReuse={props.onReuseText}
      />
    );
  }
  if (props.part.type === "tool") {
    return <ToolPartView part={props.part} colors={props.colors} />;
  }
  return <text fg={props.colors.muted} />;
}

// ─── Context 工具分组─────────────
// 将连续的 context 类工具(read/glob/grep/list)折叠为一个可折叠分组，
// 头部显示“正在收集上下文...”聚合信息。

/** 判断是否为 context 类工具 */
function isContextToolPart(part: ChatMessagePart): part is ToolPart {
  if (part.type !== "tool") {
    return false;
  }
  const t = part.tool.toLowerCase();
  return t === "read" || t === "glob" || t === "grep" || t === "list" || t === "cat";
}

/** 消息中连续 context 工具的起止索引 */
interface ContextGroup {
  start: number;
  end: number; // Exclusive
  parts: ToolPart[];
}

function findContextGroups(parts: ChatMessagePart[]): ContextGroup[] {
  const groups: ContextGroup[] = [];
  let i = 0;
  while (i < parts.length) {
    if (!isContextToolPart(parts[i]!)) {
      i++;
      continue;
    }
    const start = i;
    const groupParts: ToolPart[] = [];
    while (i < parts.length && isContextToolPart(parts[i]!)) {
      groupParts.push(parts[i] as ToolPart);
      i++;
    }
    groups.push({ end: i, parts: groupParts, start });
  }
  return groups;
}

/** Context 工具分组渲染(上下文收集折叠卡片) */
function ContextToolGroupView(props: { group: ContextGroup; colors: ThemeColors }) {
  const [expanded, setExpanded] = createSignal(false);
  const count = () => props.group.parts.length;

  // 聚合工具类型摘要
  const summary = () => {
    const toolCounts = new Map<string, number>();
    for (const p of props.group.parts) {
      toolCounts.set(p.tool, (toolCounts.get(p.tool) ?? 0) + 1);
    }
    return [...toolCounts.entries()].map(([tool, n]) => `${n}×${tool}`).join(", ");
  };

  return (
    <box paddingLeft={2} marginTop={1} flexShrink={0}>
      <box border={["left"]} borderColor={props.colors.secondary} customBorderChars={LeftBorder}>
        <box paddingTop={1} paddingBottom={1} paddingLeft={2} flexDirection="column" flexShrink={0}>
          {/* 分组标题行:可点击展开 */}
          <box flexDirection="row" flexShrink={0} onMouseUp={() => setExpanded((v) => !v)}>
            <text fg={props.colors.muted}>▸ </text>
            <text fg={props.colors.secondary}>
              <span style={{ bold: true }}>正在收集上下文</span>
            </text>
            <text fg={props.colors.muted}> ({count()} 个工具)</text>
            <text fg={props.colors.muted}> · {summary()}</text>
            <text fg={props.colors.muted}> {expanded() ? actionCollapse : "▸"}</text>
          </box>

          {/* 展开后:逐个渲染各工具卡片 */}
          <Show when={expanded()}>
            <For each={props.group.parts}>{(part) => <ToolPartView part={part} colors={props.colors} />}</For>
          </Show>

          {/* 未展开时:显示概览 */}
          <Show when={!expanded()}>
            <box marginTop={1} flexShrink={0}>
              <text fg={props.colors.muted}>
                <span style={{ italic: true }}>[{summary()}]</span>
              </text>
            </box>
          </Show>
        </box>
      </box>
    </box>
  );
}

// ─── 用户消息 ──────────────────────────────────────────────

export function UserMessagePart(props: { message: ChatMessage; colors: ThemeColors }) {
  const roleColors = () => getRoleColors(props.colors);
  // 对齐 AssistantMessageView:构造轻量 syntaxStyle 以满足 <markdown> 的 MarkdownProps 必填项。
  // UserMessagePart 不接收 extended 主题(用户消息不参与 extended 高亮)，故走基础路径。
  const syntaxStyle = () => createSyntaxStyle(props.colors);
  // 对用户消息做 Markdown 预处理:清理非法 HTML/LaTeX 残留，确保 <markdown> 渲染器
  // 不会把 raw 字符(** # ` 等)原样输出。对齐 AssistantMessageView 的内容净化策略，
  // 因为用户粘贴文本同样可能包含 shell 转义、HTML 片段或 LaTeX 公式。
  const renderedContent = () => simpleLatexToUnicode(sanitizeMarkdownContent(props.message.content));
  return (
    <box
      border={["left"]}
      borderColor={roleColors().user}
      customBorderChars={LeftBorder}
      marginTop={1}
      flexShrink={0}
      backgroundColor={SESSION_MESSAGE_BG}
    >
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor={SESSION_MESSAGE_BG}>
        <markdown
          content={renderedContent()}
          conceal={false}
          streaming={false}
          internalBlockMode="top-level"
          tableOptions={{ style: "grid" }}
          syntaxStyle={syntaxStyle() as any}
          fg={SESSION_TEXT_COLOR}
        />
      </box>
    </box>
  );
}

// ─── AI 消息 ───────────────────────────────────────────────

export function AssistantMessageView(props: {
  message: ChatMessage;
  colors: ThemeColors;
  extended?: ExtendedThemeColors;
  streaming: boolean;
  conceal?: boolean;
  thinkingMode?: "show" | "hide" | "auto";
  onReuseText?: (text: string) => void;
}) {
  const hasParts = () => (props.message.parts?.length ?? 0) > 0;
  const roleColors = () => getRoleColors(props.colors);
  const syntaxStyle = () =>
    props.extended ? createEnhancedSyntaxStyle(props.extended) : createSyntaxStyle(props.colors);

  // 对 parts 做上下文分组:连续的 context 工具(read/glob/grep/list)折叠为可折叠分组
  const contextGroups = () => {
    const parts = props.message.parts ?? [];
    return findContextGroups(parts);
  };

  // 渲染单个 part，替换 context 工具分组
  const renderPart = (part: ChatMessagePart) => {
    // 检查这个 part 是否落在某个 context group 内
    for (const group of contextGroups()) {
      const localIdx = group.parts.findIndex((p) => p === part);
      if (localIdx !== -1) {
        // 仅在 group 内第一个 part 位置渲染整个分组
        if (localIdx === 0) {
          return <ContextToolGroupView group={group} colors={props.colors} />;
        }
        return null; // Group 内后续 part 已被 ContextToolGroupView 渲染
      }
    }
    return (
      <PartView
        part={part}
        colors={props.colors}
        streaming={props.streaming}
        conceal={props.conceal}
        thinkingMode={props.thinkingMode}
        onReuseText={props.onReuseText}
      />
    );
  };

  return (
    <box marginTop={1} flexShrink={0} backgroundColor={SESSION_MESSAGE_BG}>
      <Show when={hasParts()}>
        <box
          border={["left"]}
          borderColor={roleColors().assistant}
          customBorderChars={LeftBorder}
          backgroundColor={SESSION_MESSAGE_BG}
        >
          <box paddingTop={1} paddingBottom={1} paddingLeft={1} flexShrink={0} backgroundColor={SESSION_MESSAGE_BG}>
            <For each={props.message.parts}>{(part) => renderPart(part)}</For>
          </box>
        </box>
      </Show>

      <Show when={!hasParts() && props.message.content.length > 0}>
        <box
          border={["left"]}
          borderColor={roleColors().assistant}
          customBorderChars={LeftBorder}
          backgroundColor={SESSION_MESSAGE_BG}
        >
          <box paddingTop={1} paddingBottom={1} paddingLeft={3} flexShrink={0} backgroundColor={SESSION_MESSAGE_BG}>
            <markdown
              content={props.message.content}
              conceal={true}
              streaming={props.streaming}
              internalBlockMode="top-level"
              tableOptions={{ style: "grid" }}
              syntaxStyle={syntaxStyle() as any}
              fg={SESSION_TEXT_COLOR}
            />
          </box>
        </box>
      </Show>

      <Show when={!hasParts() && props.message.content.length === 0 && props.streaming}>
        <box paddingLeft={3} marginTop={1}>
          <FeedbackLine tone="loading" message="正在生成回复..." />
        </box>
      </Show>

      <Show when={!props.streaming}>
        <box paddingLeft={2} paddingTop={1} flexShrink={0}>
          <text fg={SESSION_MUTED_COLOR}>
            <span style={{ fg: roleColors().assistant }}>▣ </span>
            <span style={{ fg: SESSION_TEXT_COLOR }}>AI</span>
            <span style={{ fg: SESSION_MUTED_COLOR }}> · </span>
            <span style={{ fg: SESSION_MUTED_COLOR }}>助手</span>
          </text>
        </box>
      </Show>
    </box>
  );
}

// ─── 流式输出区域 ──────────────────────────────────────────

export function StreamingOutput(props: {
  colors: ThemeColors;
  extended?: ExtendedThemeColors;
  streamingText: string;
  streamingReasoning: string;
  loading: boolean;
  conceal?: boolean;
  thinkingMode?: "show" | "hide" | "auto";
}) {
  const roleColors = () => getRoleColors(props.colors);
  const syntaxStyle = () =>
    props.extended ? createEnhancedSyntaxStyle(props.extended) : createSyntaxStyle(props.colors);

  return (
    <Show when={props.loading}>
      <box flexDirection="column" marginTop={1} flexShrink={0}>
        <Show when={props.streamingReasoning.length > 0}>
          <ThinkingPartView
            part={{ text: props.streamingReasoning, type: "thinking" }}
            colors={props.colors}
            streaming={true}
            conceal={props.conceal}
            thinkingMode={props.thinkingMode}
          />
        </Show>

        <Show when={props.streamingText.length > 0}>
          <box
            border={["left"]}
            borderColor={roleColors().assistant}
            customBorderChars={LeftBorder}
            backgroundColor={SESSION_MESSAGE_BG}
          >
            <box paddingTop={1} paddingBottom={1} paddingLeft={3} flexShrink={0} backgroundColor={SESSION_MESSAGE_BG}>
              <markdown
                content={props.streamingText}
                conceal={props.conceal ?? true}
                streaming={true}
                internalBlockMode="top-level"
                tableOptions={{ style: "grid" }}
                syntaxStyle={syntaxStyle() as any}
                fg={SESSION_TEXT_COLOR}
              />
            </box>
          </box>
        </Show>

        <Show when={props.streamingText.length === 0 && props.streamingReasoning.length === 0}>
          <box paddingLeft={3} marginTop={1}>
            <FeedbackLine tone="loading" message="正在生成回复..." />
          </box>
        </Show>
      </box>
    </Show>
  );
}

// ─── 消息分发 ──────────────────────────────────────────────

export function MessageItem(props: {
  msg: ChatMessage;
  colors: ThemeColors;
  extended?: ExtendedThemeColors;
  streaming: boolean;
  conceal?: boolean;
  thinkingMode?: "show" | "hide" | "auto";
  onReuseText?: (text: string) => void;
}) {
  const roleColors = () => getRoleColors(props.colors);
  if (props.msg.role === "user") {
    return <UserMessagePart message={props.msg} colors={props.colors} />;
  }
  if (props.msg.role === "assistant") {
    return (
      <AssistantMessageView
        message={props.msg}
        colors={props.colors}
        extended={props.extended}
        streaming={props.streaming}
        conceal={props.conceal}
        thinkingMode={props.thinkingMode}
        onReuseText={props.onReuseText}
      />
    );
  }
  if (props.msg.isError) {
    return (
      <box
        border={["left"]}
        borderColor={roleColors().error}
        customBorderChars={LeftBorder}
        marginTop={1}
        flexShrink={0}
        backgroundColor={SESSION_MESSAGE_BG}
      >
        <box paddingTop={1} paddingBottom={1} paddingLeft={2} backgroundColor={SESSION_MESSAGE_BG}>
          <FeedbackLine tone="error" message={props.msg.content} />
        </box>
      </box>
    );
  }
  if (props.msg.parts?.length) {
    return (
      <box paddingLeft={1} marginTop={1} flexShrink={0}>
        <For each={props.msg.parts}>{(part) => <PartView part={part} colors={props.colors} streaming={false} />}</For>
      </box>
    );
  }
  return (
    <box paddingLeft={4} paddingTop={1} flexShrink={0} backgroundColor={SESSION_MESSAGE_BG}>
      <text fg={SESSION_MUTED_COLOR}>{props.msg.content}</text>
    </box>
  );
}

import { actionCollapse } from "@/ui/utils/icon";

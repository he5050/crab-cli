/**
 * 消息 Part 渲染组件 — 渲染 Thinking/Text/Tool 三类消息 Part
 *
 * 职责:
 *   - 渲染 Thinking/Text/Tool 三类消息 Part
 *   - 提供 Session markdown/code 的统一语法高亮样式
 *   - 对正文里的 @agent 和文件路径做轻量高亮
 *
 * 模块功能:
 *   - getRoleColors: 根据主题色获取角色颜色映射
 *   - EmptyBorder: 空边框字符配置
 *   - LeftBorder: 左侧边框字符配置
 *   - createSyntaxStyle: 根据主题色生成语法高亮样式
 *   - createEnhancedSyntaxStyle: 从扩展主题色生成增强版语法高亮样式
 *   - defaultSyntaxStyle: 默认语法高亮样式(dark 默认色)
 *   - reasoningSummary: 提取 thinking 文本的摘要(标题+正文)
 *   - ThinkingPartView: Thinking Part 渲染组件
 *   - TextPartView: Text Part 渲染组件
 *   - ToolPartView: Tool Part 渲染组件
 *
 * 使用场景:
 *   - 聊天消息的渲染
 *   - 工具调用结果的展示
 *   - AI thinking 过程的显示
 *
 * 边界:
 * 1. 工具渲染已下沉到 `tools/toolRenderers.tsx`
 * 2. 本文件只保留消息 Part 分发入口
 * 3. 语法高亮样式依赖于 OpenTUI 核心库
 *
 * 流程:
 * 1. 暂无(这是渲染组件库，无特定执行流程)
 */
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { Spinner } from "@/ui/components/spinner";
import type { TextPart, ThinkingPart, ToolPart } from "@/ui/contexts/chat";
import type { ExtendedThemeColors, ThemeColors } from "@/ui/contexts/theme";
import { RGBA as CoreRGBA, SyntaxStyle as CoreSyntaxStyle } from "@opentui/core";
import { generateSyntax, generateSubtleSyntax } from "@/ui/themes/syntaxGenerator";
import { ToolPartRenderer } from "./tools/toolRenderers";
import { useEventBus } from "@/ui/contexts/eventBus";

// ─── 角色颜色(从主题色派生，确保 dark/light 都可读) ──────────

/** 根据主题色获取角色颜色映射 */
export function getRoleColors(colors: ThemeColors) {
  return {
    assistant: colors.success,
    error: colors.error,
    system: colors.muted,
    thinking: colors.muted,
    user: colors.info,
  };
}

const SESSION_TEXT_COLOR = "#f5f5f5";

// ─── 边框字符配置 ──────────────────────────────────────────

export const EmptyBorder = {
  bottomLeft: "",
  bottomRight: "",
  bottomT: "",
  cross: "",
  horizontal: " ",
  leftT: "",
  rightT: "",
  topLeft: "",
  topRight: "",
  topT: "",
  vertical: "",
};

export const LeftBorder = {
  ...EmptyBorder,
  vertical: "│",
};

/** 根据基础主题色动态生成语法高亮样式(降级版，使用基础色) */
export function createSyntaxStyle(colors: ThemeColors) {
  return CoreSyntaxStyle.fromStyles({
    comment: { fg: CoreRGBA.fromHex(colors.muted) },
    default: { fg: CoreRGBA.fromHex(colors.text) },
    function: { fg: CoreRGBA.fromHex(colors.primary) },
    keyword: { fg: CoreRGBA.fromHex(colors.secondary) },
    "markup.bold": { bold: true },
    "markup.heading.1": { bold: true, fg: CoreRGBA.fromHex(colors.info) },
    "markup.heading.2": { bold: true, fg: CoreRGBA.fromHex(colors.info) },
    "markup.heading.3": { bold: true, fg: CoreRGBA.fromHex(colors.secondary) },
    "markup.italic": { italic: true },
    "markup.list": { fg: CoreRGBA.fromHex(colors.primary) },
    "markup.raw": { fg: CoreRGBA.fromHex(colors.accent) },
    number: { fg: CoreRGBA.fromHex(colors.warning) },
    operator: { fg: CoreRGBA.fromHex(colors.accent) },
    punctuation: { fg: CoreRGBA.fromHex(colors.text) },
    string: { fg: CoreRGBA.fromHex(colors.success) },
    type: { fg: CoreRGBA.fromHex(colors.info) },
    variable: { fg: CoreRGBA.fromHex(colors.text) },
  });
}

/** 从扩展主题色生成增强版语法高亮样式(使用 generateSyntax) */
export function createEnhancedSyntaxStyle(extended: ExtendedThemeColors) {
  return generateSyntax(extended);
}

/** 从扩展主题色生成柔和版语法高亮样式(用于 reasoning) */
export function createSubtleSyntaxStyle(extended: ExtendedThemeColors) {
  return generateSubtleSyntax(extended);
}

/** 保留旧导出名，向后兼容(使用 dark 默认色) */
export const defaultSyntaxStyle = createSyntaxStyle({
  accent: "#e5c07b",
  background: "#282c34",
  border: "#3e4451",
  error: "#e06c75",
  info: "#61afef",
  muted: "#5c6370",
  primary: "#61afef",
  secondary: "#c678dd",
  success: "#98c379",
  text: "#abb2bf",
  warning: "#e5c07b",
});

// ─── Thinking Part 渲染 ───────────────

export function reasoningSummary(text: string) {
  const content = text.trim();
  const match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/);
  if (!match) {
    return { body: content, title: null as string | null };
  }
  return {
    body: content.slice(match[0].length).trimEnd(),
    title: match[1]!.trim(),
  };
}

function cleanReasoningText(text: string): string {
  return text.replace("[REDACTED]", "").trim();
}

function partStartedAt(part: ThinkingPart): number | undefined {
  const time = part.time as (ThinkingPart["time"] & { start?: number }) | undefined;
  return time?.startedAt ?? time?.start ?? part.startedAt;
}

function partEndedAt(part: ThinkingPart): number | undefined {
  const time = part.time as (ThinkingPart["time"] & { end?: number }) | undefined;
  return time?.endedAt ?? time?.end ?? part.endedAt;
}

function partDurationMs(part: ThinkingPart): number | undefined {
  const explicit = part.time?.durationMs;
  if (explicit !== undefined) {
    return explicit;
  }
  const start = partStartedAt(part);
  const end = partEndedAt(part);
  return start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m${rest > 0 ? ` ${rest}s` : ""}`;
}

function ReasoningHeader(props: {
  colors: ThemeColors;
  toggleable: boolean;
  open: boolean;
  done: boolean;
  title: string | null;
  duration?: string;
}) {
  const fg = () => (props.open ? props.colors.warning : props.colors.warning);
  return (
    <Switch>
      <Match when={!props.done}>
        <Spinner label={props.title ? `思考中: ${props.title}` : "思考中"} />
      </Match>
      <Match when={true}>
        <text fg={fg()} wrapMode="none">
          <Show when={props.toggleable}>
            <span>{props.open ? "- " : "+ "}</span>
          </Show>
          <span>思考</span>
          <Show when={props.title || props.duration}>
            <span>: </span>
          </Show>
          <Show when={props.title}>
            <span>{props.title}</span>
          </Show>
          <Show when={props.duration}>
            <span>
              {props.title ? " · " : ""}
              {props.duration}
            </span>
          </Show>
        </text>
      </Match>
    </Switch>
  );
}

export function ThinkingPartView(props: {
  part: ThinkingPart;
  colors: ThemeColors;
  streaming: boolean;
  conceal?: boolean;
  thinkingMode?: "show" | "hide" | "auto";
}) {
  const [expanded, setExpanded] = createSignal(false);
  const syntaxStyle = () => createSyntaxStyle(props.colors);
  const content = createMemo(() => cleanReasoningText(props.part.text));
  const summary = createMemo(() => reasoningSummary(content()));
  const isDone = createMemo(
    () => !props.streaming && (partEndedAt(props.part) !== undefined || props.part.endedAt !== undefined),
  );
  // 三态 Thinking: show=始终展开, hide=始终折叠, auto=有内容时展开
  const inMinimal = createMemo(() => {
    if (props.thinkingMode === "show") return false;
    if (props.thinkingMode === "hide") return true;
    // auto: 无内容时折叠(隐藏)，有内容时允许展开
    return content().length === 0;
  });
  const open = createMemo(() => !inMinimal() || expanded());
  const duration = createMemo(() => {
    const ms = partDurationMs(props.part);
    return isDone() && ms !== undefined ? formatDuration(ms) : undefined;
  });

  return (
    <Show when={content()}>
      <box paddingLeft={3} marginTop={1} flexDirection="column" flexShrink={0}>
        <box onMouseUp={() => inMinimal() && setExpanded((prev) => !prev)}>
          <ReasoningHeader
            colors={props.colors}
            toggleable={inMinimal()}
            open={open()}
            done={isDone()}
            title={summary().title}
            duration={duration()}
          />
        </box>

        <Show when={open() && summary().body}>
          <box paddingLeft={inMinimal() ? 2 : 0} marginTop={1}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntaxStyle() as any}
              content={summary().body}
              conceal={props.conceal ?? true}
              fg={props.colors.muted}
            />
          </box>
        </Show>
      </box>
    </Show>
  );
}

// ─── Text Part 高亮片段 ─────────────

interface HighlightSegment {
  text: string;
  kind: "agent" | "file" | "plain";
}

function highlightFg(kind: HighlightSegment["kind"], colors: ThemeColors): string {
  if (kind === "agent") {
    return colors.primary;
  }
  if (kind === "file") {
    return colors.info;
  }
  return SESSION_TEXT_COLOR;
}

function splitHighlights(text: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  const atAgent = /@([\w-]+(?:\/[\w./-]+)?)/g;
  const filePath =
    /(?<![`"'\w/\\])([\w./-]+\.(?:ts|tsx|js|jsx|json|yaml|yml|md|py|rs|go|java|cpp|c|h|sh|bash|toml|xml|html|css|scss))(?!["""'\w/\\])/g;
  const matches: { start: number; end: number; text: string; kind: HighlightSegment["kind"] }[] = [];

  const scanRegex = (re: RegExp, kind: HighlightSegment["kind"]) => {
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      matches.push({ end: match.index + match[0].length, kind, start: match.index, text: match[0] });
    }
  };

  scanRegex(atAgent, "agent");
  scanRegex(filePath, "file");
  matches.sort((a, b) => a.start - b.start);

  const merged: typeof matches = [];
  for (const match of matches) {
    const prev = merged[merged.length - 1];
    if (prev && match.start < prev.end) {
      continue;
    }
    merged.push(match);
  }

  let cursor = 0;
  for (const match of merged) {
    if (match.start > cursor) {
      segments.push({ kind: "plain", text: text.slice(cursor, match.start) });
    }
    segments.push({ kind: match.kind, text: match.text });
    cursor = match.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: "plain", text: text.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ kind: "plain", text }];
}

// ─── Text Part 渲染 ────────────────────────────────────────

function copyToClip(text: string, label = "已复制", eventBus?: import("@bus").EventBus): void {
  import("@/ui/utils/clipboard").then(({ copyWithToast }) => copyWithToast(text, label, eventBus)).catch(() => {});
}

export function TextPartView(props: {
  part: TextPart;
  colors: ThemeColors;
  streaming: boolean;
  conceal?: boolean;
  onReuse?: (text: string) => void;
}) {
  const eventBus = useEventBus();
  const syntaxStyle = () => createSyntaxStyle(props.colors);
  const content = () => props.part.text.trim();
  const needsHighlight = () => content().includes("@") || /\w+\.\w{1,10}/.test(content());
  const segments = () => splitHighlights(content());

  return (
    <Show when={content().length > 0}>
      <box paddingLeft={3} marginTop={1} flexShrink={0}>
        <Show
          when={needsHighlight()}
          fallback={
            <markdown
              content={content()}
              conceal={props.conceal ?? true}
              streaming={props.streaming}
              internalBlockMode="top-level"
              tableOptions={{ style: "grid" }}
              syntaxStyle={syntaxStyle() as any}
              fg={props.colors.text}
              bg={props.colors.background}
            />
          }
        >
          <text>
            <For each={segments()}>
              {(seg) => (
                <span
                  style={{
                    bold: seg.kind !== "plain",
                    fg: highlightFg(seg.kind, props.colors),
                  }}
                >
                  {seg.text}
                </span>
              )}
            </For>
          </text>
        </Show>
        <Show when={!props.streaming}>
          <box marginTop={1} flexDirection="row" gap={1} flexShrink={0}>
            <text fg={props.colors.muted} onMouseUp={() => copyToClip(content(), "已复制消息内容", eventBus)}>
              复制
            </text>
            <Show when={props.onReuse}>
              <text fg={props.colors.muted}>·</text>
              <text fg={props.colors.muted} onMouseUp={() => props.onReuse?.(content())}>
                复用
              </text>
            </Show>
          </box>
        </Show>
      </box>
    </Show>
  );
}

// ─── Tool Part 渲染 ────────────────────────────────────────

export function ToolPartView(props: { part: ToolPart; colors: ThemeColors }) {
  return <ToolPartRenderer part={props.part} colors={props.colors} />;
}

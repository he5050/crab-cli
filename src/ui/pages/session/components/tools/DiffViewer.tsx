/**
 * DiffViewer 组件 — 基于 OpenTUI 原生 <diff> 组件的代码差异查看器。
 *
 * 职责:
 *   - 使用 OpenTUI 原生 <diff> 组件渲染代码差异
 *   - 支持 split/unified 视图模式
 *   - 支持语法高亮、行号、wrap 模式
 *   - auto 模式: 终端宽度 > 120 用 split，否则 unified
 *   - 主题色映射(添加/删除/上下文行颜色)
 *
 * 模块功能:
 *   - DiffViewer: diff 渲染组件
 *   - resolveDiffView: 根据终端宽度和配置解析视图模式
 *
 * 使用场景:
 *   - 工具调用 diff 展示(Edit/Write/ApplyPatch)
 *   - 会话 diff 展示
 *   - 代码审查
 *
 * 边界:
 *   1. 优先使用传入的 unified diff 字符串
 *   2. 依赖 OpenTUI <diff> 组件的语法高亮能力
 *   3. auto 模式下终端宽度 > 120 才启用 split
 *
 * 流程:
 *   1. 接收 diff 字符串和配置
 *   2. 解析视图模式(auto → split/unified)
 *   3. 映射主题色到 diff 组件 props
 *   4. 渲染 OpenTUI <diff> 组件
 */
import { Show, createMemo, createSignal } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type { ExtendedThemeColors, ThemeColors } from "@/ui/contexts/theme";
import type { SyntaxStyle } from "@opentui/core";
import { useKV } from "@/ui/contexts/kv";
import { DIFF_WRAP_MODE_KEY } from "@/ui/pages/pluginDiffModel";

// ─── Props 类型 ──────────────────────────────────────────────

export interface DiffViewerProps {
  /** Unified diff 格式字符串 */
  diff: string;
  /** 文件名(用于推断语言类型) */
  filetype?: string;
  /** 视图模式:split/unified/auto */
  view?: "split" | "unified" | "auto";
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** wrap 模式 */
  wrapMode?: "word" | "none";
  /** 语法高亮样式 */
  syntaxStyle?: SyntaxStyle;
  /** 主题色 */
  colors: ThemeColors;
  /** 扩展主题色(用于 diff 颜色映射) */
  extended?: ExtendedThemeColors;
  /** 是否 conceal(隐藏语法标记) */
  conceal?: boolean;
}

// ─── 视图模式解析 ────────────────────────────────────────────

/** auto 模式下 split 视图的宽度阈值 */
const SPLIT_VIEW_WIDTH_THRESHOLD = 120;

/**
 * 根据终端宽度和配置解析视图模式。
 *
 * auto 模式: 终端宽度 > 120 用 split，否则 unified
 */
export function resolveDiffView(
  view: "split" | "unified" | "auto" | undefined,
  terminalWidth: number,
): "split" | "unified" {
  if (view === "split") {
    return "split";
  }
  if (view === "unified") {
    return "unified";
  }
  // auto
  return terminalWidth > SPLIT_VIEW_WIDTH_THRESHOLD ? "split" : "unified";
}

// ─── DiffViewer 组件 ──────────────────────────────────────

export function DiffViewer(props: DiffViewerProps) {
  const dimensions = useTerminalDimensions();
  const kv = useKV();

  const resolvedView = createMemo(() => resolveDiffView(props.view ?? "auto", dimensions().width));

  // wrap mode: 从 KV 读取持久化值，默认 "word"
  const [wrapMode, setWrapMode] = createSignal<"word" | "none">(kv.get<"word" | "none">(DIFF_WRAP_MODE_KEY) ?? "word");

  const toggleWrapMode = () => {
    const next = wrapMode() === "word" ? "none" : "word";
    setWrapMode(next);
    kv.set(DIFF_WRAP_MODE_KEY, next);
  };

  // 暴露 toggleWrapMode 给父组件（通过 ref 或事件）
  // 使用全局事件让外部可以触发切换

  // diff 颜色映射 — 优先使用 extended，降级到基础色
  const diffColors = createMemo(() => {
    const ext = props.extended;
    const base = props.colors;
    if (ext) {
      return {
        addedBg: ext.diff.addedBg,
        addedSignColor: ext.diff.added,
        contextBg: ext.diff.contextBg,
        lineNumberFg: ext.diff.lineNumber,
        removedBg: ext.diff.removedBg,
        removedSignColor: ext.diff.removed,
      };
    }
    return {
      addedBg: base.success,
      addedSignColor: base.success,
      contextBg: base.background,
      lineNumberFg: base.muted,
      removedBg: base.error,
      removedSignColor: base.error,
    };
  });

  // 优先使用 props.wrapMode，否则使用 KV 持久化的 wrapMode
  const effectiveWrapMode = createMemo(() => props.wrapMode ?? wrapMode());

  return (
    <Show when={props.diff.length > 0}>
      <diff
        diff={props.diff}
        view={resolvedView()}
        filetype={props.filetype}
        syntaxStyle={props.syntaxStyle}
        showLineNumbers={props.showLineNumbers ?? true}
        wrapMode={effectiveWrapMode()}
        conceal={props.conceal ?? false}
        addedBg={diffColors().addedBg}
        removedBg={diffColors().removedBg}
        addedSignColor={diffColors().addedSignColor}
        removedSignColor={diffColors().removedSignColor}
        lineNumberFg={diffColors().lineNumberFg}
        contextBg={diffColors().contextBg}
      />
    </Show>
  );
}

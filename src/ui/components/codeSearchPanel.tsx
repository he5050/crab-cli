/**
 * CodeSearchPanel
 *
 * 职责:
 *   - 显示代码搜索结果(文件路径、匹配行号、上下文片段)
 *   - 支持按文件分组展示
 *   - 显示索引状态和进度
 *
 * 模块功能:
 *   - 渲染搜索结果列表(按文件分组)
 *   - 高亮显示匹配的关键词
 *   - 显示索引状态栏(索引进度、文件数、分块数)
 *   - 支持加载状态和错误提示
 *   - 点击结果触发预览回调
 *
 * 使用场景:
 *   - 用户搜索代码时展示结果
 *   - 查看代码索引状态
 *   - 浏览搜索结果并跳转到指定位置
 *
 * 边界:
 *   1. 搜索结果通过 props 传入，组件不管理搜索逻辑
 *   2. 实际的搜索请求通过 onSearch 回调触发
 *   3. 结果选择通过 onSelect 回调通知父组件
 *   4. 索引状态通过 indexStatus 传入展示
 *
 * 流程:
 *   1. 接收搜索结果和索引状态
 *   2. 按文件路径分组渲染结果
 *   3. 高亮显示匹配的关键词
 *   4. 显示索引状态栏
 *   5. 点击结果触发 onSelect 回调
 */
import { For, Show } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import type { ThemeColors } from "@/ui/contexts/theme";
import { iconLoading, iconSearch, iconSettings } from "@/ui/utils/icon";

/** 搜索结果条目 */
export interface SearchHit {
  /** 文件路径 */
  filePath: string;
  /** 行号 */
  line: number;
  /** 匹配文本 */
  text: string;
  /** 相似度分数(向量搜索时) */
  score?: number;
  /** 上下文行(前后各 2 行) */
  context?: { line: number; text: string }[];
}

/** 搜索面板属性 */
export interface CodeSearchPanelProps {
  /** 搜索查询 */
  query?: string;
  /** 搜索结果 */
  results?: SearchHit[];
  /** 索引状态 */
  indexStatus?: {
    totalFiles: number;
    indexedFiles: number;
    totalChunks: number;
    isIndexing: boolean;
  };
  /** 是否加载中 */
  loading?: boolean;
  /** 错误信息 */
  error?: string;
  /** 选中结果回调 */
  onSelect?: (hit: SearchHit) => void;
  /** 搜索请求回调 */
  onSearch?: (query: string) => void;
}

/** 按文件分组的结果 */
interface GroupedResults {
  filePath: string;
  hits: SearchHit[];
}

/**
 * 代码搜索面板组件。
 */
export function CodeSearchPanel(props: CodeSearchPanelProps) {
  const theme = useTheme();
  const { colors } = theme;

  // 按文件分组
  const grouped = (): GroupedResults[] => {
    const results = props.results ?? [];
    const map = new Map<string, SearchHit[]>();

    for (const hit of results) {
      const existing = map.get(hit.filePath);
      if (existing) {
        existing.push(hit);
      } else {
        map.set(hit.filePath, [hit]);
      }
    }

    return [...map.entries()].map(([filePath, hits]) => ({ filePath, hits }));
  };

  const totalHits = (): number => (props.results ?? []).length;
  const totalFiles = (): number => grouped().length;

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        overflow: "hidden",
        padding: "0 1",
      }}
    >
      {/* 标题 */}
      <div
        style={{
          "border-bottom": true,
          "border-color": colors.border,
          "margin-bottom": 1,
          padding: "0 1",
        }}
      >
        <span style={{ color: colors.accent }}>{iconSearch}</span>
        <span style={{ color: colors.text, "font-weight": "bold" }}> 代码搜索</span>
      </div>

      {/* 搜索输入 */}
      <div style={{ "margin-bottom": 1, padding: "0 1" }}>
        <span style={{ color: colors.muted }}>搜索: </span>
        <span style={{ color: colors.text }}>{props.query || "..."}</span>
      </div>

      <Show when={props.loading}>
        <div style={{ color: colors.muted, padding: "0 1" }}>搜索中...</div>
      </Show>

      <Show when={props.error}>
        <div style={{ color: colors.error, padding: "0 1" }}>{props.error}</div>
      </Show>

      <Show when={!props.loading && !props.error && grouped().length > 0}>
        <div style={{ flex: 1, "overflow-y": "auto" }}>
          <For each={grouped()}>
            {(group) => (
              <div style={{ "margin-bottom": 1 }}>
                {/* 文件路径 */}
                <div
                  style={{
                    color: colors.accent,
                    "font-weight": "bold",
                    padding: "0 1",
                  }}
                >
                  {group.filePath}
                </div>

                {/* 匹配行 */}
                <For each={group.hits}>
                  {(hit) => (
                    <div
                      style={{
                        color: colors.text,
                        padding: "0 2",
                        "white-space": "pre",
                      }}
                    >
                      <span style={{ color: colors.muted }}> L{hit.line}:</span>{" "}
                      <HighlightMatch text={hit.text} query={props.query ?? ""} theme={colors} />
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>

        {/* 统计 */}
        <div
          style={{
            "border-color": colors.border,
            "border-top": true,
            color: colors.muted,
            "margin-top": 1,
            padding: "0 1",
          }}
        >
          {totalHits()} 个匹配，分布在 {totalFiles()} 个文件中
        </div>
      </Show>

      <Show when={!props.loading && !props.error && (props.results ?? []).length === 0 && props.query}>
        <div style={{ color: colors.muted, padding: "0 1" }}>无搜索结果</div>
      </Show>

      {/* 索引状态 */}
      <Show when={props.indexStatus}>
        <IndexStatusBar status={props.indexStatus!} theme={colors} />
      </Show>
    </div>
  );
}

/**
 * 匹配高亮组件。
 */
function HighlightMatch(props: { text: string; query: string; theme: ThemeColors }) {
  if (!props.query) {
    return <span>{props.text}</span>;
  }

  const parts: { text: string; highlight: boolean }[] = [];
  const regex = new RegExp(`(${escapeRegex(props.query)})`, "gi");
  const segments = props.text.split(regex);

  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    if (regex.test(segment)) {
      parts.push({ highlight: true, text: segment });
    } else {
      parts.push({ highlight: false, text: segment });
    }
  }

  return (
    <span>
      <For each={parts}>
        {(part) => (
          <span style={part.highlight ? { color: props.theme.accent, "font-weight": "bold" } : {}}>{part.text}</span>
        )}
      </For>
    </span>
  );
}

/**
 * 索引状态栏。
 */
function IndexStatusBar(props: { status: NonNullable<CodeSearchPanelProps["indexStatus"]>; theme: ThemeColors }) {
  const statusText = () => {
    const s = props.status;
    if (s.isIndexing) {
      return `${iconLoading} 索引中... ${s.indexedFiles}/${s.totalFiles} 文件`;
    }
    return `${iconSettings} ${s.indexedFiles} 文件 | ${s.totalChunks} 分块`;
  };

  return (
    <div
      style={{
        "border-color": props.theme.border,
        "border-top": true,
        color: props.theme.muted,
        "margin-top": 1,
        padding: "0 1",
      }}
    >
      {statusText()}
    </div>
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

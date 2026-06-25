/**
 * GitLinePanel
 *
 * 职责:
 *   - 显示 Git blame 信息(每行的提交作者、时间、内容)
 *   - 显示文件提交历史
 *   - 支持选择特定行进行查看
 *
 * 模块功能:
 *   - 双 Tab 切换:Blame 视图 / 历史视图
 *   - Blame 视图:显示每行的提交信息(哈希、作者、时间、内容)
 *   - 历史视图:显示文件的所有提交记录
 *   - 点击行号选择特定行
 *   - 点击提交哈希查看提交详情
 *
 * 使用场景:
 *   - 代码审查时查看行级历史
 *   - 追踪某行代码的修改历史
 *   - 查看文件的提交记录
 *
 * 边界:
 *   1. blame 和 commit 数据通过 props 传入，组件不管理 Git 操作
 *   2. 行选择和提交查看通过回调通知父组件处理
 *   3. 不处理实际的 Git 命令执行
 *   4. 作者名称过长时截断显示(最多 10 字符)
 *
 * 流程:
 *   1. 接收 blame 信息和提交历史数据
 *   2. 默认显示 Blame 视图
 *   3. 用户可切换 Tab 查看历史视图
 *   4. 点击行号触发 onSelectLine 回调
 *   5. 点击提交哈希触发 onViewCommit 回调
 */
import { For, Show, createSignal } from "solid-js";
import { useTheme } from "@/ui/contexts/theme";
import { toolGit } from "@/ui/utils/icon";

/** Blame 信息 */
export interface BlameInfo {
  /** 提交哈希 */
  commitHash: string;
  /** 作者 */
  author: string;
  /** 提交时间 */
  timestamp: string;
  /** 行内容 */
  line: string;
  /** 行号 */
  lineNumber: number;
}

/** 面板属性 */
export interface GitLinePanelProps {
  /** 文件路径 */
  filePath: string;
  /** 当前行号 */
  currentLine?: number;
  /** Blame 信息 */
  blameInfo?: BlameInfo[];
  /** 提交历史 */
  commitHistory?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  }[];
  /** 选择行回调 */
  onSelectLine?: (lineNumber: number) => void;
  /** 查看提交回调 */
  onViewCommit?: (hash: string) => void;
  /** 关闭回调 */
  onClose?: () => void;
}

/**
 * Git 行选择面板。
 */
export function GitLinePanel(props: GitLinePanelProps) {
  const theme = useTheme();
  const { colors } = theme;
  const [activeTab, setActiveTab] = createSignal<"blame" | "history">("blame");
  const [selectedLine, setSelectedLine] = createSignal(props.currentLine ?? 1);

  const handleSelectLine = (lineNumber: number) => {
    setSelectedLine(lineNumber);
    props.onSelectLine?.(lineNumber);
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        padding: "0 1",
      }}
    >
      {/* 标题 */}
      <div
        style={{
          "align-items": "center",
          "border-bottom": true,
          "border-color": colors.border,
          display: "flex",
          "justify-content": "space-between",
          "margin-bottom": 1,
          padding: "0 1",
        }}
      >
        <div style={{ "align-items": "center", display: "flex", gap: 1 }}>
          <span style={{ color: colors.accent }}>{toolGit}</span>
          <span style={{ color: colors.text, "font-weight": "bold" }}>Git 行信息</span>
          <span style={{ color: colors.muted }}>{props.filePath}</span>
        </div>

        <Show when={props.onClose}>
          <button onClick={props.onClose} style={{ color: colors.muted, cursor: "pointer" }}>
            ✕
          </button>
        </Show>
      </div>

      {/* Tab 切换 */}
      <div
        style={{
          display: "flex",
          gap: 2,
          "margin-bottom": 1,
          padding: "0 1",
        }}
      >
        <button
          onClick={() => setActiveTab("blame")}
          style={{
            color: activeTab() === "blame" ? colors.primary : colors.muted,
            cursor: "pointer",
            "font-weight": activeTab() === "blame" ? "bold" : "normal",
          }}
        >
          Blame
        </button>
        <button
          onClick={() => setActiveTab("history")}
          style={{
            color: activeTab() === "history" ? colors.primary : colors.muted,
            cursor: "pointer",
            "font-weight": activeTab() === "history" ? "bold" : "normal",
          }}
        >
          历史
        </button>
      </div>

      {/* Blame 视图 */}
      <Show when={activeTab() === "blame"}>
        <div style={{ flex: 1, "overflow-y": "auto" }}>
          <Show
            when={props.blameInfo && props.blameInfo.length > 0}
            fallback={<div style={{ color: colors.muted, padding: "1 0" }}>暂无 blame 信息</div>}
          >
            <For each={props.blameInfo}>
              {(info) => (
                <div
                  onClick={() => handleSelectLine(info.lineNumber)}
                  style={{
                    "background-color": selectedLine() === info.lineNumber ? colors.background : "transparent",
                    cursor: "pointer",
                    padding: "0 1",
                  }}
                >
                  <div style={{ display: "flex", gap: 2 }}>
                    <span style={{ color: colors.muted, "min-width": 6 }}>{info.lineNumber}</span>
                    <span style={{ color: colors.accent, "min-width": 8 }}>{info.commitHash.slice(0, 7)}</span>
                    <span style={{ color: colors.warning, "min-width": 12 }}>{info.author.slice(0, 10)}</span>
                    <span style={{ color: colors.muted, "min-width": 10 }}>{info.timestamp}</span>
                  </div>
                  <div
                    style={{
                      color: colors.text,
                      "padding-left": 28,
                      "white-space": "pre",
                    }}
                  >
                    {info.line}
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>

      {/* 历史视图 */}
      <Show when={activeTab() === "history"}>
        <div style={{ flex: 1, "overflow-y": "auto" }}>
          <Show
            when={props.commitHistory && props.commitHistory.length > 0}
            fallback={<div style={{ color: colors.muted, padding: "1 0" }}>暂无提交历史</div>}
          >
            <For each={props.commitHistory}>
              {(commit) => (
                <div
                  onClick={() => props.onViewCommit?.(commit.hash)}
                  style={{
                    "border-color": colors.accent,
                    "border-left": true,
                    cursor: "pointer",
                    "margin-y": 1,
                    padding: "0 1",
                  }}
                >
                  <div style={{ color: colors.accent }}>
                    {commit.hash.slice(0, 7)} {commit.message.slice(0, 50)}
                  </div>
                  <div style={{ color: colors.muted, "font-size": "small" }}>
                    {commit.author} · {commit.date}
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>

      {/* 底部提示 */}
      <div
        style={{
          "border-color": colors.border,
          "border-top": true,
          color: colors.muted,
          "font-size": "small",
          "margin-top": 1,
          padding: "0 1",
        }}
      >
        ↑↓ 选择行 | Enter 查看提交 | Esc 关闭
      </div>
    </div>
  );
}

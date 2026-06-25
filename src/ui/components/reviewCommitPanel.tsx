/**
 * ReviewCommitPanel
 *
 * 职责:
 *   - 展示提交列表供用户审查
 *   - 支持查看提交详情和审查结果
 *   - 提供批准/要求修改操作
 *
 * 模块功能:
 *   - 渲染提交列表(哈希、消息、作者、变更统计)
 *   - 双模式切换:列表模式 / 详情模式
 *   - 显示审查结果统计(issues、critical、major、minor)
 *   - 键盘导航(上下箭头、回车查看详情)
 *   - 快捷操作(a 批准、r 要求修改)
 *
 * 使用场景:
 *   - 需要审查 AI 生成的代码提交时
 *   - 查看提交详细信息和审查结果时
 *   - 批准或要求修改提交时
 *
 * 边界:
 *   1. 提交数据通过 props 传入，组件不管理 Git 操作
 *   2. 审查操作通过回调函数通知父组件处理
 *   3. 不处理实际的代码审查逻辑，仅展示结果
 *   4. 提交消息过长时截断显示(最多 40 字符)
 *
 * 流程:
 *   1. 接收提交列表数据
 *   2. 渲染列表模式，显示提交概要
 *   3. 回车进入详情模式，显示完整信息
 *   4. 详情模式显示审查结果统计
 *   5. a 批准、r 要求修改，Esc 返回列表
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { useTheme } from "@/ui/contexts/theme";
import { iconError, iconSuccess, iconWarning, toolWrite } from "@/ui/utils/icon";
import { reviewedIcon } from "@/core/icons/iconDerived";

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  reviewed?: boolean;
  reviewResult?: { issues: number; critical: number; major: number; minor: number };
}

export interface ReviewCommitPanelProps {
  commits: CommitInfo[];
  selectedHash?: string;
  onSelectCommit?: (hash: string) => void;
  onApprove?: (hash: string) => void;
  onRequestChanges?: (hash: string) => void;
  onClose?: () => void;
}

export function ReviewCommitPanel(props: ReviewCommitPanelProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [detailMode, setDetailMode] = createSignal(false);

  const commits = () => props.commits;

  useKeyboard((event) => {
    if (detailMode()) {
      if (event.name === "escape") {
        setDetailMode(false);
        return;
      }
      if (event.name === "a") {
        const cm = commits()[focusIndex()];
        if (cm) {
          props.onApprove?.(cm.hash);
        }
        return;
      }
      if (event.name === "r") {
        const cm = commits()[focusIndex()];
        if (cm) {
          props.onRequestChanges?.(cm.hash);
        }
        return;
      }
      return;
    }

    if (event.name === "escape") {
      props.onClose?.();
      return;
    }
    if (event.name === "up") {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      setFocusIndex((i) => Math.min(commits().length - 1, i + 1));
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      const cm = commits()[focusIndex()];
      if (cm) {
        props.onSelectCommit?.(cm.hash);
        setDetailMode(true);
      }
    }
  });

  const currentCommit = createMemo(() => commits()[focusIndex()]);

  const shortHash = (hash: string) => hash.slice(0, 7);

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={c.text}>
          <b>{`${toolWrite} 审查提交`}</b>
        </text>
        <text fg={c.muted}>{"esc 返回"}</text>
      </box>

      {/* 详情模式 */}
      <Show when={detailMode() && currentCommit()}>
        <box flexDirection="column" gap={1}>
          <text fg={c.accent}>
            <b>{shortHash(currentCommit()!.hash)}</b>
          </text>
          <text fg={c.text}>{currentCommit()!.message}</text>
          <text fg={c.muted}>{`作者: ${currentCommit()!.author} · ${currentCommit()!.date}`}</text>
          <box flexDirection="row" gap={2}>
            <text fg={c.success}>{`+${currentCommit()!.additions}`}</text>
            <text fg={c.error}>{`-${currentCommit()!.deletions}`}</text>
            <text fg={c.muted}>{`${currentCommit()!.filesChanged} files`}</text>
          </box>
          <Show when={currentCommit()!.reviewResult}>
            <box flexDirection="row" gap={2}>
              <text fg={c.warning}>{`⚠ ${currentCommit()!.reviewResult!.issues} issues`}</text>
              <text fg={c.error}>{`${iconError} ${currentCommit()!.reviewResult!.critical}`}</text>
              <text fg={c.warning}>{`${iconWarning} ${currentCommit()!.reviewResult!.major}`}</text>
              <text fg={c.muted}>{`${iconSuccess} ${currentCommit()!.reviewResult!.minor}`}</text>
            </box>
          </Show>
          <text fg={c.muted}>{"a 批准 · r 要求修改 · Esc 返回列表"}</text>
        </box>
      </Show>

      {/* 列表模式 */}
      <Show when={!detailMode()}>
        <Show when={commits().length === 0}>
          <text fg={c.muted}>{"无待审查提交"}</text>
        </Show>
        <box flexDirection="column">
          <For each={commits()}>
            {(cm, index) => {
              const isFocused = () => index() === focusIndex();
              const icon = reviewedIcon(cm.reviewed ?? false);
              const iconFg = cm.reviewed ? c.success : c.warning;
              return (
                <box
                  flexDirection="row"
                  gap={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isFocused() ? c.primary : undefined}
                  {...({} as any)}
                >
                  <text fg={iconFg} flexShrink={0}>
                    {icon}
                  </text>
                  <text fg={c.accent} flexShrink={0}>
                    {shortHash(cm.hash)}
                  </text>
                  <text fg={isFocused() ? c.text : c.text} flexGrow={1}>
                    {cm.message.length > 40 ? `${cm.message.slice(0, 40)}...` : cm.message}
                  </text>
                  <text fg={c.success} flexShrink={0}>
                    {`+${cm.additions}`}
                  </text>
                  <text fg={c.error} flexShrink={0}>
                    {`-${cm.deletions}`}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
        <text fg={c.muted}>{"↑↓ 导航 · Enter 查看详情 · Esc 返回"}</text>
      </Show>
    </box>
  );
}

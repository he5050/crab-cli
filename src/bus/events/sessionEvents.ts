/**
 * 会话相关事件定义。
 *
 * 职责:
 *   - 集中定义所有与 Session 生命周期/状态相关的事件
 *   - 提供类型安全的事件载荷
 *
 * 事件清单:
 *   - SessionCreated: 会话创建
 *   - SessionSwitched: 会话切换
 *   - SessionListShow: 打开会话列表
 *   - HomePromptSubmit: Home 页 Prompt 提交
 *   - SessionSidebarToggle: 切换侧边栏
 *   - SessionToggleConceal: 切换内容隐藏
 *   - SessionUndoRequested / SessionRedoRequested: 撤销/重做
 *   - SessionQuickSwitchRequested: 快速切换
 *   - TimelineShow: 打开会话时间线弹窗
 *   - SessionStatusChanged: 会话状态变更
 *   - SessionShared: 会话分享
 *   - SessionSummarized: 会话摘要生成
 *   - SessionStatusUpdateRequested: 会话状态更新请求
 *   - SummaryRequested / SummaryGenerated: 摘要请求与生成
 *
 * 使用场景:
 *   - 业务模块订阅会话状态变更以更新 UI
 *   - 多模块间解耦通信(如 TUI、记录器、统计)
 */
import { defineEvent } from "../core";

export const SessionEvents = {
  /** Home 页 Prompt 提交(用于延迟发送到新创建的 Session) */
  HomePromptSubmit: defineEvent<{ message: string; sessionId: string }>("home.prompt.submit"),

  /** 会话创建 */
  SessionCreated: defineEvent<{ sessionId: string }>("session.created"),

  /** 会话列表对话框打开 */
  SessionListShow: defineEvent<Record<string, never>>("session.list.show"),

  /** 快速切换 Session */
  SessionQuickSwitchRequested: defineEvent<{ slot: number }>("session.quick.switch.requested"),

  /** 重做最后一轮 Session 消息 */
  SessionRedoRequested: defineEvent<Record<string, never>>("session.redo.requested"),

  /** 会话分享 */
  SessionShared: defineEvent<{
    sessionId: string;
    format: string;
    path: string;
  }>("session.shared"),

  /** 切换 Session 右侧栏 */
  SessionSidebarToggle: defineEvent<Record<string, never>>("session.sidebar.toggle"),

  /** 会话状态变更(idle/busy/waiting/completed/failed/cancelled) */
  SessionStatusChanged: defineEvent<{
    sessionId: string;
    status: "idle" | "busy" | "retry" | "error" | "waiting" | "completed" | "failed" | "cancelled";
    previousStatus: "idle" | "busy" | "retry" | "error" | "waiting" | "completed" | "failed" | "cancelled";
    reason?: string;
  }>("session.status.changed"),

  /** 会话状态更新请求 */
  SessionStatusUpdateRequested: defineEvent<{
    sessionId: string;
    status: "idle" | "busy" | "retry" | "error" | "waiting" | "completed" | "failed" | "cancelled";
    reason?: string;
  }>("session.status.update.requested"),

  /** 会话摘要生成 */
  SessionSummarized: defineEvent<{
    sessionId: string;
    charCount: number;
    messageCount: number;
  }>("session.summarized"),

  /** 会话切换 */
  SessionSwitched: defineEvent<{ sessionId: string; from?: string }>("session.switched"),

  /** 切换 Session 内容 conceal */
  SessionToggleConceal: defineEvent<Record<string, never>>("session.toggle.conceal"),

  /** 撤销最后一轮 Session 消息 */
  SessionUndoRequested: defineEvent<Record<string, never>>("session.undo.requested"),

  /** 请求 Revert 到指定消息 */
  SessionRevertRequested: defineEvent<{ messageIndex: number }>("session.revert.requested"),

  /** 请求 Unrevert(恢复最近一次 revert) */
  SessionUnrevertRequested: defineEvent<Record<string, never>>("session.unrevert.requested"),

  /** Revert 状态变更通知 */
  SessionRevertChanged: defineEvent<{ revertedCount: number }>("session.revert.changed"),

  /** 摘要生成完成 */
  SummaryGenerated: defineEvent<{
    requestId: string;
    result: unknown;
    error?: string;
  }>("summary.generated"),

  /** 摘要请求 */
  SummaryRequested: defineEvent<{
    sessionId: string;
    requestId: string;
    messages: unknown[];
    options?: { timeout?: number };
  }>("summary.requested"),

  /** 显示 Session Timeline 弹窗 */
  TimelineShow: defineEvent<Record<string, never>>("session.timeline.show"),

  /** 打开 Diff 审查面板 */
  DiffReviewShow: defineEvent<Record<string, never>>("session.diff.review.show"),

  /** 打开提交审查面板 */
  ReviewCommitShow: defineEvent<Record<string, never>>("session.review.commit.show"),

  /** 打开对话分叉面板 */
  BranchPanelShow: defineEvent<{ branchName?: string }>("session.branch.panel.show"),
} as const;

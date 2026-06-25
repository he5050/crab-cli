/**
 * 恢复对话框 — 检测到可恢复 Agent 会话时显示，提供恢复/跳过选项。
 *
 * 职责:
 *   - 列出 AppEvent.AgentRecoveryDetected 中的可恢复会话
 *   - 让用户选择恢复某条会话或全部跳过
 *
 * 模块功能:
 *   - RecoveryDialog: 主组件，渲染会话列表
 */
import { For, Show } from "solid-js";
import { DialogHeader, DialogOverlay } from "@/ui/components/dialogUi";

interface RecoverableSession {
  sessionId: string;
  title: string;
  savedAt: number;
  status: string;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function statusBadge(status: string): string {
  if (status === "active") {
    return "● 活跃";
  }
  if (status === "paused") {
    return "○ 暂停";
  }
  return status;
}

interface RecoveryDialogProps {
  sessions: RecoverableSession[];
  onConfirm: (sessionId: string) => void;
  onDismiss: () => void;
}

export function RecoveryDialog(props: RecoveryDialogProps) {
  return (
    <DialogOverlay size="medium" onClose={props.onDismiss}>
      <DialogHeader title="检测到未完成的会话" />
      <div style="padding: 0 1rem 1rem;">
        <Show when={props.sessions.length > 0}>
          <For each={props.sessions}>
            {(session) => (
              <div
                style={`
                  padding: 0.75rem;
                  margin-bottom: 0.5rem;
                  border: 1px solid ${"var(--border)"};
                  border-radius: 0.375rem;
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: 0.5rem;
                `}
              >
                <div style="flex: 1; min-width: 0;">
                  <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    {session.title || session.sessionId.slice(0, 12)}
                  </div>
                  <div style="opacity: 0.7; font-size: 0.8em;">
                    {statusBadge(session.status)} · {formatRelativeTime(session.savedAt)}
                  </div>
                </div>
                <button
                  onClick={() => props.onConfirm(session.sessionId)}
                  style={`
                    padding: 0.375rem 0.75rem;
                    background: var(--accent);
                    color: var(--background);
                    border: none;
                    border-radius: 0.25rem;
                    cursor: pointer;
                    white-space: nowrap;
                    font-weight: 600;
                  `}
                >
                  恢复
                </button>
              </div>
            )}
          </For>
          <button
            onClick={props.onDismiss}
            style={`
              width: 100%;
              padding: 0.5rem;
              margin-top: 0.25rem;
              background: transparent;
              color: var(--foreground-muted);
              border: 1px solid var(--border);
              border-radius: 0.375rem;
              cursor: pointer;
            `}
          >
            跳过全部
          </button>
        </Show>
        <Show when={props.sessions.length === 0}>
          <div style="opacity: 0.7; text-align: center; padding: 1rem;">没有可恢复的会话</div>
        </Show>
      </div>
    </DialogOverlay>
  );
}

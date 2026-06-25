/**
 * 会话任务项 — 从消息中提取最近 10 条工具运行结果作为任务列表。
 *
 * 职责:
 *   - 解析 system 角色中以 ⟳/✓/✗ 开头的消息
 *   - 转换为统一 SessionTaskItem
 */
export interface SessionTaskItem {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
}

interface TaskMessageLike {
  role: string;
  content: string;
}

export function buildSessionTaskItems(messages: TaskMessageLike[]): SessionTaskItem[] {
  return messages
    .filter((msg) => msg.role === "system" && /^[⟳✓✗]/.test(msg.content))
    .slice(-10)
    .map((msg, index) => ({
      id: String(index + 1),
      label: msg.content.slice(2).trim(),
      status: msg.content.startsWith("⟳") ? "running" : msg.content.startsWith("✓") ? "done" : "error",
    }));
}

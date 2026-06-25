/**
 * 会话切换器状态管理 — 固定会话的持久化和快速切换。
 *
 * 职责:
 *   - 管理固定会话的 ID 列表
 *   - 提供固定/取消固定的切换逻辑
 *   - 支持快速切换槽位映射
 *
 * 模块功能:
 *   - SESSION_SWITCHER_PINNED_KEY: 本地存储 key
 *   - normalizePinnedSessionIds: 规范化固定会话 ID 列表
 *   - togglePinnedSessionId: 切换会话固定状态
 *   - getQuickSwitchSessionId: 获取快速切换槽位对应的会话 ID
 *
 * 使用场景:
 *   - 会话切换器固定会话功能
 *   - 快速切换到固定会话(1-9 数字键)
 *
 * 边界:
 *   1. 固定会话上限为 9 个
 *   2. 自动过滤不存在的会话 ID
 *   3. 自动去重
 *
 * 流程:
 *   1. 用户点击固定按钮
 *   2. togglePinnedSessionId 更新固定列表
 *   3. 保存到本地存储
 *   4. 数字键快速切换时查询对应槽位
 */
export const SESSION_SWITCHER_PINNED_KEY = "session.switcher.pinned";

export function normalizePinnedSessionIds(pinned: unknown, sessionIds: string[]): string[] {
  const ids = Array.isArray(pinned)
    ? pinned.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const existing = new Set(sessionIds);
  const result: string[] = [];
  for (const id of ids) {
    if (!existing.has(id)) {
      continue;
    }
    if (result.includes(id)) {
      continue;
    }
    result.push(id);
    if (result.length >= 9) {
      break;
    }
  }
  return result;
}

export function togglePinnedSessionId(pinned: unknown, sessionId: string, sessionIds: string[]): string[] {
  const current = normalizePinnedSessionIds(pinned, sessionIds);
  const next = new Set(current);
  if (next.has(sessionId)) {
    next.delete(sessionId);
  } else {
    next.add(sessionId);
  }
  return normalizePinnedSessionIds([...next], sessionIds);
}

export function getQuickSwitchSessionId(slot: number, pinned: unknown, sessionIds: string[]): string | undefined {
  if (slot < 1 || slot > 9) {
    return undefined;
  }
  const current = normalizePinnedSessionIds(pinned, sessionIds);
  return current[slot - 1];
}

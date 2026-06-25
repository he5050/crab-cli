/**
 * 快照与会话增强事件 — 快照生命周期 + 会话分享。
 *
 * 职责:Phase 24 会话增强相关事件契约。
 */
import { defineEvent } from "../core";

export const SnapshotEvents = {
  /** 快照创建 */
  SnapshotCreated: defineEvent<{
    id: string;
    label: string;
  }>("snapshot.created"),

  /** 快照恢复 */
  SnapshotRestored: defineEvent<{
    id: string;
    label: string;
  }>("snapshot.restored"),
} as const;

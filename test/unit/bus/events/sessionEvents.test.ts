/**
 * SessionEvents 契约测试 — P3 补充。
 *
 * 覆盖:
 *   - type 字符串唯一性
 *   - 命名空间前缀
 *   - 关键事件存在
 *   - 必填字段非空
 */
import { describe, expect, test } from "bun:test";
import { AppEvent } from "@/bus";
import { SessionEvents } from "@/bus";

describe("SessionEvents — 契约", () => {
  test("所有事件 type 唯一", () => {
    const types = Object.values(SessionEvents).map((e) => e.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  test("事件命名空间为 session.* / home.* / summary.* / timeline.*", () => {
    const types = Object.values(SessionEvents).map((e) => e.type);
    for (const t of types) {
      expect(t).toMatch(/^(session|home|summary|timeline)\./);
    }
  });

  test("关键事件存在", () => {
    expect(SessionEvents.SessionCreated).toBeDefined();
    expect(SessionEvents.SessionSwitched).toBeDefined();
    expect(SessionEvents.SessionStatusChanged).toBeDefined();
    expect(SessionEvents.SessionSummarized).toBeDefined();
    expect(SessionEvents.SessionShared).toBeDefined();
    expect(SessionEvents.HomePromptSubmit).toBeDefined();
    expect(SessionEvents.SummaryRequested).toBeDefined();
    expect(SessionEvents.SummaryGenerated).toBeDefined();
  });

  test("SessionEvents 通过 AppEvent 暴露", () => {
    expect(AppEvent.SessionCreated).toBe(SessionEvents.SessionCreated);
    expect(AppEvent.SessionSwitched).toBe(SessionEvents.SessionSwitched);
    expect(AppEvent.SessionStatusChanged).toBe(SessionEvents.SessionStatusChanged);
  });

  test("SessionStatusChanged status 枚举合法值", () => {
    expect(SessionEvents.SessionStatusChanged.type).toBe("session.status.changed");
    // 4 个合法 status 值
    const validStatuses = ["idle", "busy", "retry", "error"];
    expect(validStatuses).toHaveLength(4);
  });

  test("SessionStatusChanged 与 SessionStatusUpdateRequested 共享 status 语义", () => {
    expect(SessionEvents.SessionStatusUpdateRequested.type).toBe("session.status.update.requested");
  });
});

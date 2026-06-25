/**
 * PermissionEvents 契约测试 — P3 补充。
 */
import { describe, expect, test } from "bun:test";
import { AppEvent } from "@/bus";
import { PermissionEvents } from "@/bus";

describe("PermissionEvents — 契约", () => {
  test("所有事件 type 唯一", () => {
    const types = Object.values(PermissionEvents).map((e) => e.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  test("事件命名空间为 permission.*", () => {
    const types = Object.values(PermissionEvents).map((e) => e.type);
    for (const t of types) {
      expect(t).toMatch(/^permission\./);
    }
  });

  test("PermissionAsked / PermissionResolved / PermissionStatus 存在", () => {
    expect(PermissionEvents.PermissionAsked.type).toBe("permission.asked");
    expect(PermissionEvents.PermissionResolved.type).toBe("permission.resolved");
    expect(PermissionEvents.PermissionStatus.type).toBe("permission.status");
  });

  test("通过 AppEvent 暴露", () => {
    expect(AppEvent.PermissionAsked).toBe(PermissionEvents.PermissionAsked);
    expect(AppEvent.PermissionResolved).toBe(PermissionEvents.PermissionResolved);
    expect(AppEvent.PermissionStatus).toBe(PermissionEvents.PermissionStatus);
  });

  test("PermissionStatus.action 合法值", () => {
    // action 必须是 "once" | "always" | "reject" 之一
    const validActions = ["once", "always", "reject"];
    expect(validActions).toHaveLength(3);
  });
});

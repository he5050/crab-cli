/**
 * 事件定义测试。
 *
 * 测试用例:
 *   - 事件类型唯一性
 *   - 命名空间检查
 *   - 关键事件存在性
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AppEvent } from "@/bus";
import { validateAllAppEventNames } from "@/bus";

const ROOT = join(import.meta.dir, "../../..");

describe("事件定义 — AppEvent", () => {
  test("所有事件有唯一的 type 字符串", () => {
    const types = Object.values(AppEvent).map((e) => e.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  test("所有事件常量名唯一（无覆盖）", () => {
    const names = Object.keys(AppEvent);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test("事件类型包含关键命名空间", () => {
    const types = Object.values(AppEvent).map((e) => e.type);
    expect(types.some((t) => t.startsWith("app."))).toBe(true);
    expect(types.some((t) => t.startsWith("session."))).toBe(true);
    expect(types.some((t) => t.startsWith("tool."))).toBe(true);
    expect(types.some((t) => t.startsWith("permission."))).toBe(true);
    expect(types.some((t) => t.startsWith("config."))).toBe(true);
    expect(types.some((t) => t.startsWith("resource."))).toBe(true);
    expect(types.some((t) => t.startsWith("theme."))).toBe(true);
  });

  test("事件定义数量符合预期", () => {
    const count = Object.keys(AppEvent).length;
    expect(count).toBeGreaterThanOrEqual(85);
  });

  test("关键事件存在", () => {
    expect(AppEvent.AppStarted).toBeDefined();
    expect(AppEvent.Log).toBeDefined();
    expect(AppEvent.ConfigUpdated).toBeDefined();
    expect(AppEvent.SessionCreated).toBeDefined();
    expect(AppEvent.ToolCall).toBeDefined();
    expect(AppEvent.ToolResult).toBeDefined();
    expect(AppEvent.ResourceUpdate).toBeDefined();
    expect(AppEvent.ThemeChanged).toBeDefined();
    expect(AppEvent.Toast).toBeDefined();
    expect(AppEvent.ChatChunk).toBeDefined();
  });

  test("tool/session/permission event definitions are split by domain and aggregated by AppEvent", () => {
    for (const file of [
      "src/bus/events/toolEvents.ts",
      "src/bus/events/sessionEvents.ts",
      "src/bus/events/permissionEvents.ts",
    ]) {
      expect(existsSync(join(ROOT, file)), `${file} should exist`).toBe(true);
    }

    // Check that AppEvent aggregates events from domain modules
    const appEventsSource = readFileSync(join(ROOT, "src/bus/events/index.ts"), "utf8");
    expect(appEventsSource).toContain("ToolEvents");
    expect(appEventsSource).toContain("SessionEvents");
    expect(appEventsSource).toContain("PermissionEvents");
  });

  test("所有 AppEvent 聚合事件都通过命名规范校验", () => {
    const result = validateAllAppEventNames(AppEvent);
    expect(result).toEqual([]);
  });
});

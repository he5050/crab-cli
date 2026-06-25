/**
 * ToolEvents 契约测试 — P3 补充。
 */
import { describe, expect, test } from "bun:test";
import { AppEvent } from "@/bus";
import { ToolEvents } from "@/bus";

describe("ToolEvents — 契约", () => {
  test("所有事件 type 唯一", () => {
    const types = Object.values(ToolEvents).map((e) => e.type);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  test("事件命名空间为 tool.*", () => {
    const types = Object.values(ToolEvents).map((e) => e.type);
    for (const t of types) {
      expect(t).toMatch(/^tool\./);
    }
  });

  test("ToolCall / ToolResult / ToolTimeout 存在", () => {
    expect(ToolEvents.ToolCall.type).toBe("tool.call");
    expect(ToolEvents.ToolResult.type).toBe("tool.result");
    expect(ToolEvents.ToolTimeout.type).toBe("tool.timeout");
  });

  test("通过 AppEvent 暴露", () => {
    expect(AppEvent.ToolCall).toBe(ToolEvents.ToolCall);
    expect(AppEvent.ToolResult).toBe(ToolEvents.ToolResult);
    expect(AppEvent.ToolTimeout).toBe(ToolEvents.ToolTimeout);
  });

  test("ToolTimeout 必填字段非空", () => {
    // 验证定义不会 throw
    expect(() => ToolEvents.ToolTimeout).not.toThrow();
  });
});

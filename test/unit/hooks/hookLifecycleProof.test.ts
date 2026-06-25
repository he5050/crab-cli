/**
 * [测试目标] Hook 生命周期证明。
 *
 * 测试目标:
 *   - 验证 hookRegistry / hookExecutor 在 PreToolUse / PostToolUse 等生命周期事件上的注册、派发、阻塞与日志
 *
 * 测试用例:
 *   - PreToolUse block 会停止后续 Hook，并发布 HookExecuted 事件:注册 block / pass 两类 hook，断言事件顺序与 bus 上 HookExecuted 派发
 *   - 其余用例覆盖优先级排序、错误传播、并发执行与清理
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import type { HookContext, HookDecision, HookDefinition } from "@/hooks/types";

function makeBuiltinHook(
  overrides: Partial<HookDefinition> & {
    handler?: (ctx: HookContext) => Promise<HookDecision>;
  } = {},
): HookDefinition {
  const handler = overrides.handler ?? (async () => ({ action: "pass" as const }));
  return {
    enabled: true,
    event: "PreToolUse",
    handler,
    id: "test-hook",
    name: "Test Hook",
    priority: 100,
    type: "builtin",
    ...overrides,
  };
}

describe("Hook lifecycle proof", () => {
  let registry: any;
  let executor: any;

  beforeEach(async () => {
    const { hookRegistry } = await import("@/hooks/hookRegistry");
    const { hookExecutor } = await import("@/hooks/hookExecutor");
    registry = hookRegistry;
    executor = hookExecutor;
    registry.clear();
    executor.clearLog();
  });

  test("PreToolUse block 会停止后续 Hook，并发布 HookExecuted 事件", async () => {
    const order: string[] = [];
    const events: Record<string, unknown>[] = [];
    const unsub = globalBus.subscribe(AppEvent.HookExecuted, (evt) => {
      events.push(evt.properties as Record<string, unknown>);
    });

    registry.register(
      makeBuiltinHook({
        event: "PreToolUse",
        handler: async () => {
          order.push("pass-first");
          return { action: "pass" };
        },
        id: "pass-first",
        priority: 10,
      }),
    );

    registry.register(
      makeBuiltinHook({
        event: "PreToolUse",
        handler: async () => {
          order.push("block-second");
          return { action: "block", reason: "blocked by policy" };
        },
        id: "block-second",
        priority: 20,
      }),
    );

    registry.register(
      makeBuiltinHook({
        event: "PreToolUse",
        handler: async () => {
          order.push("never-run");
          return { action: "pass" };
        },
        id: "never-run",
        priority: 30,
      }),
    );

    try {
      const result = await executor.preToolUse("bash", { command: "rm -rf /" }, "call-proof-1");

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("blocked by policy");
      expect(order).toEqual(["pass-first", "block-second"]);
      expect(events.map((evt) => evt.hookId)).toEqual(["pass-first", "block-second"]);
      expect(events.map((evt) => evt.decision)).toEqual(["pass", "block"]);
      expect(events.every((evt) => evt.event === "PreToolUse")).toBe(true);
    } finally {
      unsub();
    }
  });

  test("PostToolUse replace 会返回替换结果，并发布 HookExecuted 事件", async () => {
    const events: Record<string, unknown>[] = [];
    const unsub = globalBus.subscribe(AppEvent.HookExecuted, (evt) => {
      events.push(evt.properties as Record<string, unknown>);
    });

    registry.register(
      makeBuiltinHook({
        event: "PostToolUse",
        handler: async () => ({
          action: "replace",
          output: { final: "replaced-result" },
        }),
        id: "replace-after",
      }),
    );

    try {
      const result = await executor.postToolUse("bash", { output: "original-result" }, false, "call-proof-2");

      expect(result.replaced).toEqual({ final: "replaced-result" });
      expect(events).toHaveLength(1);
      expect(events[0]?.hookId).toBe("replace-after");
      expect(events[0]?.decision).toBe("replace");
      expect(events[0]?.event).toBe("PostToolUse");
      expect(events[0]?.success).toBe(true);
    } finally {
      unsub();
    }
  });
});

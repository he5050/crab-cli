/**
 * Hook 执行器测试 — 执行、阻止、替换、超时、错误容错。
 *
 * 测试用例:
 *   - beforeToolCall 通过执行
 *   - beforeToolCall 阻止执行
 *   - afterToolCall 修改输出
 *   - hook 执行错误不崩溃
 *   - 多 hook 按优先级顺序执行
 *   - SessionStart/SessionEnd Hook
 *   - 执行日志记录
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { HookContext, HookDecision, HookDefinition } from "@/hooks/types";

/** 创建内置 Hook */
function makeBuiltinHook(
  overrides: Partial<HookDefinition> & { handler?: (ctx: HookContext) => Promise<HookDecision> } = {},
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

describe("HookExecutor", () => {
  let executor: any;
  let registry: any;

  beforeEach(async () => {
    const { hookRegistry } = await import("@/hooks/hookRegistry");
    const { hookExecutor } = await import("@/hooks/hookExecutor");
    registry = hookRegistry;
    executor = hookExecutor;
    registry.clear();
    executor.clearLog();
  });

  describe("PreToolUse Hook", () => {
    test("beforeToolCall 通过执行", async () => {
      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => ({ action: "pass" }),
          id: "pass-hook",
        }),
      );

      const { allowed, results } = await executor.preToolUse("bash", { command: "ls" });
      expect(allowed).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].decision.action).toBe("pass");
      expect(results[0].success).toBe(true);
    });

    test("beforeToolCall 阻止执行", async () => {
      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => ({ action: "block", reason: "安全检查未通过" }),
          id: "block-hook",
        }),
      );

      const { allowed, reason } = await executor.preToolUse("bash", { command: "rm -rf /" });
      expect(allowed).toBe(false);
      expect(reason).toBe("安全检查未通过");
    });

    test("beforeToolCall 多个 Hook 时 block 停止后续", async () => {
      const callOrder: string[] = [];

      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => {
            callOrder.push("high");
            return { action: "block", reason: "先拦住" };
          },
          id: "high-priority",
          priority: 10,
        }),
      );

      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => {
            callOrder.push("low");
            return { action: "pass" };
          },
          id: "low-priority",
          priority: 200,
        }),
      );

      const { allowed } = await executor.preToolUse("bash");
      expect(allowed).toBe(false);
      expect(callOrder).toEqual(["high"]); // Low 没有执行
    });
  });

  describe("PostToolUse Hook", () => {
    test("afterToolCall 正常执行", async () => {
      registry.register(
        makeBuiltinHook({
          event: "PostToolUse",
          handler: async () => ({ action: "pass" }),
          id: "log-hook",
        }),
      );

      const { results } = await executor.postToolUse("bash", { output: "hello" }, false);
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
    });

    test("afterToolCall 替换输出", async () => {
      registry.register(
        makeBuiltinHook({
          event: "PostToolUse",
          handler: async () => ({ action: "replace", output: { replaced: true } }),
          id: "replace-hook",
        }),
      );

      const { replaced } = await executor.postToolUse("bash", { output: "original" });
      expect(replaced).toEqual({ replaced: true });
    });
  });

  describe("错误容错", () => {
    test("Hook handler 抛异常不崩溃", async () => {
      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => {
            throw new Error("Hook 内部错误");
          },
          id: "crash-hook",
        }),
      );

      const { allowed, results } = await executor.preToolUse("bash");
      // 失败的 Hook 默认 pass(容错)
      expect(allowed).toBe(true);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("Hook 内部错误");
    });
  });

  describe("优先级排序", () => {
    test("多 Hook 按优先级顺序执行", async () => {
      const order: number[] = [];

      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => {
            order.push(200);
            return { action: "pass" };
          },
          id: "p200",
          priority: 200,
        }),
      );

      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => {
            order.push(10);
            return { action: "pass" };
          },
          id: "p10",
          priority: 10,
        }),
      );

      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => {
            order.push(100);
            return { action: "pass" };
          },
          id: "p100",
          priority: 100,
        }),
      );

      await executor.preToolUse("bash");
      expect(order).toEqual([10, 100, 200]);
    });
  });

  describe("SessionStart/SessionEnd", () => {
    test("sessionStart 执行", async () => {
      let called = false;
      registry.register(
        makeBuiltinHook({
          event: "SessionStart",
          handler: async () => {
            called = true;
            return { action: "pass" };
          },
          id: "session-start",
        }),
      );

      const results = await executor.sessionStart("test-session");
      expect(results.length).toBe(1);
      expect(called).toBe(true);
    });

    test("sessionEnd 执行", async () => {
      let called = false;
      registry.register(
        makeBuiltinHook({
          event: "SessionEnd",
          handler: async () => {
            called = true;
            return { action: "pass" };
          },
          id: "session-end",
        }),
      );

      const results = await executor.sessionEnd("test-session");
      expect(results.length).toBe(1);
      expect(called).toBe(true);
    });
  });

  describe("SubAgent Hooks", () => {
    test("subAgentStart 执行", async () => {
      let agentName = "";
      registry.register(
        makeBuiltinHook({
          event: "SubAgentStart",
          handler: async (ctx) => {
            agentName = ctx.agentName ?? "";
            return { action: "pass" };
          },
          id: "sub-start",
        }),
      );

      await executor.subAgentStart("agent-1", "researcher");
      expect(agentName).toBe("researcher");
    });

    test("subAgentStop 成功", async () => {
      let isError = true;
      registry.register(
        makeBuiltinHook({
          event: "SubAgentStop",
          handler: async (ctx) => {
            isError = ctx.isError ?? true;
            return { action: "pass" };
          },
          id: "sub-stop",
        }),
      );

      await executor.subAgentStop("agent-1", "researcher", true);
      expect(isError).toBe(false);
    });

    test("subAgentStop 失败", async () => {
      let isError = false;
      registry.register(
        makeBuiltinHook({
          event: "SubAgentStop",
          handler: async (ctx) => {
            isError = ctx.isError ?? false;
            return { action: "pass" };
          },
          id: "sub-stop-fail",
        }),
      );

      await executor.subAgentStop("agent-1", "researcher", false);
      expect(isError).toBe(true);
    });
  });

  describe("执行日志", () => {
    test("getLog 返回执行记录", async () => {
      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => ({ action: "pass" }),
          id: "log-test",
        }),
      );

      await executor.preToolUse("bash");
      const log = executor.getLog();
      expect(log.length).toBe(1);
      expect(log[0].hookId).toBe("log-test");
    });

    test("clearLog 清空日志", async () => {
      registry.register(
        makeBuiltinHook({
          event: "PreToolUse",
          handler: async () => ({ action: "pass" }),
          id: "log-test",
        }),
      );

      await executor.preToolUse("bash");
      executor.clearLog();
      expect(executor.getLog().length).toBe(0);
    });
  });

  describe("快捷方法", () => {
    test("notification 执行", async () => {
      let msg = "";
      registry.register(
        makeBuiltinHook({
          event: "Notification",
          handler: async (ctx) => {
            msg = (ctx as any).message ?? "";
            return { action: "pass" };
          },
          id: "notif",
        }),
      );

      await executor.notification("test message");
      expect(msg).toBe("test message");
    });

    test("stop 执行", async () => {
      let called = false;
      registry.register(
        makeBuiltinHook({
          event: "Stop",
          handler: async () => {
            called = true;
            return { action: "pass" };
          },
          id: "stop-hook",
        }),
      );

      await executor.stop("session-1");
      expect(called).toBe(true);
    });
  });

  describe("空 Hook 列表", () => {
    test("没有注册 Hook 时返回空结果", async () => {
      const results = await executor.execute("PreToolUse", { toolName: "bash" });
      expect(results).toEqual([]);
    });

    test("preToolUse 无 Hook 时放行", async () => {
      const { allowed } = await executor.preToolUse("bash");
      expect(allowed).toBe(true);
    });
  });

  describe("UserMessage Hook", () => {
    test("userMessage 执行", async () => {
      let capturedMsg = "";
      registry.register(
        makeBuiltinHook({
          event: "UserMessage",
          handler: async (ctx) => {
            capturedMsg = (ctx as any).message ?? "";
            return { action: "pass" };
          },
          id: "user-msg",
        }),
      );

      await executor.userMessage("Hello, world!", "session-1");
      expect(capturedMsg).toBe("Hello, world!");
    });
  });

  describe("ToolConfirmation Hook", () => {
    test("toolConfirmation 放行", async () => {
      registry.register(
        makeBuiltinHook({
          event: "ToolConfirmation",
          handler: async () => ({ action: "pass" }),
          id: "confirm-pass",
        }),
      );

      const { allowed } = await executor.toolConfirmation("bash", { command: "ls" });
      expect(allowed).toBe(true);
    });

    test("toolConfirmation 阻止", async () => {
      registry.register(
        makeBuiltinHook({
          event: "ToolConfirmation",
          handler: async () => ({ action: "block", reason: "需要人工确认" }),
          id: "confirm-block",
        }),
      );

      const { allowed, reason } = await executor.toolConfirmation("bash", { command: "rm -rf /" });
      expect(allowed).toBe(false);
      expect(reason).toBe("需要人工确认");
    });
  });

  describe("Compress Hook", () => {
    test("compress before 执行", async () => {
      let phase = "";
      registry.register(
        makeBuiltinHook({
          event: "Compress",
          handler: async (ctx) => {
            phase = (ctx as any).message ?? "";
            return { action: "pass" };
          },
          id: "compress-hook",
        }),
      );

      await executor.compress("session-1", "before", 100_000);
      expect(phase).toBe("before");
    });

    test("compress after 执行", async () => {
      let phase = "";
      registry.register(
        makeBuiltinHook({
          event: "Compress",
          handler: async (ctx) => {
            phase = (ctx as any).message ?? "";
            return { action: "pass" };
          },
          id: "compress-after",
        }),
      );

      await executor.compress("session-1", "after", 50_000);
      expect(phase).toBe("after");
    });
  });

  describe("inject 决策", () => {
    test("SubAgentStop Hook 返回 inject 决策", async () => {
      registry.register(
        makeBuiltinHook({
          event: "SubAgentStop",
          handler: async () => ({
            action: "inject" as const,
            message: "请继续完成你的任务",
            shouldContinueConversation: true,
          }),
          id: "inject-hook",
        }),
      );

      const results = await executor.subAgentStop("agent-1", "researcher", true);
      expect(results.length).toBe(1);
      expect(results[0].decision.action).toBe("inject");
      expect((results[0].decision as any).message).toBe("请继续完成你的任务");
      expect((results[0].decision as any).shouldContinueConversation).toBe(true);
    });
  });

  describe("Hook 超时", () => {
    test("Shell Hook 超时返回 pass(容错)", async () => {
      // 注册一个超时极短的 shell hook，它应该被超时机制处理
      registry.register({
        command: "sleep 10", // 会超时
        enabled: true,
        event: "PreToolUse",
        id: "timeout-hook",
        name: "Timeout Test Hook",
        priority: 100,
        timeout: 50, // 50ms 超时
        type: "shell",
      });

      const { allowed, results } = await executor.preToolUse("bash");
      // 超时不等于崩溃，shell-hook 容错机制返回 pass
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeTruthy();
    });
  });
});

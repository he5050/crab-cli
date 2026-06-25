/**
 * 内置 Hook 单元测试。
 *
 * 覆盖场景:
 *   - builtinHooks 数组结构（4 个 Hook、唯一 ID、类型、handler）
 *   - 日志 Hook (PostToolUse) 默认禁用、handler 返回 pass
 *   - 安全 Hook (PreToolUse) 默认禁用、正则匹配阻止/放行
 *   - 会话开始/结束 Hook 默认启用、handler 返回 pass
 *   - registerBuiltinHooks 注册到 hookRegistry、重复注册幂等
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { HookContext, HookDefinition } from "@/hooks/types";
import { builtinHooks, registerBuiltinHooks } from "@/hooks/builtinHooks";

describe("builtinHooks 定义", () => {
  test("包含 4 个预定义 Hook", () => {
    expect(builtinHooks.length).toBe(4);
  });

  test("每个 Hook 有唯一 ID", () => {
    const ids = builtinHooks.map((h) => h.id);
    expect(new Set(ids).size).toBe(4);
  });

  test("ID 前缀为 builtin.", () => {
    for (const hook of builtinHooks) {
      expect(hook.id).toMatch(/^builtin\./);
    }
  });

  test("所有 Hook 类型为 builtin 且都有 handler", () => {
    for (const hook of builtinHooks) {
      expect(hook.type).toBe("builtin");
      expect(hook.handler).toBeDefined();
    }
  });

  test("包含 logHook (PostToolUse, priority=200, disabled)", () => {
    const logHook = builtinHooks.find((h) => h.id === "builtin.log-tool-calls");
    expect(logHook).toBeDefined();
    expect(logHook!.event).toBe("PostToolUse");
    expect(logHook!.priority).toBe(200);
    expect(logHook!.enabled).toBe(false);
  });

  test("包含 securityHook (PreToolUse, priority=10, disabled)", () => {
    const securityHook = builtinHooks.find((h) => h.id === "builtin.security-check");
    expect(securityHook).toBeDefined();
    expect(securityHook!.event).toBe("PreToolUse");
    expect(securityHook!.priority).toBe(10);
    expect(securityHook!.enabled).toBe(false);
  });

  test("包含 sessionStartHook (SessionStart, priority=100, enabled)", () => {
    const hook = builtinHooks.find((h) => h.id === "builtin.session-start-log");
    expect(hook).toBeDefined();
    expect(hook!.event).toBe("SessionStart");
    expect(hook!.enabled).toBe(true);
  });

  test("包含 sessionEndHook (SessionEnd, priority=100, enabled)", () => {
    const hook = builtinHooks.find((h) => h.id === "builtin.session-end-log");
    expect(hook).toBeDefined();
    expect(hook!.event).toBe("SessionEnd");
    expect(hook!.enabled).toBe(true);
  });
});

describe("日志 Hook 逻辑", () => {
  test("handler 返回 pass", async () => {
    const logHook = builtinHooks.find((h) => h.id === "builtin.log-tool-calls")!;
    const decision = await logHook.handler!({ event: "PostToolUse", toolName: "bash" });
    expect(decision.action).toBe("pass");
  });
});

describe("安全 Hook 逻辑", () => {
  function getSecurityHook(): HookDefinition & { handler: NonNullable<HookDefinition["handler"]> } {
    const hook = builtinHooks.find((h) => h.id === "builtin.security-check");
    if (!hook?.handler) {
      throw new Error("security hook missing");
    }
    return hook as HookDefinition & { handler: NonNullable<HookDefinition["handler"]> };
  }

  test("拦截 /etc/passwd 路径", async () => {
    const hook = getSecurityHook();
    const ctx: HookContext = {
      event: "PreToolUse",
      toolArgs: { path: "/etc/passwd" },
      toolName: "filesystem-write",
    } as any;
    const decision = await hook.handler(ctx);
    expect(decision.action).toBe("block");
  });

  test("拦截 /etc/shadow 路径", async () => {
    const hook = getSecurityHook();
    const ctx: HookContext = {
      event: "PreToolUse",
      toolArgs: { path: "/etc/shadow" },
      toolName: "filesystem-write",
    } as any;
    const decision = await hook.handler(ctx);
    expect(decision.action).toBe("block");
  });

  test("拦截 ~/.ssh/ 路径", async () => {
    const hook = getSecurityHook();
    const ctx: HookContext = {
      event: "PreToolUse",
      toolArgs: { path: "/home/user/.ssh/authorized_keys" },
      toolName: "filesystem-edit",
    } as any;
    const decision = await hook.handler(ctx);
    expect(decision.action).toBe("block");
  });

  test("拦截 .env 文件", async () => {
    const hook = getSecurityHook();
    const ctx: HookContext = {
      event: "PreToolUse",
      toolArgs: { filePath: "/home/user/project/.env" },
      toolName: "filesystem-write",
    } as any;
    const decision = await hook.handler(ctx);
    expect(decision.action).toBe("block");
  });

  test("拦截 rm -rf / 命令", async () => {
    const hook = getSecurityHook();
    const ctx: HookContext = {
      event: "PreToolUse",
      toolArgs: { command: "rm -rf /var" },
      toolName: "terminal-execute",
    } as any;
    const decision = await hook.handler(ctx);
    expect(decision.action).toBe("block");
  });

  test("放行安全路径", async () => {
    const hook = getSecurityHook();
    const ctx: HookContext = {
      event: "PreToolUse",
      toolArgs: { path: "/home/user/test.txt" },
      toolName: "filesystem-write",
    } as any;
    const decision = await hook.handler(ctx);
    expect(decision.action).toBe("pass");
  });

  test("无 toolArgs 时放行", async () => {
    const hook = getSecurityHook();
    const ctx: HookContext = { event: "PreToolUse", toolName: "filesystem-read" } as any;
    const decision = await hook.handler(ctx);
    expect(decision.action).toBe("pass");
  });
});

describe("会话 Hook 逻辑", () => {
  test("sessionStart handler 返回 pass", async () => {
    const hook = builtinHooks.find((h) => h.id === "builtin.session-start-log")!;
    const decision = await hook.handler!({ event: "SessionStart", sessionId: "test-123" });
    expect(decision.action).toBe("pass");
  });

  test("sessionEnd handler 返回 pass", async () => {
    const hook = builtinHooks.find((h) => h.id === "builtin.session-end-log")!;
    const decision = await hook.handler!({ event: "SessionEnd", sessionId: "test-123" });
    expect(decision.action).toBe("pass");
  });
});

describe("registerBuiltinHooks", () => {
  let registry: any;

  beforeEach(async () => {
    const { hookRegistry } = await import("@/hooks/hookRegistry");
    registry = hookRegistry;
    registry.clear();
  });

  test("注册所有内置 Hook 到注册表", async () => {
    await registerBuiltinHooks();
    for (const hook of builtinHooks) {
      const registered = registry.get(hook.id);
      expect(registered).toBeDefined();
      expect(registered!.id).toBe(hook.id);
    }
  });

  test("注册后注册表包含 4 个 Hook", async () => {
    await registerBuiltinHooks();
    expect(registry.size).toBe(4);
  });

  test("重复注册幂等", async () => {
    await registerBuiltinHooks();
    await registerBuiltinHooks();
    expect(registry.size).toBe(4);
  });
});

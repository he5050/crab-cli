/**
 * Hook 注册表测试 — 注册/查询/优先级/条件过滤。
 *
 * 测试用例:
 *   - 注册 Hook
 *   - 注销 Hook
 *   - 按事件类型查询
 *   - 优先级排序
 *   - 条件过滤(toolName)
 *   - 启用/禁用
 *   - 清空
 *   - 加载/保存配置
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { HookContext, HookDefinition, HookEvent } from "@/hooks/types";

/** 创建测试 Hook */
function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    enabled: true,
    event: "PreToolUse",
    id: "test-hook",
    name: "Test Hook",
    priority: 100,
    type: "builtin",
    ...overrides,
  };
}

describe("HookRegistry", () => {
  let registry: any;

  beforeEach(async () => {
    // 每个测试前创建新的注册表实例
    const mod = await import("@/hooks/hookRegistry");
    const HookRegistry = (mod as any).HookRegistry ?? (mod as any).default;
    // 直接构造新实例(如果 HookRegistry 不可构造则用 hookRegistry + clear)
    const { hookRegistry } = await import("@/hooks/hookRegistry");
    hookRegistry.clear();
    registry = hookRegistry;
  });

  describe("注册", () => {
    test("注册单个 Hook", () => {
      registry.register(makeHook());
      expect(registry.size).toBe(1);
    });

    test("注册多个 Hook", () => {
      registry.register(makeHook({ id: "hook-1" }));
      registry.register(makeHook({ event: "PostToolUse", id: "hook-2" }));
      expect(registry.size).toBe(2);
    });

    test("覆盖已存在的 Hook", () => {
      registry.register(makeHook({ id: "same", name: "v1" }));
      registry.register(makeHook({ id: "same", name: "v2" }));
      expect(registry.size).toBe(1);
      expect(registry.get("same").name).toBe("v2");
    });
  });

  describe("注销", () => {
    test("注销已注册的 Hook", () => {
      registry.register(makeHook({ id: "removable" }));
      const deleted = registry.unregister("removable");
      expect(deleted).toBe(true);
      expect(registry.size).toBe(0);
    });

    test("注销不存在的 Hook 返回 false", () => {
      const deleted = registry.unregister("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("查询", () => {
    test("get 获取指定 Hook", () => {
      registry.register(makeHook({ id: "target" }));
      const hook = registry.get("target");
      expect(hook).toBeDefined();
      expect(hook.id).toBe("target");
    });

    test("get 不存在返回 undefined", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    test("getAll 返回所有 Hook", () => {
      registry.register(makeHook({ id: "a" }));
      registry.register(makeHook({ id: "b" }));
      expect(registry.getAll().length).toBe(2);
    });
  });

  describe("按事件查询", () => {
    test("getByEvent 返回匹配的 Hook", () => {
      registry.register(makeHook({ event: "PreToolUse", id: "pre" }));
      registry.register(makeHook({ event: "PostToolUse", id: "post" }));

      const preHooks = registry.getByEvent("PreToolUse");
      expect(preHooks.length).toBe(1);
      expect(preHooks[0].id).toBe("pre");
    });

    test("getByEvent 仅返回启用的 Hook", () => {
      registry.register(makeHook({ enabled: true, event: "PreToolUse", id: "enabled" }));
      registry.register(makeHook({ enabled: false, event: "PreToolUse", id: "disabled" }));

      const hooks = registry.getByEvent("PreToolUse");
      expect(hooks.length).toBe(1);
      expect(hooks[0].id).toBe("enabled");
    });

    test("getByEvent 按 priority 排序", () => {
      registry.register(makeHook({ event: "PreToolUse", id: "low", priority: 200 }));
      registry.register(makeHook({ event: "PreToolUse", id: "high", priority: 10 }));
      registry.register(makeHook({ event: "PreToolUse", id: "mid", priority: 100 }));

      const hooks = registry.getByEvent("PreToolUse");
      expect(hooks[0].id).toBe("high");
      expect(hooks[1].id).toBe("mid");
      expect(hooks[2].id).toBe("low");
    });
  });

  describe("条件过滤", () => {
    test("按 toolName 过滤(字符串)", () => {
      registry.register(
        makeHook({
          condition: { toolName: "bash" },
          event: "PreToolUse",
          id: "bash-only",
        }),
      );

      const context: HookContext = { event: "PreToolUse", toolName: "bash" };
      const hooks = registry.getByEvent("PreToolUse", context);
      expect(hooks.length).toBe(1);
    });

    test("按 toolName 过滤(不匹配时排除)", () => {
      registry.register(
        makeHook({
          condition: { toolName: "bash" },
          event: "PreToolUse",
          id: "bash-only",
        }),
      );

      const context: HookContext = { event: "PreToolUse", toolName: "filesystem-read" };
      const hooks = registry.getByEvent("PreToolUse", context);
      expect(hooks.length).toBe(0);
    });

    test("按 toolName 过滤(数组)", () => {
      registry.register(
        makeHook({
          condition: { toolName: ["bash", "filesystem-write"] },
          event: "PreToolUse",
          id: "multi-tools",
        }),
      );

      const ctx1: HookContext = { event: "PreToolUse", toolName: "bash" };
      const ctx2: HookContext = { event: "PreToolUse", toolName: "filesystem-write" };
      const ctx3: HookContext = { event: "PreToolUse", toolName: "filesystem-read" };

      expect(registry.getByEvent("PreToolUse", ctx1).length).toBe(1);
      expect(registry.getByEvent("PreToolUse", ctx2).length).toBe(1);
      expect(registry.getByEvent("PreToolUse", ctx3).length).toBe(0);
    });
  });

  describe("启用/禁用", () => {
    test("setEnabled 禁用 Hook", () => {
      registry.register(makeHook({ id: "toggle" }));
      const result = registry.setEnabled("toggle", false);
      expect(result).toBe(true);
      expect(registry.get("toggle").enabled).toBe(false);
    });

    test("setEnabled 启用 Hook", () => {
      registry.register(makeHook({ enabled: false, id: "toggle" }));
      registry.setEnabled("toggle", true);
      expect(registry.get("toggle").enabled).toBe(true);
    });

    test("setEnabled 不存在的 Hook 返回 false", () => {
      expect(registry.setEnabled("nonexistent", true)).toBe(false);
    });
  });

  describe("清空", () => {
    test("clear 清空所有 Hook", () => {
      registry.register(makeHook({ id: "a" }));
      registry.register(makeHook({ id: "b" }));
      registry.clear();
      expect(registry.size).toBe(0);
    });
  });
});

/**
 * Hooks-config 白盒测试 — 纯函数:getAllConfigKeys, isActionTypeAllowed, CONFIG_KEY_TO_HOOK_EVENT。
 */
import { describe, expect, test } from "bun:test";
import { CONFIG_KEY_TO_HOOK_EVENT, HOOK_EVENT_TO_CONFIG_KEY, getAllConfigKeys, isActionTypeAllowed } from "@/config";
import type { HookEvent } from "@/hooks/types";

describe("getAllConfigKeys", () => {
  test("返回所有配置键", () => {
    const keys = getAllConfigKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain("beforeToolCall");
    expect(keys).toContain("afterToolCall");
    expect(keys).toContain("onUserMessage");
    expect(keys).toContain("onStop");
    expect(keys).toContain("onSubAgentComplete");
  });

  test("键是唯一的", () => {
    const keys = getAllConfigKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isActionTypeAllowed", () => {
  test("command 类型始终允许", () => {
    expect(isActionTypeAllowed("beforeToolCall", "command")).toBe(true);
    expect(isActionTypeAllowed("afterToolCall", "command")).toBe(true);
    expect(isActionTypeAllowed("onStop", "command")).toBe(true);
  });

  test("prompt 类型仅允许 onStop", () => {
    expect(isActionTypeAllowed("onStop", "prompt")).toBe(true);
  });

  test("prompt 类型仅允许 onSubAgentComplete", () => {
    expect(isActionTypeAllowed("onSubAgentComplete", "prompt")).toBe(true);
  });

  test("prompt 类型拒绝其他键", () => {
    expect(isActionTypeAllowed("beforeToolCall", "prompt")).toBe(false);
    expect(isActionTypeAllowed("afterToolCall", "prompt")).toBe(false);
    expect(isActionTypeAllowed("onUserMessage", "prompt")).toBe(false);
    expect(isActionTypeAllowed("toolConfirmation", "prompt")).toBe(false);
  });
});

describe("HOOK_EVENT_TO_CONFIG_KEY", () => {
  test("HookEvent 映射完整", () => {
    expect(HOOK_EVENT_TO_CONFIG_KEY.PreToolUse).toBe("beforeToolCall");
    expect(HOOK_EVENT_TO_CONFIG_KEY.PostToolUse).toBe("afterToolCall");
    expect(HOOK_EVENT_TO_CONFIG_KEY.UserMessage).toBe("onUserMessage");
    expect(HOOK_EVENT_TO_CONFIG_KEY.Stop).toBe("onStop");
  });

  test("反向映射一致", () => {
    for (const [event, key] of Object.entries(HOOK_EVENT_TO_CONFIG_KEY) as [string, string][]) {
      expect((CONFIG_KEY_TO_HOOK_EVENT as Record<string, string>)[key]).toBe(event);
    }
  });
});

/**
 * Hook 策略测试 — 按 Hook 事件类型解释执行结果。
 *
 * 测试覆盖:
 *   - interpretHookResult 统一入口
 *   - PreToolUse: 成功继续 / 失败阻止 / 替换内容
 *   - PostToolUse: 成功继续 / 失败替换 / 严重失败阻止
 *   - UserMessage: 替换消息 / 阻止
 *   - ToolConfirmation: 警告 / 阻止
 *   - Compress: 警告 / 阻止
 *   - SubAgentStop: inject 消息注入
 *   - Stop: inject + shouldContinue
 *   - SessionStart/SessionEnd/Notification: 警告
 *   - SkillExecute: 警告 / 阻止
 *   - 空结果集
 */
import { describe, expect, test } from "bun:test";
import type { HookDecision, HookEvent, HookResult } from "@/hooks/types";
import { interpretHookResult } from "@/hooks/hookStrategies";

/** 创建成功的 HookResult */
function makeSuccess(overrides: Partial<HookResult> = {}): HookResult {
  return {
    decision: { action: "pass" },
    duration: 10,
    event: "PreToolUse",
    hookId: "hook-ok",
    hookName: "OK Hook",
    success: true,
    ...overrides,
  };
}

/** 创建失败的 HookResult */
function makeFailure(overrides: Partial<HookResult> = {}): HookResult {
  return {
    decision: { action: "block" },
    duration: 20,
    error: "something went wrong",
    event: "PreToolUse",
    hookId: "hook-fail",
    hookName: "Fail Hook",
    success: false,
    ...overrides,
  };
}

describe("interpretHookResult", () => {
  describe("空结果", () => {
    test("空数组返回 continue", () => {
      const result = interpretHookResult("PreToolUse", []);
      expect(result.action).toBe("continue");
    });

    test("全部成功返回 continue", () => {
      const result = interpretHookResult("PreToolUse", [makeSuccess(), makeSuccess()]);
      expect(result.action).toBe("continue");
    });
  });

  describe("PreToolUse", () => {
    test("全部成功 → continue", () => {
      const result = interpretHookResult("PreToolUse", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("block 决策 → block", () => {
      const result = interpretHookResult("PreToolUse", [
        makeFailure({ decision: { action: "block" }, error: "安全检查" }),
      ]);
      expect(result.action).toBe("block");
    });

    test("replace 决策 → block + replacedContent", () => {
      const result = interpretHookResult("PreToolUse", [
        makeFailure({ decision: { action: "replace", output: "替代" }, error: "警告" }),
      ]);
      expect(result.action).toBe("block");
      expect(result.replacedContent).toBeTruthy();
    });
  });

  describe("PostToolUse", () => {
    test("全部成功 → continue", () => {
      const result = interpretHookResult("PostToolUse", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("block 决策 → block + hookFailed", () => {
      const result = interpretHookResult("PostToolUse", [makeFailure({ decision: { action: "block" } })]);
      expect(result.action).toBe("block");
      expect(result.hookFailed).toBe(true);
    });

    test("replace 决策 → replace + replacedContent", () => {
      const result = interpretHookResult("PostToolUse", [
        makeFailure({ decision: { action: "replace", output: { text: "替代输出" } }, output: "out" }),
      ]);
      expect(result.action).toBe("replace");
      expect(result.replacedContent).toBeTruthy();
    });
  });

  describe("UserMessage", () => {
    test("全部成功 → continue", () => {
      const result = interpretHookResult("UserMessage", [makeSuccess()], "原始消息");
      expect(result.action).toBe("continue");
    });

    test("replace → 用输出替换原始内容", () => {
      const result = interpretHookResult(
        "UserMessage",
        [makeFailure({ decision: { action: "replace", output: "修改后" }, error: "warn" })],
        "原始消息",
      );
      expect(result.action).toBe("replace");
      expect(result.replacedContent).toBeTruthy();
    });

    test("block → 阻止", () => {
      const result = interpretHookResult("UserMessage", [makeFailure({ decision: { action: "block" } })]);
      expect(result.action).toBe("block");
    });
  });

  describe("ToolConfirmation", () => {
    test("全部成功 → continue", () => {
      const result = interpretHookResult("ToolConfirmation", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("替换 → 警告", () => {
      const result = interpretHookResult("ToolConfirmation", [
        makeFailure({ decision: { action: "replace", output: "注意" }, error: "warning", output: "out" }),
      ]);
      expect(result.action).toBe("warn");
      expect(result.warningMessage).toBeTruthy();
    });

    test("拦截 → 拦截", () => {
      const result = interpretHookResult("ToolConfirmation", [makeFailure({ decision: { action: "block" } })]);
      expect(result.action).toBe("block");
    });
  });

  describe("Compress", () => {
    test("全部成功 → continue", () => {
      const result = interpretHookResult("Compress", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("替换 → 警告", () => {
      const result = interpretHookResult("Compress", [
        makeFailure({ decision: { action: "replace", output: "压缩警告" }, error: "warn" }),
      ]);
      expect(result.action).toBe("warn");
      expect(result.warningMessage).toContain("beforeCompress");
    });

    test("拦截 → 拦截 + hookFailed", () => {
      const result = interpretHookResult("Compress", [makeFailure({ decision: { action: "block" } })]);
      expect(result.action).toBe("block");
      expect(result.hookFailed).toBe(true);
    });
  });

  describe("SubAgentStop", () => {
    test("全部成功 + 无 inject → continue(无注入)", () => {
      const result = interpretHookResult("SubAgentStop", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("inject 决策 → 注入消息", () => {
      const result = interpretHookResult("SubAgentStop", [
        makeSuccess({
          decision: {
            action: "inject",
            message: "继续执行",
            shouldContinueConversation: true,
          } as HookDecision,
        }),
      ]);
      expect(result.action).toBe("continue");
      expect(result.injectedMessages).toBeDefined();
      expect(result.injectedMessages!.length).toBe(1);
      expect(result.injectedMessages![0]!.content).toBe("继续执行");
      expect(result.shouldContinueConversation).toBe(true);
    });

    test("失败 + block → 注入错误消息", () => {
      const result = interpretHookResult("SubAgentStop", [
        makeFailure({ decision: { action: "block" }, error: "子代理崩溃" }),
      ]);
      expect(result.injectedMessages).toBeDefined();
      expect(result.injectedMessages!.length).toBe(1);
      expect(result.injectedMessages![0]!.content).toContain("子代理崩溃");
    });

    test("空结果 → continue", () => {
      const result = interpretHookResult("SubAgentStop", []);
      expect(result.action).toBe("continue");
    });
  });

  describe("Stop", () => {
    test("inject 决策 → 注入消息", () => {
      const result = interpretHookResult("Stop", [
        makeSuccess({
          decision: {
            action: "inject",
            message: "还没完成",
            shouldContinueConversation: true,
          } as HookDecision,
        }),
      ]);
      expect(result.action).toBe("continue");
      expect(result.shouldContinueConversation).toBe(true);
      expect(result.injectedMessages!.length).toBe(1);
    });

    test("失败 block → 注入错误", () => {
      const result = interpretHookResult("Stop", [makeFailure({ decision: { action: "block" }, error: "stop-error" })]);
      expect(result.injectedMessages).toBeDefined();
      expect(result.shouldContinueConversation).toBe(true);
    });

    test("空结果 → continue", () => {
      const result = interpretHookResult("Stop", []);
      expect(result.action).toBe("continue");
    });
  });

  describe("Notification", () => {
    test("成功 → continue", () => {
      const result = interpretHookResult("Notification", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("失败 → warn", () => {
      const result = interpretHookResult("Notification", [makeFailure({ error: "通知失败" })]);
      expect(result.action).toBe("warn");
      expect(result.warningMessage).toContain("通知失败");
    });
  });

  describe("SessionStart", () => {
    test("成功 → continue", () => {
      const result = interpretHookResult("SessionStart", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("替换 → 警告", () => {
      const result = interpretHookResult("SessionStart", [
        makeFailure({ decision: { action: "replace", output: "x" }, error: "warn", output: "o" }),
      ]);
      expect(result.action).toBe("warn");
    });
  });

  describe("SessionEnd", () => {
    test("成功 → continue", () => {
      const result = interpretHookResult("SessionEnd", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("失败 → warn", () => {
      const result = interpretHookResult("SessionEnd", [makeFailure({ error: "end-warn" })]);
      expect(result.action).toBe("warn");
    });
  });

  describe("SkillExecute", () => {
    test("成功 → continue", () => {
      const result = interpretHookResult("SkillExecute", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("拦截 → 拦截 + hookFailed", () => {
      const result = interpretHookResult("SkillExecute", [makeFailure({ decision: { action: "block" } })]);
      expect(result.action).toBe("block");
      expect(result.hookFailed).toBe(true);
    });

    test("替换 → 警告", () => {
      const result = interpretHookResult("SkillExecute", [
        makeFailure({ decision: { action: "replace", output: "skill-warn" }, error: "w" }),
      ]);
      expect(result.action).toBe("warn");
    });
  });

  describe("SubAgentStart", () => {
    test("成功 → continue", () => {
      const result = interpretHookResult("SubAgentStart", [makeSuccess()]);
      expect(result.action).toBe("continue");
    });

    test("拦截 → 拦截 + hookFailed", () => {
      const result = interpretHookResult("SubAgentStart", [makeFailure({ decision: { action: "block" } })]);
      expect(result.action).toBe("block");
      expect(result.hookFailed).toBe(true);
    });
  });

  describe("所有 HookEvent 都有策略", () => {
    const events: HookEvent[] = [
      "PreToolUse",
      "PostToolUse",
      "UserMessage",
      "ToolConfirmation",
      "Compress",
      "Notification",
      "Stop",
      "SubAgentStart",
      "SubAgentStop",
      "SessionStart",
      "SessionEnd",
      "SkillExecute",
    ];

    for (const event of events) {
      test(`${event}: 空结果返回 continue`, () => {
        const result = interpretHookResult(event, []);
        expect(result.action).toBe("continue");
      });

      test(`${event}: 全部成功返回 continue`, () => {
        const result = interpretHookResult(event, [makeSuccess({ event })]);
        expect(result.action).toBe("continue");
      });
    }
  });
});

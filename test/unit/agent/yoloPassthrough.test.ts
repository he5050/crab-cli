/**
 * YOLO 透传测试。
 *
 * 覆盖导出:
 *   - isYoloPassthroughActive
 *   - getYoloPassthroughRuleset
 *   - shouldAutoApproveSubAgentTool
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  getYoloPassthroughRuleset,
  isYoloPassthroughActive,
  resetModeState,
  shouldAutoApproveSubAgentTool,
  switchMode,
} from "@/agent";

describe("YOLO 透传", () => {
  beforeEach(() => {
    resetModeState();
  });

  describe("isYoloPassthroughActive", () => {
    test("默认返回 false", () => {
      expect(isYoloPassthroughActive()).toBe(false);
    });

    test("开启 YOLO 后返回 true", () => {
      switchMode("yolo");
      expect(isYoloPassthroughActive()).toBe(true);
    });

    test("再次切换关闭 YOLO", () => {
      switchMode("yolo");
      switchMode("yolo");
      expect(isYoloPassthroughActive()).toBe(false);
    });
  });

  describe("getYoloPassthroughRuleset", () => {
    test("非 YOLO 模式返回 null", () => {
      expect(getYoloPassthroughRuleset()).toBeNull();
    });

    test("YOLO 激活时返回通配 allow 规则集", () => {
      switchMode("yolo");
      const ruleset = getYoloPassthroughRuleset();
      expect(ruleset).not.toBeNull();
      expect(ruleset).toHaveLength(1);
      expect(ruleset![0]!.action).toBe("allow");
      expect(ruleset![0]!.pattern).toBe("*");
      expect(ruleset![0]!.permission).toBe("*");
    });

    test("YOLO 关闭后再次返回 null", () => {
      switchMode("yolo");
      switchMode("yolo");
      expect(getYoloPassthroughRuleset()).toBeNull();
    });
  });

  describe("shouldAutoApproveSubAgentTool", () => {
    test("autoApprove=true 时直接返回 true", () => {
      expect(shouldAutoApproveSubAgentTool("bash", true)).toBe(true);
    });

    test("autoApprove=false 且非 YOLO 时返回 false", () => {
      expect(shouldAutoApproveSubAgentTool("bash", false)).toBe(false);
    });

    test("autoApprove=undefined 且非 YOLO 时返回 false", () => {
      expect(shouldAutoApproveSubAgentTool("bash")).toBe(false);
    });

    test("YOLO 激活且 autoApprove=false 时返回 true", () => {
      switchMode("yolo");
      expect(shouldAutoApproveSubAgentTool("bash", false)).toBe(true);
    });

    test("YOLO 激活且 autoApprove=undefined 时返回 true", () => {
      switchMode("yolo");
      expect(shouldAutoApproveSubAgentTool("bash")).toBe(true);
    });

    test("autoApprove 优先级高于 YOLO 透传", () => {
      // autoApprove=true 不依赖 YOLO 状态
      expect(shouldAutoApproveSubAgentTool("bash", true)).toBe(true);
      // YOLO 关闭时 autoApprove=false 仍然 false
      resetModeState();
      expect(shouldAutoApproveSubAgentTool("bash", false)).toBe(false);
    });
  });
});

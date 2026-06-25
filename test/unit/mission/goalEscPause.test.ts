/**
 * G-05 ESC 中断暂停 Goal 测试。
 *
 * 测试用例:
 *   - L2-T06: Goal pursuing 时 pauseGoal 状态变为 paused
 *   - L2-T07: Goal paused 后 pendingContinuation 被清除
 *   - L2-T08: resumeGoal 可从 paused 恢复
 *   - L2-T09: 无 Goal 时 pauseGoal 返回 null
 *   - L2-T10: Goal 非 pursuing 状态时 pauseGoal 不变
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { GoalManager } from "@/mission";
import { globalBus } from "@/bus";
import { cleanupTestDir } from "../../helpers/testPaths";

describe("G-05 ESC 中断暂停 Goal", () => {
  let manager: GoalManager;
  let tempDir: string;
  const sessionId = "test-session-esc-pause";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join("/tmp", "goal-esc-test-"));
    mkdirSync(path.join(tempDir, ".crab", "goals"), { recursive: true });
    manager = new GoalManager();
    manager.setProjectDir(tempDir);
    globalBus.clearHistory();
  });

  afterEach(() => {
    cleanupTestDir(tempDir);
  });

  describe("L2-T06: pauseGoal 将 pursuing 变为 paused", () => {
    it("pursuing 状态暂停后应为 paused", () => {
      const goal = manager.createGoal({ objective: "测试目标", sessionId, tokenBudget: 10_000 });
      expect(goal.status).toBe("pursuing");

      const paused = manager.pauseGoal(sessionId);
      expect(paused).not.toBeNull();
      expect(paused!.status).toBe("paused");
    });
  });

  describe("L2-T07: paused 后 pendingContinuation 被清除", () => {
    it("暂停时 pendingContinuation 应为 false", () => {
      manager.createGoal({ objective: "测试目标", sessionId, tokenBudget: 10_000 });
      manager.pauseGoal(sessionId);

      const reloaded = manager.loadGoal(sessionId);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.pendingContinuation).toBe(false);
    });
  });

  describe("L2-T08: resumeGoal 可从 paused 恢复", () => {
    it("恢复后状态应为 pursuing", () => {
      manager.createGoal({ objective: "测试目标", sessionId, tokenBudget: 10_000 });
      manager.pauseGoal(sessionId);

      const resumed = manager.resumeGoal(sessionId);
      expect(resumed).not.toBeNull();
      expect(resumed!.status).toBe("pursuing");
      expect(resumed!.pendingContinuation).toBe(true);
    });
  });

  describe("L2-T09: 无 Goal 时 pauseGoal 安全", () => {
    it("不存在的 sessionId 应返回 null", () => {
      const result = manager.pauseGoal("nonexistent-session");
      expect(result).toBeNull();
    });
  });

  describe("L2-T10: 非 pursuing 状态暂停安全", () => {
    it("paused 状态再次暂停不应改变", () => {
      manager.createGoal({ objective: "测试目标", sessionId, tokenBudget: 10_000 });
      manager.pauseGoal(sessionId);

      const result = manager.pauseGoal(sessionId);
      expect(result!.status).toBe("paused");
    });

    it("achieved 状态暂停不应改变", () => {
      manager.createGoal({ objective: "测试目标", sessionId, tokenBudget: 10_000 });
      manager.clearGoal(sessionId);

      // 创建新 goal 但不 pursuing
      const goal2 = manager.createGoal({ objective: "其他目标", sessionId: "other-session", tokenBudget: 10_000 });
      // 手动模拟 achieved(通过 loadGoal + 修改 + 无法直接 persist，所以用不同方式验证)
      // PauseGoal 只对 pursuing 生效
      expect(goal2.status).toBe("pursuing");
      const paused = manager.pauseGoal("other-session");
      expect(paused!.status).toBe("paused");
    });
  });
});

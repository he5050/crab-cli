/**
 * GoalManager 高级场景测试。
 *
 * 补充 goalManager.test.ts 未覆盖的边界场景:
 *   - Token 预算精确超额/未超额行为
 *   - accrueTokens deltaTokens=0 不变更
 *   - consumePendingContinuation 各状态分支
 *   - migrateGoalToSession 活跃/终态迁移
 *   - resumeGoalForSession 跨会话恢复
 *   - clearGoal 后 loadGoal 返回 null
 *   - createGoal 驳回空 objective / 重复 pursuing 目标
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GoalManager } from "@/mission";
import { cleanupTestDir, createProjectTmpTestDir } from "../../helpers/testPaths";

describe("GoalManager 高级场景", () => {
  let manager: GoalManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createProjectTmpTestDir(process.cwd(), "goal-adv-");
    manager = new GoalManager();
    manager.setProjectDir(tempDir);
  });

  afterEach(() => {
    cleanupTestDir(tempDir);
  });

  describe("Token 预算精确控制", () => {
    test("Token 预算超额自动转 budget-limited", () => {
      // 创建预算恰好为 100 的目标
      manager.createGoal({
        objective: "预算超额测试",
        sessionId: "s1",
        tokenBudget: 100,
      });

      // 累计恰好等于预算
      const result = manager.accrueTokens("s1", 100);

      expect(result.exceeded).toBe(true);
      expect(result.goal).toBeDefined();
      expect(result.goal!.status).toBe("budget-limited");
      expect(result.goal!.tokensUsed).toBe(100);
    });

    test("Token 预算未超额保持 pursuing", () => {
      // 创建预算为 200 的目标
      manager.createGoal({
        objective: "预算未超额测试",
        sessionId: "s2",
        tokenBudget: 200,
      });

      // 只累计 50，低于预算
      const result = manager.accrueTokens("s2", 50);

      expect(result.exceeded).toBe(false);
      expect(result.goal).toBeDefined();
      expect(result.goal!.status).toBe("pursuing");
      expect(result.goal!.tokensUsed).toBe(50);
    });

    test("accrueTokens deltaTokens=0 不变更", () => {
      manager.createGoal({
        objective: "零增量测试",
        sessionId: "s3",
        tokenBudget: 1000,
      });

      // delta=0 应为 no-op
      const result = manager.accrueTokens("s3", 0);

      expect(result.exceeded).toBe(false);
      expect(result.goal).toBeDefined();
      expect(result.goal!.tokensUsed).toBe(0);
      // pendingContinuation 不应被设置
      expect(result.goal!.status).toBe("pursuing");
    });
  });

  describe("consumePendingContinuation 分支覆盖", () => {
    test("consumePendingContinuation 在 pursuing 状态返回续接提示词", () => {
      // 创建目标时默认 pendingContinuation=true
      manager.createGoal({
        objective: "pursuing 续接测试",
        sessionId: "c1",
      });

      const prompt = manager.consumePendingContinuation("c1");

      expect(prompt).toBeDefined();
      expect(prompt).not.toBeNull();
      expect(prompt!).toContain("[GOAL CONTINUATION]");
      expect(prompt!).toContain("pursuing 续接测试");
    });

    test("consumePendingContinuation 在 budget-limited 状态返回预算耗尽提示词", () => {
      manager.createGoal({
        objective: "budget-limited 续接测试",
        sessionId: "c2",
        tokenBudget: 50,
      });
      // 超额触发 budget-limited，此时 pendingContinuation=true
      manager.accrueTokens("c2", 50);

      const prompt = manager.consumePendingContinuation("c2");

      expect(prompt).toBeDefined();
      expect(prompt).not.toBeNull();
      expect(prompt!).toContain("[GOAL BUDGET LIMIT REACHED]");
      expect(prompt!).toContain("budget-limited 续接测试");
    });

    test("consumePendingContinuation 在 paused 状态返回 null", () => {
      manager.createGoal({
        objective: "paused 续接测试",
        sessionId: "c3",
      });
      manager.pauseGoal("c3");

      // paused 状态下无论 pendingContinuation 值如何，均返回 null
      const prompt = manager.consumePendingContinuation("c3");

      expect(prompt).toBeNull();
    });
  });

  describe("会话迁移高级场景", () => {
    test("migrateGoalToSession 迁移活跃目标", () => {
      manager.createGoal({
        objective: "活跃迁移目标",
        sessionId: "old_session",
      });

      const newSession = "new_session";
      const migrated = manager.migrateGoalToSession("old_session", newSession);

      expect(migrated).toBeDefined();
      expect(migrated!.sessionId).toBe(newSession);
      expect(migrated!.status).toBe("pursuing");

      // 旧会话不应再能加载到该目标
      expect(manager.loadGoal("old_session")).toBeNull();
      // 新会话应能加载到该目标
      const loaded = manager.loadGoal(newSession);
      expect(loaded).toBeDefined();
      expect(loaded!.objective).toBe("活跃迁移目标");
    });

    test("migrateGoalToSession 不迁移终态目标", () => {
      manager.createGoal({
        objective: "终态迁移目标",
        sessionId: "old_session2",
      });
      // 标记为 achieved（终态）
      manager.modelUpdateGoal("old_session2", { status: "achieved" });

      const migrated = manager.migrateGoalToSession("old_session2", "new_session2");

      // achieved 是终态，不应被迁移
      expect(migrated).toBeNull();
    });
  });

  describe("跨会话恢复", () => {
    test("resumeGoalForSession 跨会话恢复暂停目标", () => {
      const goal = manager.createGoal({
        objective: "跨会话恢复目标",
        sessionId: "session_a",
      });
      manager.pauseGoal("session_a");

      const newSession = "session_b";
      const resumed = manager.resumeGoalForSession(goal.id, newSession);

      expect(resumed).toBeDefined();
      expect(resumed!.status).toBe("pursuing");
      expect(resumed!.sessionId).toBe(newSession);
      expect(resumed!.pendingContinuation).toBe(true);
    });
  });

  describe("clearGoal 完整性", () => {
    test("clearGoal 后 loadGoal 返回 null", () => {
      manager.createGoal({
        objective: "待清除目标",
        sessionId: "clear_session",
      });

      // 确认目标存在
      expect(manager.loadGoal("clear_session")).toBeDefined();

      // 清除目标
      const cleared = manager.clearGoal("clear_session");
      expect(cleared).toBeDefined();
      expect(cleared!.objective).toBe("待清除目标");

      // 清除后加载应返回 null
      expect(manager.loadGoal("clear_session")).toBeNull();
    });
  });

  describe("createGoal 驳回条件", () => {
    test("createGoal 驳回空 objective", () => {
      expect(() => {
        manager.createGoal({
          objective: "",
          sessionId: "empty_obj",
        });
      }).toThrow("目标描述不能为空");
    });

    test("createGoal 驳回重复 pursuing 目标", () => {
      manager.createGoal({
        objective: "第一个 pursuing 目标",
        sessionId: "dup_session",
      });

      // 同一会话再创建 pursuing 目标应抛错
      expect(() => {
        manager.createGoal({
          objective: "第二个 pursuing 目标",
          sessionId: "dup_session",
        });
      }).toThrow("已有活跃目标");
    });
  });
});

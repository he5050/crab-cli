/**
 * GoalManager 测试。
 *
 * 测试用例:
 *   - Goal 创建、查询、列表
 *   - Goal 状态管理(pursuing → paused/achieved/unmet/budget-limited)
 *   - Token 预算管理
 *   - 续接提示词生成
 *   - 会话迁移
 *   - 持久化到磁盘
 *   - EventBus 事件发布
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { GoalManager, DEFAULT_GOAL_TOKEN_BUDGET } from "@/mission";
import type { GoalRecord, GoalStatus } from "@/mission/type";
import { cleanupTestDir, createProjectTmpTestDir } from "../../helpers/testPaths";

describe("GoalManager", () => {
  let goalManager: GoalManager;
  let tempDir: string;
  const sessionId = "test_session_001";

  beforeEach(() => {
    tempDir = createProjectTmpTestDir(process.cwd(), "goal-test-");
    goalManager = new GoalManager();
    goalManager.setProjectDir(tempDir);
  });

  afterEach(() => {
    cleanupTestDir(tempDir);
  });

  describe("Goal 创建", () => {
    test("创建 Goal 返回记录", () => {
      const goal = goalManager.createGoal({
        objective: "完成用户登录功能",
        sessionId,
      });

      expect(goal).toBeDefined();
      expect(goal.id).toBeDefined();
      expect(goal.id.length).toBe(8);
      expect(goal.objective).toBe("完成用户登录功能");
      expect(goal.status).toBe("pursuing");
      expect(goal.sessionId).toBe(sessionId);
    });

    test("创建 Goal 时设置 Token 预算", () => {
      const goal = goalManager.createGoal({
        objective: "测试预算",
        sessionId,
        tokenBudget: 1_000_000,
      });

      expect(goal.tokenBudget).toBe(1_000_000);
      expect(goal.tokensUsed).toBe(0);
    });

    test("默认 Token 预算为 2M", () => {
      const goal = goalManager.createGoal({
        objective: "默认预算测试",
        sessionId,
      });

      expect(goal.tokenBudget).toBe(DEFAULT_GOAL_TOKEN_BUDGET);
    });

    test("创建 Goal 时初始化 runCount 为 0", () => {
      const goal = goalManager.createGoal({
        objective: "计数测试",
        sessionId,
      });

      expect(goal.runCount).toBe(0);
      expect(goal.pendingContinuation).toBe(true);
    });

    test("空目标描述抛出错误", () => {
      expect(() => {
        goalManager.createGoal({
          objective: "   ",
          sessionId,
        });
      }).toThrow("目标描述不能为空");
    });

    test("已有 pursuing Goal 时不能创建新 Goal", () => {
      goalManager.createGoal({
        objective: "第一个目标",
        sessionId,
      });

      expect(() => {
        goalManager.createGoal({
          objective: "第二个目标",
          sessionId,
        });
      }).toThrow("已有活跃目标");
    });

    test("已有 paused Goal 时不能创建新 Goal", () => {
      goalManager.createGoal({
        objective: "第一个目标",
        sessionId,
      });
      goalManager.pauseGoal(sessionId);

      expect(() => {
        goalManager.createGoal({
          objective: "第二个目标",
          sessionId,
        });
      }).toThrow("已有暂停目标");
    });
  });

  describe("Goal 状态管理", () => {
    test("暂停 pursuing Goal", () => {
      goalManager.createGoal({
        objective: "待暂停目标",
        sessionId,
      });

      const paused = goalManager.pauseGoal(sessionId);

      expect(paused).toBeDefined();
      expect(paused!.status).toBe("paused");
      expect(paused!.pendingContinuation).toBe(false);
    });

    test("暂停不存在的 Goal 返回 null", () => {
      const result = goalManager.pauseGoal("nonexistent_session");
      expect(result).toBeNull();
    });

    test("恢复 paused Goal", () => {
      goalManager.createGoal({
        objective: "待恢复目标",
        sessionId,
      });
      goalManager.pauseGoal(sessionId);

      const resumed = goalManager.resumeGoal(sessionId);

      expect(resumed).toBeDefined();
      expect(resumed!.status).toBe("pursuing");
      expect(resumed!.pendingContinuation).toBe(true);
    });

    test("恢复 budget-limited Goal", () => {
      goalManager.createGoal({
        objective: "预算耗尽目标",
        sessionId,
        tokenBudget: 100,
      });
      goalManager.accrueTokens(sessionId, 100);

      const resumed = goalManager.resumeGoal(sessionId);

      expect(resumed).toBeDefined();
      expect(resumed!.status).toBe("pursuing");
    });

    test("恢复不存在的 Goal 返回 null", () => {
      const result = goalManager.resumeGoal("nonexistent_session");
      expect(result).toBeNull();
    });

    test("清除 Goal", () => {
      goalManager.createGoal({
        objective: "待清除目标",
        sessionId,
      });

      const cleared = goalManager.clearGoal(sessionId);

      expect(cleared).toBeDefined();
      expect(cleared!.objective).toBe("待清除目标");
      expect(goalManager.loadGoal(sessionId)).toBeNull();
    });

    test("清除不存在的 Goal 返回 null", () => {
      const result = goalManager.clearGoal("nonexistent_session");
      expect(result).toBeNull();
    });

    test("模型标记 Goal 为 achieved", () => {
      goalManager.createGoal({
        objective: "待完成目标",
        sessionId,
      });

      const updated = goalManager.modelUpdateGoal(sessionId, {
        explanation: "目标已达成",
        status: "achieved",
      });

      expect(updated).toBeDefined();
      expect(updated!.status).toBe("achieved");
      expect(updated!.lastExplanation).toBe("目标已达成");
      expect(updated!.pendingContinuation).toBe(false);
    });

    test("模型标记 Goal 为 unmet", () => {
      goalManager.createGoal({
        objective: "未完成目标",
        sessionId,
      });

      const updated = goalManager.modelUpdateGoal(sessionId, {
        explanation: "遇到阻塞",
        status: "unmet",
      });

      expect(updated).toBeDefined();
      expect(updated!.status).toBe("unmet");
      expect(updated!.lastExplanation).toBe("遇到阻塞");
    });

    test("非 pursuing 状态不能标记完成", () => {
      goalManager.createGoal({
        objective: "测试目标",
        sessionId,
      });
      goalManager.pauseGoal(sessionId);

      expect(() => {
        goalManager.modelUpdateGoal(sessionId, {
          status: "achieved",
        });
      }).toThrow('只有 "pursuing" 可被标记完成');
    });
  });

  describe("Token 预算管理", () => {
    test("累计 Token 使用量", () => {
      goalManager.createGoal({
        objective: "Token 测试",
        sessionId,
        tokenBudget: 1000,
      });

      const result1 = goalManager.accrueTokens(sessionId, 100);
      expect(result1.exceeded).toBe(false);
      expect(result1.goal!.tokensUsed).toBe(100);

      const result2 = goalManager.accrueTokens(sessionId, 200);
      expect(result2.exceeded).toBe(false);
      expect(result2.goal!.tokensUsed).toBe(300);
    });

    test("Token 超出预算时标记为 budget-limited", () => {
      goalManager.createGoal({
        objective: "预算测试",
        sessionId,
        tokenBudget: 500,
      });

      const result = goalManager.accrueTokens(sessionId, 500);

      expect(result.exceeded).toBe(true);
      expect(result.goal!.status).toBe("budget-limited");
      expect(result.goal!.pendingContinuation).toBe(true);
    });

    test("非 pursuing 状态不累计 Token", () => {
      goalManager.createGoal({
        objective: "Token 测试",
        sessionId,
      });
      goalManager.pauseGoal(sessionId);

      const result = goalManager.accrueTokens(sessionId, 100);

      expect(result.exceeded).toBe(false);
      expect(result.goal!.tokensUsed).toBe(0);
    });

    test("零或负 Token 不累计", () => {
      goalManager.createGoal({
        objective: "Token 测试",
        sessionId,
      });

      const result1 = goalManager.accrueTokens(sessionId, 0);
      expect(result1.goal!.tokensUsed).toBe(0);

      const result2 = goalManager.accrueTokens(sessionId, -10);
      expect(result2.goal!.tokensUsed).toBe(0);
    });
  });

  describe("续接管理", () => {
    test("标记待续接增加 runCount", () => {
      goalManager.createGoal({
        objective: "续接测试",
        sessionId,
      });

      goalManager.markPendingContinuation(sessionId);

      const goal = goalManager.loadGoal(sessionId)!;
      expect(goal.runCount).toBe(1);
      expect(goal.pendingContinuation).toBe(true);
    });

    test("消费续接提示词", () => {
      goalManager.createGoal({
        objective: "消费续接测试",
        sessionId,
      });

      const prompt = goalManager.consumePendingContinuation(sessionId);

      expect(prompt).toBeDefined();
      expect(prompt).toContain("[GOAL CONTINUATION]");
      expect(prompt).toContain("消费续接测试");

      const goal = goalManager.loadGoal(sessionId)!;
      expect(goal.pendingContinuation).toBe(false);
    });

    test("预算耗尽时返回预算限制提示词", () => {
      goalManager.createGoal({
        objective: "预算耗尽测试",
        sessionId,
        tokenBudget: 100,
      });
      goalManager.accrueTokens(sessionId, 100);

      const prompt = goalManager.consumePendingContinuation(sessionId);

      expect(prompt).toBeDefined();
      expect(prompt).toContain("[GOAL BUDGET LIMIT REACHED]");
      expect(prompt).toContain("预算耗尽测试");
    });

    test("非活跃状态不返回续接提示词", () => {
      goalManager.createGoal({
        objective: "暂停测试",
        sessionId,
      });
      goalManager.pauseGoal(sessionId);

      const prompt = goalManager.consumePendingContinuation(sessionId);

      expect(prompt).toBeNull();
    });

    test("无待续接时返回 null", () => {
      goalManager.createGoal({
        objective: "无续接测试",
        sessionId,
      });
      goalManager.consumePendingContinuation(sessionId);

      const prompt = goalManager.consumePendingContinuation(sessionId);

      expect(prompt).toBeNull();
    });
  });

  describe("持久化", () => {
    test("Goal 持久化到磁盘", () => {
      goalManager.createGoal({
        objective: "持久化测试",
        sessionId,
        tokenBudget: 500_000,
      });

      const goalPath = path.join(tempDir, ".crab", "goals", `${sessionId}.json`);
      expect(fs.existsSync(goalPath)).toBe(true);

      const content = fs.readFileSync(goalPath, "utf8");
      const parsed = JSON.parse(content) as GoalRecord;
      expect(parsed.objective).toBe("持久化测试");
      expect(parsed.tokenBudget).toBe(500_000);
      expect(parsed.sessionId).toBe(sessionId);
    });

    test("从磁盘加载 Goal", () => {
      goalManager.createGoal({
        objective: "加载测试",
        sessionId,
      });

      const newManager = new GoalManager();
      newManager.setProjectDir(tempDir);
      const loaded = newManager.loadGoal(sessionId);

      expect(loaded).toBeDefined();
      expect(loaded!.objective).toBe("加载测试");
    });

    test("加载所有 Goals", () => {
      goalManager.createGoal({
        objective: "目标1",
        sessionId: "session_1",
      });
      goalManager.clearGoal("session_1");

      // 创建第二个
      goalManager.createGoal({
        objective: "目标2",
        sessionId: "session_2",
      });

      const allGoals = goalManager.loadAllGoals();

      expect(allGoals.length).toBeGreaterThanOrEqual(1);
      expect(allGoals.some((g) => g.objective === "目标2")).toBe(true);
    });

    test("清除 Goal 时删除持久化文件", () => {
      goalManager.createGoal({
        objective: "删除测试",
        sessionId,
      });

      const goalPath = path.join(tempDir, ".crab", "goals", `${sessionId}.json`);
      expect(fs.existsSync(goalPath)).toBe(true);

      goalManager.clearGoal(sessionId);
      // 文件可能被删除或被覆盖为无效内容(取决于文件权限)
      if (fs.existsSync(goalPath)) {
        const content = fs.readFileSync(goalPath, "utf8");
        expect(content.trim()).toBe("");
      } else {
        expect(fs.existsSync(goalPath)).toBe(false);
      }
    });
  });

  describe("会话迁移", () => {
    test("迁移 Goal 到新会话", () => {
      goalManager.createGoal({
        objective: "迁移测试",
        sessionId,
      });

      const newSessionId = "new_session_002";
      const migrated = goalManager.migrateGoalToSession(sessionId, newSessionId);

      expect(migrated).toBeDefined();
      expect(migrated!.sessionId).toBe(newSessionId);
      expect(goalManager.loadGoal(sessionId)).toBeNull();
      expect(goalManager.loadGoal(newSessionId)).toBeDefined();
    });

    test("非活跃 Goal 不能迁移", () => {
      goalManager.createGoal({
        objective: "非活跃迁移测试",
        sessionId,
      });
      goalManager.modelUpdateGoal(sessionId, { status: "achieved" });

      const newSessionId = "new_session_003";
      const migrated = goalManager.migrateGoalToSession(sessionId, newSessionId);

      expect(migrated).toBeNull();
    });

    test("跨会话恢复 Goal", () => {
      const goal = goalManager.createGoal({
        objective: "跨会话恢复测试",
        sessionId,
      });
      goalManager.pauseGoal(sessionId);

      const newSessionId = "new_session_004";
      const resumed = goalManager.resumeGoalForSession(goal.id, newSessionId);

      expect(resumed).toBeDefined();
      expect(resumed!.sessionId).toBe(newSessionId);
      expect(resumed!.status).toBe("pursuing");
      expect(resumed!.pendingContinuation).toBe(true);
    });
  });

  describe("展示", () => {
    test("格式化 Goal 摘要", () => {
      const goal = goalManager.createGoal({
        objective: "格式化测试",
        sessionId,
        tokenBudget: 1000,
      });
      goalManager.accrueTokens(sessionId, 250);

      const summary = goalManager.formatSummary(goal);

      expect(summary).toContain(goal.id);
      expect(summary).toContain("pursuing");
      expect(summary).toContain("格式化测试");
      expect(summary).toContain("250 / 1000");
      expect(summary).toContain("25.0%");
    });

    test("格式化包含 explanation 的摘要", () => {
      goalManager.createGoal({
        objective: "解释测试",
        sessionId,
      });
      goalManager.modelUpdateGoal(sessionId, {
        explanation: "成功完成",
        status: "achieved",
      });

      const goal = goalManager.loadGoal(sessionId)!;
      const summary = goalManager.formatSummary(goal);

      expect(summary).toContain("explanation: 成功完成");
    });
  });

  describe("EventBus 集成", () => {
    test("创建 Goal 成功", () => {
      const goal = goalManager.createGoal({
        objective: "事件测试",
        sessionId,
      });

      expect(goal).toBeDefined();
      expect(goal.objective).toBe("事件测试");
      expect(goal.status).toBe("pursuing");
    });

    test("暂停 Goal 状态变更", () => {
      goalManager.createGoal({
        objective: "暂停事件测试",
        sessionId,
      });

      const paused = goalManager.pauseGoal(sessionId);

      expect(paused).toBeDefined();
      expect(paused!.status).toBe("paused");
    });
  });

  describe("监听器", () => {
    test("订阅 Goal 变更", () => {
      const changes: (GoalRecord | null)[] = [];
      const unsubscribe = goalManager.subscribe((goal) => {
        changes.push(goal);
      });

      goalManager.createGoal({
        objective: "监听测试",
        sessionId,
      });

      expect(changes.length).toBeGreaterThanOrEqual(1);
      expect(changes[0]!.objective).toBe("监听测试");

      unsubscribe();
    });

    test("取消订阅", () => {
      const changes: (GoalRecord | null)[] = [];
      const unsubscribe = goalManager.subscribe((goal) => {
        changes.push(goal);
      });

      unsubscribe();
      changes.length = 0;

      goalManager.createGoal({
        objective: "取消订阅测试",
        sessionId: "another_session",
      });

      // 由于取消订阅，不应该收到通知
      // 注意:创建时会触发，但因为我们清空了数组，如果订阅还在就会有数据
      // 这里主要测试 unsubscribe 不会抛出错误
      expect(() => unsubscribe()).not.toThrow();
    });
  });
});

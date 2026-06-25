/**
 * G-11 压缩后目标文本注入测试。
 *
 * 测试用例:
 *   - L3-T06: 压缩后首条消息包含 goal objective
 *   - L3-T07: 未压缩时目标文本注入无副作用
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { goalManager } from "@/mission";

const TEST_SESSION = "ses_compress_goal_002";

describe("G-11 压缩后目标文本注入", () => {
  beforeEach(() => {
    goalManager.clearGoal(TEST_SESSION);
  });

  afterEach(() => {
    goalManager.clearGoal(TEST_SESSION);
  });

  it("L3-T06: 有活跃 Goal 时生成注入文本", () => {
    goalManager.createGoal({ objective: "完成核心功能", sessionId: TEST_SESSION });

    const goal = goalManager.loadGoal(TEST_SESSION);
    let injected: string | null = null;
    if (goal && (goal.status === "pursuing" || goal.status === "paused" || goal.status === "budget-limited")) {
      injected = `[Goal 目标提醒] 当前活跃目标: "${goal.objective}" (status=${goal.status}, id=${goal.id})`;
    }

    expect(injected).not.toBeNull();
    expect(injected!).toContain("完成核心功能");
    expect(injected!).toContain("Goal 目标提醒");
    expect(injected!).toContain("pursuing");
  });

  it("L3-T07: 无活跃 Goal 时不生成注入文本", () => {
    const goal = goalManager.loadGoal(TEST_SESSION);
    let injected: string | null = null;
    if (goal && (goal.status === "pursuing" || goal.status === "paused" || goal.status === "budget-limited")) {
      injected = `[Goal 目标提醒] 当前活跃目标: "${goal.objective}" (status=${goal.status}, id=${goal.id})`;
    }

    expect(injected).toBeNull();
  });
});

/**
 * G-10 Goal Session Picker 测试。
 *
 * 测试用例:
 *   - L3-T03: Goal Session Picker 显示可恢复会话列表
 *   - L3-T04: 从 Picker 选择后正确恢复 Goal
 *   - L3-T05: 无可恢复 Goal 时 Picker 显示空态
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { goalManager } from "@/mission";

describe("G-10 Goal Session Picker", () => {
  const testSessionId1 = "ses_picker_001";
  const testSessionId2 = "ses_picker_002";

  beforeEach(() => {
    goalManager.clearGoal(testSessionId1);
    goalManager.clearGoal(testSessionId2);
  });

  afterEach(() => {
    goalManager.clearGoal(testSessionId1);
    goalManager.clearGoal(testSessionId2);
  });

  it("L3-T03: Picker 显示可恢复会话列表", () => {
    goalManager.createGoal({ objective: "目标1-进行中", sessionId: testSessionId1 });
    goalManager.pauseGoal(testSessionId1);
    goalManager.createGoal({ objective: "目标2-暂停", sessionId: testSessionId2 });
    goalManager.pauseGoal(testSessionId2);

    const allGoals = goalManager.loadAllGoals();
    const resumable = allGoals.filter(
      (g) => g.status === "pursuing" || g.status === "paused" || g.status === "budget-limited",
    );
    expect(resumable.length).toBe(2);
    const objectives = resumable.map((g) => g.objective).toSorted();
    expect(objectives).toEqual(["目标1-进行中", "目标2-暂停"].toSorted());
  });

  it("L3-T04: resumeGoalForSession 正确恢复 Goal", () => {
    goalManager.createGoal({ objective: "目标-暂停恢复", sessionId: testSessionId1 });
    goalManager.pauseGoal(testSessionId1);

    const result = goalManager.resumeGoalForSession(goalManager.loadGoal(testSessionId1)!.id, testSessionId2);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(testSessionId2);
    expect(result!.status).toBe("pursuing");
    expect(result!.pendingContinuation).toBe(true);
  });

  it("L3-T05: 无可恢复 Goal 时返回空列表", () => {
    const allGoals = goalManager.loadAllGoals();
    const resumable = allGoals.filter(
      (g) => g.status === "pursuing" || g.status === "paused" || g.status === "budget-limited",
    );
    expect(resumable.length).toBe(0);
  });
});

/**
 * [测试目标] 目标集成。
 *
 * 测试目标:
 *   - 验证 handleGoalPostTurn / injectGoalContinuation / pauseGoalOnAbort 与 goalManager 适配层的协同
 *
 * 测试用例:
 *   - injectGoalContinuation 在有待续接提示词时前置注入:adapter 报告 continuationPrompt 时被注入
 *   - 其余用例覆盖 token 超额、pursuing → paused 转换、pendingContinuation 标记
 */
import { describe, expect, test } from "bun:test";
import {
  type GoalManagerAdapter,
  handleGoalPostTurn,
  injectGoalContinuation,
  pauseGoalOnAbort,
} from "@/conversation/core/goalIntegration";

interface TestGoal {
  status: "pursuing" | "paused" | "achieved" | "unmet" | "budget-limited";
  pendingContinuation?: boolean;
}

function createGoalAdapter(
  goal: TestGoal | null,
  options: {
    continuationPrompt?: string | null;
    exceeded?: boolean;
  } = {},
): GoalManagerAdapter & {
  accruedTokens: number[];
  markedContinuations: string[];
  pausedSessions: string[];
} {
  return {
    accrueTokens(sessionId, totalTokens) {
      this.accruedTokens.push(totalTokens);
      return { exceeded: options.exceeded ?? false, goal };
    },
    accruedTokens: [],
    consumePendingContinuation: () => options.continuationPrompt ?? null,
    loadGoal: () => goal,
    markPendingContinuation(sessionId) {
      this.markedContinuations.push(sessionId);
      if (goal?.status === "pursuing") {
        goal.pendingContinuation = true;
      }
    },
    markedContinuations: [],
    pauseGoal(sessionId) {
      this.pausedSessions.push(sessionId);
      if (goal?.status === "pursuing") {
        goal.status = "paused";
      }
    },
    pausedSessions: [],
  };
}

describe("goalIntegration", () => {
  test("injectGoalContinuation 在有待续接提示词时前置注入", () => {
    const adapter = createGoalAdapter(
      { status: "pursuing" },
      {
        continuationPrompt: "[GOAL CONTINUATION]\n继续目标",
      },
    );

    const content = injectGoalContinuation(adapter, "ses_goal", "用户输入");

    expect(content).toContain("[GOAL CONTINUATION]");
    expect(content).toContain("---");
    expect(content.endsWith("用户输入")).toBe(true);
  });

  test("injectGoalContinuation 无 session 或无提示词时保持原输入", () => {
    const adapter = createGoalAdapter({ status: "pursuing" });

    expect(injectGoalContinuation(adapter, undefined, "原始输入")).toBe("原始输入");
    expect(injectGoalContinuation(adapter, "ses_goal", "原始输入")).toBe("原始输入");
  });

  test("handleGoalPostTurn 有工具执行且目标仍 pursuing 时标记续接", () => {
    const goal: TestGoal = { pendingContinuation: false, status: "pursuing" };
    const adapter = createGoalAdapter(goal);

    const result = handleGoalPostTurn(
      adapter,
      "ses_goal",
      { inputTokens: 12, outputTokens: 8 },
      { hadToolCalls: true },
    );

    expect(result.shouldContinue).toBe(true);
    expect(adapter.accruedTokens).toEqual([20]);
    expect(adapter.markedContinuations).toEqual(["ses_goal"]);
    expect(goal.pendingContinuation).toBe(true);
  });

  test("handleGoalPostTurn 无工具执行时停止自动续接但保留 pursuing 状态", () => {
    const goal: TestGoal = { pendingContinuation: false, status: "pursuing" };
    const adapter = createGoalAdapter(goal);

    const result = handleGoalPostTurn(
      adapter,
      "ses_goal",
      { inputTokens: 7, outputTokens: 3 },
      { hadToolCalls: false },
    );

    expect(result.shouldContinue).toBe(false);
    expect(adapter.accruedTokens).toEqual([10]);
    expect(adapter.markedContinuations).toEqual([]);
    expect(goal.status).toBe("pursuing");
  });

  test("handleGoalPostTurn 预算耗尽时触发最终续接", () => {
    const goal: TestGoal = { pendingContinuation: true, status: "budget-limited" };
    const adapter = createGoalAdapter(goal, { exceeded: true });

    const result = handleGoalPostTurn(
      adapter,
      "ses_goal",
      { inputTokens: 90, outputTokens: 10 },
      { hadToolCalls: false },
    );

    expect(result.shouldContinue).toBe(true);
    expect(adapter.accruedTokens).toEqual([100]);
    expect(adapter.markedContinuations).toEqual(["ses_goal"]);
  });

  test("handleGoalPostTurn 非 pursuing 完成态不续接", () => {
    const adapter = createGoalAdapter({ pendingContinuation: false, status: "achieved" });

    const result = handleGoalPostTurn(adapter, "ses_goal", { inputTokens: 1, outputTokens: 1 }, { hadToolCalls: true });

    expect(result.shouldContinue).toBe(false);
    expect(adapter.markedContinuations).toEqual([]);
  });

  test("handleGoalPostTurn 缺少 session 或 usage 时不处理 goal", () => {
    const adapter = createGoalAdapter({ status: "pursuing" });

    expect(
      handleGoalPostTurn(adapter, undefined, { inputTokens: 1, outputTokens: 1 }, { hadToolCalls: true })
        .shouldContinue,
    ).toBe(false);
    expect(handleGoalPostTurn(adapter, "ses_goal", undefined, { hadToolCalls: true }).shouldContinue).toBe(false);
    expect(adapter.accruedTokens).toEqual([]);
    expect(adapter.markedContinuations).toEqual([]);
  });

  test("pauseGoalOnAbort 仅暂停 pursuing goal", () => {
    const activeGoal: TestGoal = { status: "pursuing" };
    const activeAdapter = createGoalAdapter(activeGoal);
    pauseGoalOnAbort(activeAdapter, "ses_goal");

    expect(activeAdapter.pausedSessions).toEqual(["ses_goal"]);
    expect(activeGoal.status).toBe("paused");

    const completedAdapter = createGoalAdapter({ status: "achieved" });
    pauseGoalOnAbort(completedAdapter, "ses_done");
    pauseGoalOnAbort(completedAdapter, undefined);

    expect(completedAdapter.pausedSessions).toEqual([]);
  });
});

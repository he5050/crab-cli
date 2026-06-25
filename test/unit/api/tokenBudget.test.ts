/**
 * tokenBudget 模块单元测试
 *
 * 测试目标:
 * - 预算分配逻辑（record / canAllocate）
 * - 预算耗尽检测与回调
 * - 预警回调触发
 * - 重置机制
 * - 参数校验
 * - 边界条件保护（负值、溢出）
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { TokenBudgetController, type TokenUsage } from "@/api/utils/tokenBudget";

describe("TokenBudgetController 基本功能", () => {
  let budget: TokenBudgetController;

  beforeEach(() => {
    budget = new TokenBudgetController("test", { limit: 1000 });
  });

  it("应该正确初始化预算", () => {
    const state = budget.getState();
    expect(state.limit).toBe(1000);
    expect(state.remaining).toBe(1000);
    expect(state.used).toBe(0);
    expect(state.exhausted).toBe(false);
  });

  it("应该能够记录 Token 使用", () => {
    const usage: TokenUsage = { promptTokens: 50, completionTokens: 50, totalTokens: 100 };
    budget.record(usage);

    const state = budget.getState();
    expect(state.used).toBe(100);
    expect(state.remaining).toBe(900);
  });

  it("应该能够检查是否可以分配", () => {
    expect(budget.canAllocate(500)).toBe(true);
    expect(budget.canAllocate(1500)).toBe(false);
  });

  it("应该在预算耗尽后拒绝 canAllocate", () => {
    budget.record({ promptTokens: 900, completionTokens: 100, totalTokens: 1000 });
    expect(budget.canAllocate(1)).toBe(false);
  });
});

describe("TokenBudgetController 多次记录", () => {
  let budget: TokenBudgetController;

  beforeEach(() => {
    budget = new TokenBudgetController("test", { limit: 1000 });
  });

  it("应该支持多次记录直到耗尽", () => {
    budget.record({ promptTokens: 300, completionTokens: 0, totalTokens: 300 });
    budget.record({ promptTokens: 300, completionTokens: 0, totalTokens: 300 });
    budget.record({ promptTokens: 300, completionTokens: 0, totalTokens: 300 });

    expect(budget.canAllocate(200)).toBe(false);
    expect(budget.getState().remaining).toBe(100);
    expect(budget.getState().used).toBe(900);
  });

  it("应该准确跟踪已使用的 token", () => {
    budget.record({ promptTokens: 100, completionTokens: 0, totalTokens: 100 });
    budget.record({ promptTokens: 200, completionTokens: 0, totalTokens: 200 });
    budget.record({ promptTokens: 300, completionTokens: 0, totalTokens: 300 });

    expect(budget.getState().used).toBe(600);
    expect(budget.getState().remaining).toBe(400);
  });
});

describe("TokenBudgetController 预算耗尽处理", () => {
  it("应该在预算耗尽时设置 exhausted 标志", () => {
    const budget = new TokenBudgetController("test", { limit: 100 });
    budget.record({ promptTokens: 100, completionTokens: 0, totalTokens: 100 });

    expect(budget.getState().exhausted).toBe(true);
  });

  it("应该触发耗尽回调", () => {
    let exhaustedCalled = false;
    const budget = new TokenBudgetController("test", {
      limit: 100,
      onExhausted: () => {
        exhaustedCalled = true;
      },
    });

    budget.record({ promptTokens: 100, completionTokens: 0, totalTokens: 100 });
    expect(exhaustedCalled).toBe(true);
  });

  it("耗尽后不应继续记录", () => {
    const budget = new TokenBudgetController("test", { limit: 100 });
    budget.record({ promptTokens: 100, completionTokens: 0, totalTokens: 100 });

    // 耗尽后继续记录，应被忽略
    budget.record({ promptTokens: 50, completionTokens: 0, totalTokens: 50 });
    expect(budget.getState().used).toBe(100);
  });
});

describe("TokenBudgetController 预警回调", () => {
  it("应该在剩余 20% 时触发预警（默认阈值）", () => {
    let warningCalled = false;
    let warningRemaining = 0;
    const budget = new TokenBudgetController("test", {
      limit: 1000,
      onWarning: (remaining) => {
        warningCalled = true;
        warningRemaining = remaining;
      },
    });

    // 使用 800 tokens，剩余 200（20%）
    budget.record({ promptTokens: 800, completionTokens: 0, totalTokens: 800 });
    expect(warningCalled).toBe(true);
    expect(warningRemaining).toBe(200);
  });

  it("应该支持自定义预警阈值", () => {
    let warningCalled = false;
    const budget = new TokenBudgetController("test", {
      limit: 1000,
      warningThreshold: 0.5,
      onWarning: () => {
        warningCalled = true;
      },
    });

    // 使用 500 tokens，剩余 500（50%）
    budget.record({ promptTokens: 500, completionTokens: 0, totalTokens: 500 });
    expect(warningCalled).toBe(true);
  });

  it("预警只应触发一次", () => {
    let warningCount = 0;
    const budget = new TokenBudgetController("test", {
      limit: 1000,
      onWarning: () => {
        warningCount++;
      },
    });

    budget.record({ promptTokens: 800, completionTokens: 0, totalTokens: 800 });
    budget.record({ promptTokens: 100, completionTokens: 0, totalTokens: 100 });

    expect(warningCount).toBe(1);
  });
});

describe("TokenBudgetController 重置", () => {
  it("应该能够重置预算", () => {
    const budget = new TokenBudgetController("test", { limit: 1000 });
    budget.record({ promptTokens: 500, completionTokens: 0, totalTokens: 500 });

    budget.reset();

    const state = budget.getState();
    expect(state.remaining).toBe(1000);
    expect(state.used).toBe(0);
    expect(state.exhausted).toBe(false);
    expect(state.warned).toBe(false);
  });
});

describe("TokenBudgetController 参数校验", () => {
  it("应该拒绝负数 limit", () => {
    expect(() => {
      new TokenBudgetController("test", { limit: -1 });
    }).toThrow(/limit 必须为正数/);
  });

  it("应该拒绝零 limit", () => {
    expect(() => {
      new TokenBudgetController("test", { limit: 0 });
    }).toThrow(/limit 必须为正数/);
  });

  it("应该拒绝超出范围的 warningThreshold", () => {
    expect(() => {
      new TokenBudgetController("test", { limit: 100, warningThreshold: -0.1 });
    }).toThrow(/warningThreshold 必须在/);

    expect(() => {
      new TokenBudgetController("test", { limit: 100, warningThreshold: 1.1 });
    }).toThrow(/warningThreshold 必须在/);
  });
});

describe("TokenBudgetController 边界条件", () => {
  it("应该忽略负值的 totalTokens", () => {
    const budget = new TokenBudgetController("test", { limit: 1000 });
    budget.record({ promptTokens: 0, completionTokens: 0, totalTokens: -100 });
    expect(budget.getState().used).toBe(0);
  });

  it("应该处理接近溢出的值", () => {
    let warnCalled = false;
    const budget = new TokenBudgetController("test", {
      limit: Number.MAX_SAFE_INTEGER,
      onExhausted: () => {
        warnCalled = true;
      },
    });

    // 正常使用
    budget.record({ promptTokens: 1000000, completionTokens: 0, totalTokens: 1000000 });
    expect(budget.getState().used).toBe(1000000);
    expect(warnCalled).toBe(false);
  });

  it("应该处理 canAllocate 为 0 的情况", () => {
    const budget = new TokenBudgetController("test", { limit: 100 });
    expect(budget.canAllocate(0)).toBe(true);
  });

  it("应该处理 canAllocate 超过剩余的情况", () => {
    const budget = new TokenBudgetController("test", { limit: 100 });
    budget.record({ promptTokens: 50, completionTokens: 0, totalTokens: 50 });
    expect(budget.canAllocate(51)).toBe(false);
    expect(budget.canAllocate(50)).toBe(true);
  });
});

describe("TokenBudgetController getState", () => {
  it("应该返回完整的状态信息", () => {
    const budget = new TokenBudgetController("test", { limit: 1000 });
    budget.record({ promptTokens: 300, completionTokens: 0, totalTokens: 300 });

    const state = budget.getState();
    expect(state.used).toBe(300);
    expect(state.limit).toBe(1000);
    expect(state.remaining).toBe(700);
    expect(state.utilization).toBeCloseTo(0.3, 2);
    expect(state.exhausted).toBe(false);
    expect(state.warned).toBe(false);
  });
});

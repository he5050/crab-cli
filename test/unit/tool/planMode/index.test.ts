/**
 * src/tool/planMode 单元测试
 *
 * 测试范围:
 *   - exit_plan_mode: 退出规划模式（plan / steps / 缺失参数）
 *   - enter_plan_mode: 进入规划模式
 *   - status: 查询当前模式
 *   - unknown action: 未知操作
 *
 * 策略: planModeTool 的 execute 仅含纯 switch 逻辑，无外部运行时依赖。
 *       只需 mock createLogger 避免 console 输出。
 */
import { describe, expect, it, mock } from "bun:test";

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  }),
}));

import { planModeTool } from "@/tool/planMode";

// ═══════════════════════════════════════════════════════════════════
// exit_plan_mode
// ═══════════════════════════════════════════════════════════════════
describe("planModeTool — exit_plan_mode", () => {
  it("应使用 plan 字符串退出规划模式", async () => {
    const result = (await planModeTool.execute({
      action: "exit_plan_mode",
      plan: "重构认证模块",
    })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.mode).toBe("execute");
    expect(result.action).toBe("exit_plan_mode");
    expect(result.plan).toBe("重构认证模块");
    expect(result.requireConfirmation).toBe(true);
  });

  it("应使用 steps 数组退出规划模式", async () => {
    const result = (await planModeTool.execute({
      action: "exit_plan_mode",
      steps: ["步骤一: 分析", "步骤二: 实现"],
    })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.mode).toBe("execute");
    expect(result.steps).toEqual(["步骤一: 分析", "步骤二: 实现"]);
  });

  it("无 plan 且无 steps 时应返回错误", async () => {
    const result = (await planModeTool.execute({
      action: "exit_plan_mode",
    })) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(result.error).toContain("需要提供 plan");
  });

  it("requireConfirmation=false 应自动进入执行模式", async () => {
    const result = (await planModeTool.execute({
      action: "exit_plan_mode",
      plan: "自动方案",
      requireConfirmation: false,
    })) as Record<string, unknown>;

    expect(result.requireConfirmation).toBe(false);
    expect(result.message).toContain("自动进入执行模式");
  });
});

// ═══════════════════════════════════════════════════════════════════
// enter_plan_mode
// ═══════════════════════════════════════════════════════════════════
describe("planModeTool — enter_plan_mode", () => {
  it("应返回 plan 模式和允许的工具列表", async () => {
    const result = (await planModeTool.execute({
      action: "enter_plan_mode",
    })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.mode).toBe("plan");
    expect(result.action).toBe("enter_plan_mode");
    expect(Array.isArray(result.allowedTools)).toBe(true);
    expect(result.allowedTools).toContain("filesystem-read");
    expect(result.allowedTools).toContain("grep");
  });
});

// ═══════════════════════════════════════════════════════════════════
// status
// ═══════════════════════════════════════════════════════════════════
describe("planModeTool — status", () => {
  it("应返回 execute 模式(默认)", async () => {
    const result = (await planModeTool.execute({
      action: "status",
    })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.mode).toBe("execute");
  });
});

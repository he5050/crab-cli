/**
 * 规划模式工具测试。
 *
 * 覆盖:planModeTool 的 execute 逻辑
 * - exit_plan_mode
 * - enter_plan_mode
 * - status
 */
import { describe, expect, test } from "bun:test";
import { planModeTool } from "@/tool/planMode/index";

describe("planModeTool", () => {
  test("工具定义正确", () => {
    expect(planModeTool.name).toBe("plan-mode");
    expect(planModeTool.permission).toBe("plan_mode");
    expect(planModeTool.description).toBeTruthy();
  });

  test("exit_plan_mode 需要 plan 或 steps", async () => {
    const result = await planModeTool.execute({
      action: "exit_plan_mode",
    });
    expect(result).toMatchObject({ success: false });
  });

  test("exit_plan_mode 有 plan 时成功", async () => {
    const result = await planModeTool.execute({
      action: "exit_plan_mode",
      plan: "重构认证模块",
      requireConfirmation: true,
      steps: ["1. 创建新接口", "2. 迁移旧代码", "3. 更新测试"],
    });
    expect(result).toMatchObject({
      action: "exit_plan_mode",
      mode: "execute",
      requireConfirmation: true,
      success: true,
    });
  });

  test("exit_plan_mode 只提供 steps 也能成功", async () => {
    const result = await planModeTool.execute({
      action: "exit_plan_mode",
      steps: ["step1", "step2"],
    });
    expect(result).toMatchObject({ success: true });
  });

  test("exit_plan_mode 默认需要确认", async () => {
    const result = await planModeTool.execute({
      action: "exit_plan_mode",
      plan: "test plan",
    });
    expect(result).toMatchObject({ requireConfirmation: true });
  });

  test("exit_plan_mode requireConfirmation=false 时自动执行", async () => {
    const result = await planModeTool.execute({
      action: "exit_plan_mode",
      plan: "auto execute",
      requireConfirmation: false,
    });
    expect(result).toMatchObject({
      message: expect.stringContaining("自动"),
      requireConfirmation: false,
      success: true,
    });
  });

  test("enter_plan_mode 返回只读工具列表", async () => {
    const result = await planModeTool.execute({
      action: "enter_plan_mode",
    });
    expect(result).toMatchObject({
      mode: "plan",
      success: true,
    });
    expect((result as any).allowedTools).toContain("filesystem-read");
    expect((result as any).allowedTools).toContain("glob");
  });

  test("status 返回当前模式", async () => {
    const result = await planModeTool.execute({
      action: "status",
    });
    expect(result).toMatchObject({
      action: "status",
      success: true,
    });
    expect(["plan", "execute"]).toContain((result as any).mode);
  });
});

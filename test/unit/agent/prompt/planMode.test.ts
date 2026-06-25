/**
 * Plan 模式提示词测试 — 验证 Plan 模式的特殊行为。
 *
 * 测试用例:
 *   - Plan 模式不直接执行
 *   - Plan 模式包含 5 阶段工作流
 *   - Plan 模式包含确认机制
 *   - Plan 模式只使用只读工具
 *   - Plan 模式的计划文档格式
 *   - Plan 模式提到 exit_plan_mode
 *   - Plan 模式提到规则
 */
import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, getModeInstruction, isReadOnlyMode } from "@/agent/prompt/builder";

describe("Plan 模式提示词", () => {
  const basePrompt = "# Plan Agent";
  const planPrompt = () =>
    buildSystemPrompt({
      basePrompt,
      environment: { cwd: "/project" },
      includeInstructions: false,
      mode: "plan",
    });

  test("Plan 模式标记为只读", () => {
    expect(isReadOnlyMode("plan")).toBe(true);
  });

  test("Plan 模式包含不直接执行的约束", () => {
    const instruction = getModeInstruction("plan");
    expect(instruction).toContain("不直接修改代码");
  });

  test("Plan 模式包含 5 阶段工作流", () => {
    const instruction = getModeInstruction("plan");
    expect(instruction).toContain("阶段 1");
    expect(instruction).toContain("阶段 2");
    expect(instruction).toContain("阶段 3");
    expect(instruction).toContain("阶段 4");
    expect(instruction).toContain("阶段 5");
  });

  test("Plan 模式包含确认机制", () => {
    const instruction = getModeInstruction("plan");
    expect(instruction).toContain("向用户展示计划并获得确认");
    expect(instruction).toContain("ask-user");
  });

  test("Plan 模式提到只读工具", () => {
    const instruction = getModeInstruction("plan");
    expect(instruction).toContain("只读工具");
  });

  test("Plan 模式提到 exit_plan_mode", () => {
    const instruction = getModeInstruction("plan");
    expect(instruction).toContain("exit_plan_mode");
  });

  test("Plan 模式包含计划文档模板", () => {
    const instruction = getModeInstruction("plan");
    expect(instruction).toContain("背景");
    expect(instruction).toContain("影响分析");
    expect(instruction).toContain("步骤");
    expect(instruction).toContain("风险和缓解");
    expect(instruction).toContain("验证方式");
  });

  test("Plan 模式包含规则列表", () => {
    const instruction = getModeInstruction("plan");
    expect(instruction).toContain("不要在未确认的情况下执行任何修改");
    expect(instruction).toContain("具体的文件路径和函数名");
  });

  test("Plan 模式完整提示词包含环境上下文", () => {
    const result = planPrompt();
    expect(result).toContain("Working directory: /project");
    expect(result).toContain("<env>");
  });
});

/**
 * Team 模式提示词测试 — 验证 Team 模式的特殊行为。
 *
 * 测试用例:
 *   - Team 模式包含协调者角色
 *   - Team 模式包含强制要求
 *   - Team 模式包含 team 工具说明
 *   - Team 模式包含工作流模板
 *   - Team 模式包含拆分原则
 *   - Team 模式包含队友提示原则
 *   - Team 模式完整提示词结构
 */
import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, getModeInstruction } from "@/agent/prompt/builder";

describe("Team 模式提示词", () => {
  const basePrompt = "# Team Lead";
  const teamPrompt = () =>
    buildSystemPrompt({
      basePrompt,
      environment: { cwd: "/project" },
      includeInstructions: false,
      mode: "team",
    });

  test("Team 模式包含协调者角色定义", () => {
    const instruction = getModeInstruction("team");
    expect(instruction).toContain("协调者");
    expect(instruction).toContain("你不直接实现代码");
  });

  test("Team 模式包含强制要求", () => {
    const instruction = getModeInstruction("team");
    expect(instruction).toContain("强制要求");
    expect(instruction).toContain("队友");
  });

  test("Team 模式提到 team 工具", () => {
    const instruction = getModeInstruction("team");
    expect(instruction).toContain("team-spawn");
  });

  test("Team 模式包含 spawn 指令", () => {
    const instruction = getModeInstruction("team");
    expect(instruction).toContain("spawn");
  });

  test("Team 模式包含工作流模板", () => {
    const instruction = getModeInstruction("team");
    expect(instruction).toContain("分解任务");
    expect(instruction).toContain("创建队友");
    expect(instruction).toContain("创建任务");
    expect(instruction).toContain("等待");
    expect(instruction).toContain("合并");
    expect(instruction).toContain("综合汇报");
    expect(instruction).toContain("清理");
  });

  test("Team 模式包含文件边界规则", () => {
    const instruction = getModeInstruction("team");
    expect(instruction).toContain("不同文件");
    expect(instruction).toContain("同一个文件");
  });

  test("Team 模式包含明确的代理边界要求", () => {
    const instruction = getModeInstruction("team");
    expect(instruction).toContain("拆分原则");
  });

  test("Team 模式包含队友提示原则", () => {
    const instruction = getModeInstruction("team");
    expect(instruction).toContain("队友提示原则");
    expect(instruction).toContain("对话历史");
  });

  test("Team 模式完整提示词包含基础和模式内容", () => {
    const result = teamPrompt();
    expect(result).toContain("# Team Lead");
    expect(result).toContain("Team 模式规则");
    expect(result).toContain("Working directory: /project");
  });

  test("Team 模式包含工具使用说明", () => {
    const result = teamPrompt();
    expect(result).toContain("## 工具使用说明");
  });

  test("Team 模式包含合并和清理指令", () => {
    const instruction = getModeInstruction("team");
    expect(instruction).toContain("team-merge-all");
    expect(instruction).toContain("team-cleanup");
  });
});

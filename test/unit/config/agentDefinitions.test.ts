import { describe, expect, test } from "bun:test";
import {
  buildBuiltinAgentPrompt,
  getBuiltinAgentDefinition,
  validateAgentDefinition,
} from "@/config/agents/agentDefinitions";

describe("builtin agent prompt contracts", () => {
  test("buildBuiltinAgentPrompt includes shared contract sections", () => {
    const prompt = buildBuiltinAgentPrompt({
      capabilities: ["读取代码", "运行测试"],
      defaultTools: ["filesystem-read", "bash-execute"],
      displayName: "General Agent",
      name: "general",
      outputContract: "## 输出契约\n\n## 完成摘要\n## 验证结果",
      boundaries: ["不得夸大结论", "不得越权修改"],
      responsibility: "执行明确范围内的实现和验证。",
    });

    expect(prompt).toContain("## Agent 专属职责");
    expect(prompt).toContain("### 核心职责");
    expect(prompt).toContain("### 执行规则");
    expect(prompt).toContain("### 工具规则");
    expect(prompt).toContain("### 委派规则");
    expect(prompt).toContain("### 失败诚实规则");
    expect(prompt).toContain("验证");
    expect(prompt).toContain("执行明确范围内的实现和验证。");
  });

  test("core execution agents include hardened contract guidance", () => {
    const expectedSections = ["### 执行规则", "### 工具规则", "### 委派规则", "### 失败诚实规则"];

    for (const agentName of ["explore", "plan", "general", "review", "qa", "debug"] as const) {
      const definition = getBuiltinAgentDefinition(agentName);
      expect(definition).toBeDefined();
      const prompt = definition!.systemPrompt;

      for (const section of expectedSections) {
        expect(prompt).toContain(section);
      }
      expect(prompt).toContain("验证");
      expect(prompt).toMatch(/委派|子代理|spawn/);
      expect(validateAgentDefinition(definition!).valid).toBe(true);
    }
  });

  test("review qa and debug prompts include specialized guidance", () => {
    const expectations: Record<"debug" | "qa" | "review", string[]> = {
      debug: ["先复现", "根因", "最小复现"],
      qa: ["失败用例", "边界场景", "验证结论"],
      review: ["findings-first", "严重度", "证据"],
    };

    for (const agentName of ["review", "qa", "debug"] as const) {
      const definition = getBuiltinAgentDefinition(agentName)!;
      for (const token of expectations[agentName]) {
        expect(definition.systemPrompt).toContain(token);
      }
    }
  });
});

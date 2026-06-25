/**
 * SkillRunner 单元测试。
 *
 * 覆盖范围:
 *   - run 基本执行（模板 + 用户输入追加）
 *   - run 必填参数验证
 *   - run 参数类型检查（number/boolean）
 *   - run 参数占位符替换（{{param}}、{{param:default}}）
 *   - run 可用工具集合计算（skill.tools 过滤）
 *   - run 无 skill.tools 时暴露全量工具
 *   - setToolRegistry 注入与回退
 *   - listAvailableTools 工具名过滤
 *   - listAvailableTools registry 调用失败回退
 *   - 边界: 无参数、无用户输入、空 content
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// ─── Mock logger ────────────────────────────────────────────

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    child: () => ({ child: () => ({}) }),
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  }),
}));

// ─── 静态导入 ────────────────────────────────────────────

import { SkillRunner } from "@/extension/skill/runner";
import type { SkillDefinition } from "@/extension/skill/types";

// ─── 辅助 ──────────────────────────────────────────────────

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    category: "测试",
    content: "指令内容: code={{code}}, lang={{lang:typescript}}",
    description: "测试 Skill",
    location: "<test>",
    name: "test-skill",
    source: "builtin",
    ...overrides,
  };
}

// 简化的 mock 工具（仅保留 name，避免 ToolDefinition 完整字段要求）
const mockTools = {
  "bash-execute": { name: "bash-execute" },
  "filesystem-read": { name: "filesystem-read" },
  "filesystem-write": { name: "filesystem-write" },
} as any;

// ─── 测试 ──────────────────────────────────────────────────

describe("SkillRunner", () => {
  let runner: SkillRunner;

  beforeEach(() => {
    runner = new SkillRunner();
    // 注入空 registry，避免 getDefaultRegistryView 中的 require() 崩溃
    runner.setToolRegistry(() => ({}) as any);
  });

  // ─── run ──────────────────────────────────────────────

  describe("run", () => {
    test("基本执行返回 ok + prompt", async () => {
      const skill = makeSkill({ content: "你好世界" });
      const result = await runner.run(skill);

      expect(result.ok).toBe(true);
      expect(result.skillName).toBe("test-skill");
      expect(result.prompt).toBe("你好世界");
    });

    test("参数替换 {{param}}", async () => {
      const skill = makeSkill({ content: "分析代码: {{code}}" });
      const result = await runner.run(skill, { code: "const x = 1;" });

      expect(result.ok).toBe(true);
      expect(result.prompt).toBe("分析代码: const x = 1;");
    });

    test("参数替换带默认值 {{param:default}}", async () => {
      const skill = makeSkill({ content: "语言: {{lang:typescript}}" });
      const result = await runner.run(skill, {});

      expect(result.ok).toBe(true);
      expect(result.prompt).toBe("语言: typescript");
    });

    test("有值时覆盖默认值", async () => {
      const skill = makeSkill({ content: "语言: {{lang:typescript}}" });
      const result = await runner.run(skill, { lang: "rust" });

      expect(result.ok).toBe(true);
      expect(result.prompt).toBe("语言: rust");
    });

    test("无值无默认保留占位符", async () => {
      const skill = makeSkill({ content: "参数: {{missing}}" });
      const result = await runner.run(skill, {});

      expect(result.ok).toBe(true);
      expect(result.prompt).toBe("参数: {{missing}}");
    });

    test("追加用户输入", async () => {
      const skill = makeSkill({ content: "基础指令" });
      const result = await runner.run(skill, {}, "用户的额外需求");

      expect(result.ok).toBe(true);
      expect(result.prompt).toBe("基础指令\n\n用户的额外需求");
    });

    test("参数替换 + 用户输入同时生效", async () => {
      const skill = makeSkill({ content: "分析 {{code}}" });
      const result = await runner.run(skill, { code: "fn()" }, "请重点看性能");

      expect(result.ok).toBe(true);
      expect(result.prompt).toBe("分析 fn()\n\n请重点看性能");
    });

    test("空 content 正常执行", async () => {
      const skill = makeSkill({ content: "" });
      const result = await runner.run(skill);

      expect(result.ok).toBe(true);
      expect(result.prompt).toBe("");
    });

    test("必填参数缺失返回错误", async () => {
      const skill = makeSkill({
        content: "代码: {{code}}",
        parameters: [{ description: "代码", name: "code", required: true, type: "string" }],
      });

      const result = await runner.run(skill, {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain("缺少必填参数");
      expect(result.error).toContain("code");
    });

    test("必填参数为空字符串返回错误", async () => {
      const skill = makeSkill({
        content: "代码: {{code}}",
        parameters: [{ description: "代码", name: "code", required: true, type: "string" }],
      });

      const result = await runner.run(skill, { code: "" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("缺少必填参数");
    });

    test("number 类型检查", async () => {
      const skill = makeSkill({
        content: "数量: {{count}}",
        parameters: [{ description: "数量", name: "count", required: true, type: "number" }],
      });

      const result = await runner.run(skill, { count: "not-a-number" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("number 类型");
    });

    test("boolean 类型检查", async () => {
      const skill = makeSkill({
        content: "标志: {{flag}}",
        parameters: [{ description: "标志", name: "flag", required: true, type: "boolean" }],
      });

      const result = await runner.run(skill, { flag: "true" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("boolean 类型");
    });

    test("非必填参数缺失不报错", async () => {
      const skill = makeSkill({
        content: "代码: {{code}}",
        parameters: [{ description: "代码", name: "code", required: false, type: "string" }],
      });

      const result = await runner.run(skill, {});
      expect(result.ok).toBe(true);
    });
  });

  // ─── listAvailableTools ───────────────────────────────

  describe("listAvailableTools", () => {
    test("无 skill.tools 时返回全量工具", async () => {
      runner.setToolRegistry(() => mockTools);

      const skill = makeSkill();
      const tools = await runner.listAvailableTools(skill);

      expect(tools).toEqual(["bash-execute", "filesystem-read", "filesystem-write"]);
    });

    test("skill.tools 过滤后返回交集", async () => {
      runner.setToolRegistry(() => mockTools);

      const skill = makeSkill({ tools: ["bash-execute", "filesystem-read"] });
      const tools = await runner.listAvailableTools(skill);

      expect(tools).toEqual(["bash-execute", "filesystem-read"]);
    });

    test("skill.tools 中有不存在的工具名时静默忽略", async () => {
      runner.setToolRegistry(() => mockTools);

      const skill = makeSkill({ tools: ["bash-execute", "nonexistent-tool"] });
      const tools = await runner.listAvailableTools(skill);

      expect(tools).toEqual(["bash-execute"]);
    });

    test("skill.tools 为空数组时返回全量", async () => {
      runner.setToolRegistry(() => mockTools);

      const skill = makeSkill({ tools: [] });
      const tools = await runner.listAvailableTools(skill);

      expect(tools).toEqual(["bash-execute", "filesystem-read", "filesystem-write"]);
    });

    test("registry 调用失败返回空数组", async () => {
      runner.setToolRegistry(() => {
        throw new Error("registry 不可用");
      });

      const skill = makeSkill();
      const tools = await runner.listAvailableTools(skill);

      expect(tools).toEqual([]);
    });

    test("未注入 registry 时使用默认懒加载", async () => {
      // setToolRegistry(null) 触发默认懒加载
      runner.setToolRegistry(null);
      const skill = makeSkill();

      // 不应抛错，回退到默认懒加载
      const tools = await runner.listAvailableTools(skill);
      // 默认懒加载在测试环境中可能失败，返回空数组
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  // ─── setToolRegistry ─────────────────────────────────

  describe("setToolRegistry", () => {
    test("注入后 listAvailableTools 使用新 registry", async () => {
      const customRegistry = { "custom-tool": { name: "custom-tool" } } as any;

      runner.setToolRegistry(() => customRegistry);

      const skill = makeSkill();
      const tools = await runner.listAvailableTools(skill);

      expect(tools).toEqual(["custom-tool"]);
    });

    test("多次注入覆盖前一次", async () => {
      runner.setToolRegistry(() => ({ a: { name: "a" } }) as any);
      runner.setToolRegistry(() => ({ b: { name: "b" } }) as any);

      const tools = await runner.listAvailableTools(makeSkill());
      expect(tools).toEqual(["b"]);
    });
  });

  // ─── availableToolNames 在 run 结果中 ────────────────

  describe("run 结果中的 availableToolNames", () => {
    test("成功执行时填充 availableToolNames", async () => {
      runner.setToolRegistry(() => mockTools);

      const skill = makeSkill({ tools: ["bash-execute"] });
      const result = await runner.run(skill);

      expect(result.ok).toBe(true);
      expect(result.availableToolNames).toEqual(["bash-execute"]);
    });

    test("失败时不填充 availableToolNames", async () => {
      const skill = makeSkill({
        parameters: [{ description: "x", name: "x", required: true, type: "string" }],
      });

      const result = await runner.run(skill, {});
      expect(result.ok).toBe(false);
      expect(result.availableToolNames).toBeUndefined();
    });
  });
});

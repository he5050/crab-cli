/**
 * Skill 生成器单元测试。
 *
 * 覆盖范围:
 *   - parseGeneratedSkillDraft 正常解析
 *   - parseGeneratedSkillDraft JSON 提取（含 markdown fence）
 *   - parseGeneratedSkillDraft 字段校验（name/description/content 最小长度）
 *   - parseGeneratedSkillDraft Skill 名称正则校验
 *   - parseGeneratedSkillDraft 非法文件类型拒绝
 *   - normalizeSkillName 规范化（下划线→连字符、小写）
 *   - assertValidSkillName 合法/非法名称
 *   - extractJsonObject 边界（无 JSON、嵌套 fence）
 *   - readOptionalMarkdown 可选字段处理
 */
import { describe, expect, mock, test } from "bun:test";

// ─── Mock logger ────────────────────────────────────────────

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  }),
}));

// ─── 测试辅助 ────────────────────────────────────────────

/** 保证内容长度 ≥ 40 字符的默认正文 */
const LONG_CONTENT = "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝";

// ─── 静态导入 ────────────────────────────────────────────

import { parseGeneratedSkillDraft } from "@/extension/skill/generator";

// ─── 测试 ──────────────────────────────────────────────────

describe("parseGeneratedSkillDraft", () => {
  test("正常解析 JSON", () => {
    const raw = JSON.stringify({
      name: "my-skill",
      description: "描述内容",
      category: "code",
      content: LONG_CONTENT,
    });

    const draft = parseGeneratedSkillDraft(raw);

    expect(draft.name).toBe("my-skill");
    expect(draft.description).toBe("描述内容");
    expect(draft.category).toBe("code");
    expect(draft.content).toContain("Skill 正文内容");
  });

  test("从 markdown fence 中提取 JSON", () => {
    const raw = [
      "```json",
      '{"name": "fenced-skill", "description": "fenced 描述", "category": "general", "content": "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝"}',
      "```",
    ].join("\n");

    const draft = parseGeneratedSkillDraft(raw);
    expect(draft.name).toBe("fenced-skill");
  });

  test("从混合文本中提取 JSON", () => {
    const raw =
      '一些前缀文本 {"name": "mixed-skill", "description": "mixed", "category": "general", "content": "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝"} 一些后缀';

    const draft = parseGeneratedSkillDraft(raw);
    expect(draft.name).toBe("mixed-skill");
  });

  test("无 JSON 对象时抛错", () => {
    expect(() => parseGeneratedSkillDraft("没有 JSON")).toThrow();
  });

  test("JSON 不是对象时抛错", () => {
    expect(() => parseGeneratedSkillDraft("[1,2,3]")).toThrow();
  });

  test("name 缺失时抛错", () => {
    const raw = JSON.stringify({
      description: "无 name",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
    });

    // name 规范化为空字符串，不匹配正则
    expect(() => parseGeneratedSkillDraft(raw)).toThrow();
  });

  test("description 为空时抛错", () => {
    const raw = JSON.stringify({
      name: "no-desc",
      description: "",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
    });

    expect(() => parseGeneratedSkillDraft(raw)).toThrow("description is required");
  });

  test("content 太短时抛错", () => {
    const raw = JSON.stringify({
      name: "short-content",
      description: "描述",
      content: "太短",
    });

    expect(() => parseGeneratedSkillDraft(raw)).toThrow("too short");
  });

  test("非法 Skill 名称抛错", () => {
    const raw = JSON.stringify({
      name: "INVALID NAME!",
      description: "描述",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
    });

    expect(() => parseGeneratedSkillDraft(raw)).toThrow("Invalid skill name");
  });

  test("名称含下划线自动转为连字符", () => {
    const raw = JSON.stringify({
      name: "my_skill_name",
      description: "描述",
      category: "general",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
    });

    const draft = parseGeneratedSkillDraft(raw);
    expect(draft.name).toBe("my-skill-name");
  });

  test("名称含大写自动转小写", () => {
    const raw = JSON.stringify({
      name: "MySkillName",
      description: "描述",
      category: "general",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
    });

    const draft = parseGeneratedSkillDraft(raw);
    expect(draft.name).toBe("myskillname");
  });

  test("reference 和 examples 正确提取", () => {
    const raw = JSON.stringify({
      name: "ref-skill",
      description: "描述",
      category: "general",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
      reference: "# 参考文档\n详细参考内容",
      examples: "# 示例\n示例内容",
    });

    const draft = parseGeneratedSkillDraft(raw);
    expect(draft.reference).toBe("# 参考文档\n详细参考内容");
    expect(draft.examples).toBe("# 示例\n示例内容");
  });

  test("reference 为空字符串时不包含在结果中", () => {
    const raw = JSON.stringify({
      name: "empty-ref",
      description: "描述",
      category: "general",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
      reference: "   ",
    });

    const draft = parseGeneratedSkillDraft(raw);
    expect(draft.reference).toBeUndefined();
  });

  test("非法文件类型被拒绝", () => {
    const raw = JSON.stringify({
      name: "malicious",
      description: "恶意 Skill",
      category: "general",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
      files: { "dangerous.sh": "rm -rf /" },
    });

    expect(() => parseGeneratedSkillDraft(raw)).toThrow("not allowed");
  });

  test("仅允许 reference.md 和 examples.md 额外文件", () => {
    const raw = JSON.stringify({
      name: "safe-files",
      description: "安全 Skill",
      category: "general",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
      files: { "reference.md": "# ref", "examples.md": "# ex" },
    });

    const draft = parseGeneratedSkillDraft(raw);
    expect(draft.name).toBe("safe-files");
  });

  test("category 默认为 general", () => {
    const raw = JSON.stringify({
      name: "no-category",
      description: "描述",
      content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
    });

    const draft = parseGeneratedSkillDraft(raw);
    expect(draft.category).toBe("general");
  });
});

describe("Skill 名称规范", () => {
  test("合法 kebab-case 名称", () => {
    expect(() =>
      // 通过 parseGeneratedSkillDraft 间接验证
      parseGeneratedSkillDraft(
        JSON.stringify({
          name: "a-b",
          description: "d",
          content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
        }),
      ),
    ).not.toThrow();
  });

  test("纯数字短名称不合法（少于3字符）", () => {
    expect(() =>
      parseGeneratedSkillDraft(
        JSON.stringify({
          name: "1",
          description: "d",
          content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
        }),
      ),
    ).toThrow("Invalid skill name");
  });

  test("单字符名称不合法", () => {
    expect(() =>
      parseGeneratedSkillDraft(
        JSON.stringify({
          name: "a",
          description: "d",
          content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
        }),
      ),
    ).toThrow();
  });

  test("名称含空格不合法", () => {
    expect(() =>
      parseGeneratedSkillDraft(
        JSON.stringify({
          name: "my skill",
          description: "d",
          content: "这是一个足够长的 Skill 正文内容用于测试验证至少四十个字符以确保通过解析检查不被拒绝",
        }),
      ),
    ).toThrow();
  });
});

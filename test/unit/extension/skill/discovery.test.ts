/**
 * Skill 发现模块单元测试。
 *
 * 覆盖范围:
 *   - parseSkillFile Markdown 格式解析
 *   - parseSkillFile JSON 格式解析
 *   - parseSkillFile 空内容/不存在文件
 *   - parseMarkdownSkill frontmatter 提取
 *   - parseMarkdownSkill 描述推导（frontmatter → 首行标题）
 *   - parseJsonSkill 字段映射
 *   - parseYamlFrontmatter 简易解析
 *   - parseYamlValue 类型推导（字符串/布尔/数字/数组）
 *   - 边界: 无 frontmatter、损坏的 JSON
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";

// ─── 静态导入 ────────────────────────────────────────────

import { parseSkillFile } from "@/extension/skill/discovery";

// ─── 测试目录 ──────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(require("node:os").tmpdir(), "crab-skill-test-"));
});

afterAll(() => {
  rmSync(tmpDir, { force: true, recursive: true });
});

function writeTmpFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  // 确保父目录存在
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

// ─── 测试 ──────────────────────────────────────────────────

describe("parseSkillFile", () => {
  describe("Markdown 格式", () => {
    test("解析带 frontmatter 的 SKILL.md", () => {
      const content = [
        "---",
        "name: my-skill",
        "description: 我的自定义 Skill",
        "category: 自定义",
        "trigger: 自定义触发",
        "---",
        "",
        "这是 Skill 的正文内容。",
        "可以包含多行指令。",
      ].join("\n");

      const filePath = writeTmpFile("my-skill/SKILL.md", content);
      const skill = parseSkillFile(filePath, "project");

      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("my-skill");
      expect(skill!.description).toBe("我的自定义 Skill");
      expect(skill!.category).toBe("自定义");
      expect(skill!.trigger).toBe("自定义触发");
      expect(skill!.content).toContain("这是 Skill 的正文内容");
      expect(skill!.source).toBe("project");
      expect(skill!.location).toBe(filePath);
    });

    test("无 frontmatter 时从文件路径推导名称", () => {
      const filePath = writeTmpFile("my-skill/SKILL.md", "# My Skill\n\nSkill 内容。");
      const skill = parseSkillFile(filePath, "project");

      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("my-skill");
      expect(skill!.description).toBe("My Skill");
    });

    test("无 frontmatter 的非 SKILL.md 文件用文件名推导名称", () => {
      const filePath = writeTmpFile("custom-code.md", "Skill body content.");
      const skill = parseSkillFile(filePath, "project");

      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("custom-code");
    });

    test("frontmatter 中的 description 优先于首行标题", () => {
      const content = [
        "---",
        "name: test-skill",
        "description: frontmatter 描述",
        "---",
        "",
        "# 首行标题",
        "正文内容。",
      ].join("\n");

      const filePath = writeTmpFile("SKILL.md", content);
      const skill = parseSkillFile(filePath, "project");

      expect(skill).not.toBeNull();
      expect(skill!.description).toBe("frontmatter 描述");
    });

    test("空内容返回 null", () => {
      const filePath = writeTmpFile("empty/SKILL.md", "   \n  \t  ");
      const skill = parseSkillFile(filePath, "project");
      expect(skill).toBeNull();
    });

    test("不支持的关键字 frontmatter 不影响解析", () => {
      const content = [
        "---",
        "name: test-skill",
        "description: 测试",
        "unknownField: 任意值",
        "---",
        "",
        "正文内容。",
      ].join("\n");

      const filePath = writeTmpFile("SKILL.md", content);
      const skill = parseSkillFile(filePath, "project");
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("test-skill");
    });

    test("name 为空字符串返回 null（Zod min(1) 拒绝）", () => {
      const content = ["---", "name: ", "description: 测试", "---", "", "正文。"].join("\n");

      const filePath = writeTmpFile("SKILL.md", content);
      const skill = parseSkillFile(filePath, "project");
      // Zod name: z.string().min(1) 会拒绝空字符串
      expect(skill).toBeNull();
    });
  });

  describe("JSON 格式", () => {
    test("解析标准 JSON Skill 文件", () => {
      const content = JSON.stringify({
        name: "json-skill",
        description: "JSON 格式 Skill",
        category: "测试",
        content: "JSON Skill 正文内容",
        trigger: "json触发",
        phase: "verify",
      });

      const filePath = writeTmpFile("json-skill.json", content);
      const skill = parseSkillFile(filePath, "global");

      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("json-skill");
      expect(skill!.description).toBe("JSON 格式 Skill");
      expect(skill!.category).toBe("测试");
      expect(skill!.content).toBe("JSON Skill 正文内容");
      expect(skill!.source).toBe("global");
      expect(skill!.phase).toBe("verify");
    });

    test("JSON 使用 prompt 字段作为 content", () => {
      const content = JSON.stringify({
        name: "prompt-skill",
        prompt: "使用 prompt 字段的内容",
      });

      const filePath = writeTmpFile("prompt-skill.json", content);
      const skill = parseSkillFile(filePath, "project");

      expect(skill).not.toBeNull();
      expect(skill!.content).toBe("使用 prompt 字段的内容");
    });

    test("无效 JSON 返回 null", () => {
      const filePath = writeTmpFile("invalid.json", "{invalid json");
      const skill = parseSkillFile(filePath, "project");
      expect(skill).toBeNull();
    });

    test("JSON name 缺失时用文件名推导", () => {
      const content = JSON.stringify({
        description: "无 name",
        content: "内容",
      });

      const filePath = writeTmpFile("auto-name.json", content);
      const skill = parseSkillFile(filePath, "project");
      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("auto-name");
    });

    test("JSON 默认 category 为 general", () => {
      const content = JSON.stringify({
        name: "no-category",
        content: "内容",
      });

      const filePath = writeTmpFile("no-category.json", content);
      const skill = parseSkillFile(filePath, "project");
      expect(skill).not.toBeNull();
      expect(skill!.category).toBe("general");
    });
  });
});

describe("parseYamlValue (通过 parseSkillFile 间接测试)", () => {
  test("布尔值 true", () => {
    const content = "---\nname: yaml-bool\nhidden: true\n---\n\n内容";
    const filePath = writeTmpFile("SKILL.md", content);
    const skill = parseSkillFile(filePath, "project");
    expect(skill).not.toBeNull();
    expect(skill!.hidden).toBe(true);
  });

  test("布尔值 false", () => {
    const content = "---\nname: yaml-bool-false\nhidden: false\n---\n\n内容";
    const filePath = writeTmpFile("SKILL.md", content);
    const skill = parseSkillFile(filePath, "project");
    expect(skill).not.toBeNull();
    expect(skill!.hidden).toBe(false);
  });

  test("引号字符串", () => {
    const content = "---\nname: \"quoted-name\"\ndescription: '带引号的描述'\n---\n\n内容";
    const filePath = writeTmpFile("SKILL.md", content);
    const skill = parseSkillFile(filePath, "project");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("quoted-name");
    expect(skill!.description).toBe("带引号的描述");
  });

  test("数组值 [a, b]", () => {
    const content = "---\nname: array-skill\ntools: [read, write, bash]\n---\n\n内容";
    const filePath = writeTmpFile("SKILL.md", content);
    const skill = parseSkillFile(filePath, "project");
    expect(skill).not.toBeNull();
    expect(skill!.tools).toEqual(["read", "write", "bash"]);
  });

  test("数字值", () => {
    const content = "---\nname: order-skill\norder: 42\n---\n\n内容";
    const filePath = writeTmpFile("SKILL.md", content);
    const skill = parseSkillFile(filePath, "project");
    expect(skill).not.toBeNull();
    expect(skill!.order).toBe(42);
  });

  test("注释行跳过", () => {
    const content = "---\n# 这是注释\nname: comment-skill\n# 另一个注释\ndescription: 有注释的 Skill\n---\n\n内容";
    const filePath = writeTmpFile("SKILL.md", content);
    const skill = parseSkillFile(filePath, "project");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("comment-skill");
    expect(skill!.description).toBe("有注释的 Skill");
  });

  test("空行跳过", () => {
    const content = "---\n\nname: empty-line-skill\n\ndescription: 有空行的 Skill\n\n---\n\n内容";
    const filePath = writeTmpFile("SKILL.md", content);
    const skill = parseSkillFile(filePath, "project");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("empty-line-skill");
  });

  // ─── P0-2: 嵌套对象数组（parameters）─────────────────

  test("YAML 嵌套对象数组（parameters 两个参数）", () => {
    const content = [
      "---",
      "name: my-skill",
      "category: code",
      "parameters:",
      "  - name: code",
      "    type: string",
      "    required: true",
      "    description: 要处理的代码",
      "  - name: language",
      "    type: string",
      "    required: false",
      "    description: 编程语言",
      "---",
      "",
      "Skill 正文内容",
    ].join("\n");
    const filePath = writeTmpFile("SKILL.md", content);
    const skill = parseSkillFile(filePath, "project");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("my-skill");
    expect(skill!.parameters).toBeDefined();
    expect(skill!.parameters!.length).toBe(2);
    expect(skill!.parameters![0]).toEqual({
      description: "要处理的代码",
      name: "code",
      required: true,
      type: "string",
    });
    expect(skill!.parameters![1]).toEqual({
      description: "编程语言",
      name: "language",
      required: false,
      type: "string",
    });
  });

  test("YAML 嵌套对象数组（单个参数）", () => {
    const content = [
      "---",
      "name: single-param",
      "parameters:",
      "  - name: input",
      "    type: string",
      "    required: true",
      "    description: 用户输入",
      "---",
      "",
      "内容",
    ].join("\n");
    const filePath = writeTmpFile("SKILL.md", content);
    const skill = parseSkillFile(filePath, "builtin");
    expect(skill).not.toBeNull();
    expect(skill!.parameters!.length).toBe(1);
    expect(skill!.parameters![0].name).toBe("input");
  });
});

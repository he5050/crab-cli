/**
 * 内置 Skill 定义单元测试。
 *
 * 覆盖范围:
 *   - 内置 Skill 数量不少于 7 个
 *   - 每个 Skill 有必需字段
 *   - 名称无重复
 *   - source 为 builtin
 *   - location 为 <builtin>
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

// ─── 静态导入 ────────────────────────────────────────────

import { builtinSkills } from "@/extension/skill/builtin";

// ─── 测试 ──────────────────────────────────────────────────

describe("builtinSkills", () => {
  test("至少包含 7 个内置 Skill", () => {
    expect(builtinSkills.length).toBeGreaterThanOrEqual(7);
  });

  test("每个 Skill 有必需字段", () => {
    for (const skill of builtinSkills) {
      expect(skill.name).toBeDefined();
      expect(skill.name.length).toBeGreaterThan(0);
      expect(skill.content).toBeDefined();
      expect(skill.location).toBe("<builtin>");
      expect(skill.source).toBe("builtin");
      expect(skill.category).toBeDefined();
    }
  });

  test("名称无重复", () => {
    const names = builtinSkills.map((s) => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test("包含预期的核心 Skill", () => {
    const names = builtinSkills.map((s) => s.name);
    expect(names).toContain("explain-code");
    expect(names).toContain("review-code");
    expect(names).toContain("write-test");
    expect(names).toContain("refactor");
    expect(names).toContain("generate-docs");
    expect(names).toContain("fix-bug");
    expect(names).toContain("customize-crab");
  });

  test("每个 Skill 的 content 非空", () => {
    for (const skill of builtinSkills) {
      expect(skill.content.trim().length).toBeGreaterThan(0);
    }
  });

  test("带参数的 Skill 的 parameters 定义完整", () => {
    for (const skill of builtinSkills) {
      if (skill.parameters) {
        for (const param of skill.parameters) {
          expect(param.name).toBeDefined();
          expect(param.type).toBeDefined();
          expect(param.description).toBeDefined();
          expect(["string", "number", "boolean"]).toContain(param.type);
        }
      }
    }
  });

  test("trigger 字段仅在 customize-crab 上设置", () => {
    const withTrigger = builtinSkills.filter((s) => s.trigger);
    // customize-crab 是唯一有 trigger 的
    expect(withTrigger.length).toBeGreaterThanOrEqual(1);
    expect(withTrigger.find((s) => s.name === "customize-crab")?.trigger).toBe("crab config");
  });
});

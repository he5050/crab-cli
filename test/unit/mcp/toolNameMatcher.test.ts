/**
 * 工具名匹配器测试。
 *
 * 测试目标:
 *   - 验证 toolNameMatches 在工具名匹配场景下的行为
 *
 * 测试用例:
 *   - 完全匹配
 *   - 大小写不敏感匹配
 *   - 模糊/前缀匹配策略
 */
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { toolNameMatches } from "@/tool/registry/toolNameMatcher";

const ROOT = process.cwd();

describe("toolNameMatches", () => {
  test("匹配精确名称, 前缀, 与通配符", () => {
    expect(toolNameMatches("filesystem-read", "filesystem-read")).toBe(true);
    expect(toolNameMatches("filesystem-read", "filesystem")).toBe(true);
    expect(toolNameMatches("any-tool", "*")).toBe(true);
  });

  test("keeps builtin tools from matching short suffix aliases", () => {
    expect(toolNameMatches("filesystem-read", "read")).toBe(false);
    expect(toolNameMatches("terminal-execute", "execute")).toBe(false);
  });

  test("matches external and MCP generated names by raw tool suffix", () => {
    expect(toolNameMatches("github_create_issue", "create_issue")).toBe(true);
    expect(toolNameMatches("github-create-issue", "create-issue")).toBe(true);
    expect(toolNameMatches("apifox_priority_combo", "priority_combo")).toBe(true);
  });

  test("does not import agent internals for builtin tool prefixes", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/tool/registry/toolNameMatcher.ts"), "utf8");

    expect(source).not.toMatch(/from\s+["']@agent\//);
    expect(source).not.toMatch(/import\(\s*["']@agent\//);
  });
});

/**
 * SkillManager 单元测试。
 *
 * 注意: skillManager 是模块级单例，测试间共享状态。
 * 本文件仅测试通过 mock.module 隔离的关键路径。
 *
 * 覆盖范围:
 *   - init 初始化（内置 + 发现 + 禁用）
 *   - reload 重置 initialized 标志（P0-1 修复验证）
 *   - 查询接口 get/has/size
 *   - listVisible 排除 hidden
 *   - searchDetailed 精确匹配
 *   - formatList 中文输出
 *   - disable/enable/isDisabled
 *   - run 执行
 */
import { beforeAll, afterAll, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE_CWD = process.cwd();

let tmpDir: string;
let projectDir: string;

// ─── Mock ────────────────────────────────────────────────

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    child: () => ({ child: () => ({}) }),
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  }),
}));

const builtinMockFactory = () => ({
  builtinSkills: [
    {
      category: "代码",
      content: "解释代码的指令内容",
      description: "解释代码",
      location: "<builtin>",
      name: "explain-code",
      source: "builtin" as const,
    },
    {
      category: "测试",
      content: "写测试的指令内容",
      description: "编写测试",
      location: "<builtin>",
      name: "write-test",
      source: "builtin" as const,
    },
    {
      category: "文档",
      content: "生成文档的指令内容",
      description: "生成文档",
      hidden: true,
      location: "<builtin>",
      name: "generate-docs",
      source: "builtin" as const,
    },
  ],
});

mock.module("@extension/skill/builtin", builtinMockFactory);
mock.module(path.resolve(BASE_CWD, "src/extension/skill/builtin"), builtinMockFactory);
mock.module(path.resolve(BASE_CWD, "src/extension/skill/builtin.ts"), builtinMockFactory);
mock.module(path.resolve(BASE_CWD, "src/extension/skill/builtin/index"), builtinMockFactory);
mock.module(path.resolve(BASE_CWD, "src/extension/skill/builtin/index.ts"), builtinMockFactory);

const discoveryMockFactory = () => ({
  discoverSkills: async () => [
    {
      category: "自定义",
      content: "自定义 skill 内容",
      description: "我的自定义 Skill",
      location: "/project/.crab/skills/my-skill/SKILL.md",
      name: "my-skill",
      source: "project" as const,
      trigger: "自定义触发",
    },
  ],
  parseSkillFile: () => null,
});

mock.module("@extension/skill/discovery", discoveryMockFactory);
mock.module(path.resolve(BASE_CWD, "src/extension/skill/discovery"), discoveryMockFactory);
mock.module(path.resolve(BASE_CWD, "src/extension/skill/discovery.ts"), discoveryMockFactory);
mock.module(path.resolve(BASE_CWD, "src/extension/skill/discovery/index"), discoveryMockFactory);
mock.module(path.resolve(BASE_CWD, "src/extension/skill/discovery/index.ts"), discoveryMockFactory);

mock.module("@/hooks/hookExecutor", () => ({
  hookExecutor: { skillExecute: async () => ({ allowed: true }) },
}));

mock.module("@/session/usageMemory", () => ({
  getUsageBoost: () => ({ score: 0, reasons: [] }),
  recordUsageMemory: () => ({}),
  readUsageMemory: () => [],
  getUsageCandidates: () => [],
  clearUsageMemoryForTest: () => {},
  extractIntentKeywords: () => [],
  __usageMemoryPathsForTest: {},
}));

// ─── 静态导入 ────────────────────────────────────────────

import { skillManager } from "@/extension/skill/manager";

// ─── 测试 ──────────────────────────────────────────────────

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crab-skill-mgr-"));
  projectDir = path.join(tmpDir, "project");
  fs.mkdirSync(path.join(projectDir, ".crab"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { force: true, recursive: true });
});

describe("SkillManager", () => {
  // ─── init + reload ────────────────────────────────────

  test("init 加载内置 + 发现的 Skill", async () => {
    await skillManager.init(projectDir);
    // 3 内置 + 1 自定义
    expect(skillManager.size).toBe(4);
  });

  test("重复 init 不重复加载", async () => {
    await skillManager.init(projectDir);
    const size = skillManager.size;
    await skillManager.init(projectDir);
    expect(skillManager.size).toBe(size);
  });

  test("并发 init 复用同一 Promise（P1-3 修复验证）", async () => {
    // 先 reload 重置状态
    await skillManager.reload(projectDir);
    // 并发调用 init 两次，应返回同一 Promise
    const p1 = skillManager.init(projectDir);
    const p2 = skillManager.init(projectDir);
    expect(p1).toBe(p2);
    await p1;
    expect(skillManager.size).toBe(4);
  });

  test("reload 后 init 可重新初始化（P0-1 修复）", async () => {
    await skillManager.reload(projectDir);
    expect(skillManager.size).toBe(4);
    // reload 重置了 initialized 标志
    await skillManager.init(projectDir);
    expect(skillManager.size).toBe(4);
  });

  // ─── 查询 ──────────────────────────────────────────────

  test("get/has/size 基本查询", () => {
    expect(skillManager.has("explain-code")).toBe(true);
    expect(skillManager.has("nonexistent")).toBe(false);
    expect(skillManager.get("explain-code")!.name).toBe("explain-code");
    expect(skillManager.get("nonexistent")).toBeUndefined();
    expect(skillManager.size).toBe(4);
  });

  test("listVisible 排除 hidden Skill", () => {
    const visible = skillManager.listVisible();
    expect(visible.length).toBe(3);
    expect(visible.find((s) => s.name === "generate-docs")).toBeUndefined();
  });

  test("listBySource 按来源过滤", () => {
    expect(skillManager.listBySource("builtin").length).toBe(3);
    expect(skillManager.listBySource("project").length).toBe(1);
  });

  // ─── search ───────────────────────────────────────────

  test("searchDetailed 精确名称匹配得分最高", () => {
    const results = skillManager.searchDetailed("explain-code");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.skill.name).toBe("explain-code");
    expect(results[0]!.score).toBeGreaterThanOrEqual(100);
  });

  test("searchDetailed 空查询返回空", () => {
    expect(skillManager.searchDetailed("")).toEqual([]);
    expect(skillManager.searchDetailed("   ")).toEqual([]);
  });

  // ─── formatList ──────────────────────────────────────

  test("formatList 中文输出且排除 hidden", () => {
    const result = skillManager.formatList();
    expect(result).toContain("## 可用 Skills");
    expect(result).toContain("**explain-code**");
    expect(result).not.toContain("**generate-docs**");
  });

  // ─── disable / enable ────────────────────────────────

  test("disable 移除 Skill 并持久化禁用列表", () => {
    expect(skillManager.disable("explain-code")).toBe(true);
    expect(skillManager.get("explain-code")).toBeUndefined();
    expect(skillManager.isDisabled("explain-code")).toBe(true);
    expect(skillManager.getDisabledList()).toContain("explain-code");
  });

  test("enable 恢复禁用状态", () => {
    expect(skillManager.enable("explain-code")).toBe(true);
    expect(skillManager.isDisabled("explain-code")).toBe(false);
  });

  test("disable 不存在的 Skill 返回 false", () => {
    expect(skillManager.disable("nonexistent")).toBe(false);
  });

  test("enable 未禁用的 Skill 返回 false", () => {
    expect(skillManager.enable("write-test")).toBe(false);
  });

  // ─── run（需要先 reload 恢复被 disable 移除的 Skill）───

  test("reload 恢复被移除的 Skill", async () => {
    await skillManager.reload(projectDir);
    expect(skillManager.has("explain-code")).toBe(true);
    expect(skillManager.size).toBe(4);
  });

  test("run 执行 Skill 返回 ok + prompt", async () => {
    const result = await skillManager.run("explain-code", { code: "const x = 1;" });
    expect(result.ok).toBe(true);
    expect(result.skillName).toBe("explain-code");
    expect(result.prompt).toContain("解释代码");
  });

  test("run 不存在的 Skill 返回错误", async () => {
    const result = await skillManager.run("nonexistent");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不存在");
  });

  test("run 追加用户输入", async () => {
    const result = await skillManager.run("explain-code", {}, "请解释");
    expect(result.ok).toBe(true);
    expect(result.prompt).toContain("请解释");
  });

  // ─── listGrouped ──────────────────────────────────────

  test("listGrouped 按分类分组且排除 hidden", () => {
    const grouped = skillManager.listGrouped();
    expect(grouped.size).toBeGreaterThan(0);
    for (const [, skills] of grouped) {
      expect(skills.find((s) => s.name === "generate-docs")).toBeUndefined();
    }
  });

  // ─── reload 并发保护 ─────────────────────────────────

  test("reload 并发调用复用同一 Promise", async () => {
    const p1 = skillManager.reload(projectDir);
    const p2 = skillManager.reload(projectDir);
    // 两个并发调用都应正常完成（内部复用同一 _reload，不会重复加载）
    await Promise.all([p1, p2]);
    expect(skillManager.has("explain-code")).toBe(true);
  });
});

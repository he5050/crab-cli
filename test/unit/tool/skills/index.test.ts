/**
 * src/tool/skills 单元测试
 *
 * 测试范围:
 *   - 各 action 分支的参数校验和返回值结构
 *   - 通过 mock skillManager 隔离外部依赖
 *
 * 策略: mock.module 替换 @/extension/skill，验证路由逻辑和返回格式。
 */
import { afterEach, describe, expect, it, mock } from "bun:test";

// ── Mock 外部依赖 ──────────────────────────────────────────────────

const mockListVisible = mock(() => [] as any[]);
const mockSearchDetailed = mock((_query: string, _limit?: number) => [] as any[]);
const mockGet = mock((_name: string) => null as any);
const mockRun = mock(async (_name: string, _params?: any, _input?: string) => ({ ok: true, prompt: "prompt" }) as any);
const mockDisable = mock((_name: string) => false);
const mockEnable = mock((_name: string) => false);
const mockReload = mock(async () => {});
const mockInit = mock(async () => {});
const mockResolveExplicitSkillReference = mock((_msg: string) => ({ status: "none" as const }));
const mockRecommendSkillsForContext = mock((_opts: any) => [] as any[]);

// 创建可变 mock size
const mockSkillManagerProxy = {
  disable: mockDisable,
  enable: mockEnable,
  get: mockGet,
  init: mockInit,
  listVisible: mockListVisible,
  reload: mockReload,
  run: mockRun,
  searchDetailed: mockSearchDetailed,
  get size() {
    return 5; // 模拟已有技能
  },
};

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

mock.module("@/extension/skill", () => ({
  recommendSkillsForContext: mockRecommendSkillsForContext,
  resolveExplicitSkillReference: mockResolveExplicitSkillReference,
  skillManager: mockSkillManagerProxy,
}));

import { skillsTool } from "@/tool/skills";

afterEach(() => {
  mockListVisible.mockClear();
  mockSearchDetailed.mockClear();
  mockGet.mockClear();
  mockRun.mockClear();
  mockDisable.mockClear();
  mockEnable.mockClear();
  mockReload.mockClear();
  mockRecommendSkillsForContext.mockClear();
  mockResolveExplicitSkillReference.mockClear();
});

// ═══════════════════════════════════════════════════════════════════
// list
// ═══════════════════════════════════════════════════════════════════
describe("skillsTool — list", () => {
  it("应列出所有可见技能", async () => {
    mockListVisible.mockReturnValueOnce([
      { category: "code", description: "代码解释", name: "explain-code", source: "builtin" } as any,
    ]);
    const r = (await skillsTool.execute({ action: "list" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.total).toBe(1);
    expect(r.action).toBe("list");
  });
});

// ═══════════════════════════════════════════════════════════════════
// recommend
// ═══════════════════════════════════════════════════════════════════
describe("skillsTool — recommend", () => {
  it("缺 context 和 query 应返回错误", async () => {
    const r = (await skillsTool.execute({ action: "recommend" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("context");
  });

  it("应返回推荐列表", async () => {
    mockRecommendSkillsForContext.mockReturnValueOnce([{ name: "review-code", score: 0.9, reason: "代码审查" }]);
    const r = (await skillsTool.execute({ action: "recommend", context: "审查这段代码" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.total).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// search
// ═══════════════════════════════════════════════════════════════════
describe("skillsTool — search", () => {
  it("缺 query 应返回错误", async () => {
    const r = (await skillsTool.execute({ action: "search" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("query");
  });

  it("应返回搜索结果", async () => {
    mockSearchDetailed.mockReturnValueOnce([
      {
        matchReasons: ["名称匹配"],
        nextStep: "执行",
        order: 1,
        phase: "implement",
        recommendedAction: "execute",
        score: 0.95,
        skill: { category: "code", description: "审查", name: "review-code", content: "prompt", source: "builtin" },
      },
    ]);
    const r = (await skillsTool.execute({ action: "search", query: "review" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.total).toBe(1);
    expect(r.query).toBe("review");
  });
});

// ═══════════════════════════════════════════════════════════════════
// info
// ═══════════════════════════════════════════════════════════════════
describe("skillsTool — info", () => {
  it("缺 skillName 应返回错误", async () => {
    const r = (await skillsTool.execute({ action: "info" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("skillName");
  });

  it("不存在的技能应返回错误", async () => {
    const r = (await skillsTool.execute({ action: "info", skillName: "nonexistent" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("不存在");
  });

  it("存在的技能应返回详情", async () => {
    mockGet.mockReturnValueOnce({
      category: "code",
      content: "prompt内容",
      description: "代码审查",
      location: "/path/to/skill",
      name: "review-code",
      parameters: [{ name: "code", required: true, type: "string" }],
      source: "builtin",
      tools: ["read", "grep"],
    });
    const r = (await skillsTool.execute({ action: "info", skillName: "review-code" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect((r.skill as Record<string, unknown>).name).toBe("review-code");
    expect((r.skill as Record<string, unknown>).hasContent).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// execute
// ═══════════════════════════════════════════════════════════════════
describe("skillsTool — execute", () => {
  it("缺 skillName 应返回错误", async () => {
    const r = (await skillsTool.execute({ action: "execute" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("skillName");
  });

  it("执行失败应返回错误", async () => {
    mockGet.mockReturnValueOnce({ name: "bad", parameters: [] } as any);
    mockRun.mockResolvedValueOnce({ ok: false, error: "执行异常" } as any);
    const r = (await skillsTool.execute({ action: "execute", skillName: "bad" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("执行异常");
  });

  it("执行成功应返回 prompt", async () => {
    mockGet.mockReturnValueOnce({ name: "good", parameters: [] } as any);
    mockRun.mockResolvedValueOnce({ ok: true, prompt: "审查此代码" } as any);
    const r = (await skillsTool.execute({ action: "execute", skillName: "good" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.prompt).toBe("审查此代码");
  });
});

// ═══════════════════════════════════════════════════════════════════
// disable / enable / reload
// ═══════════════════════════════════════════════════════════════════
describe("skillsTool — disable / enable / reload", () => {
  it("disable 不存在的技能应返回错误", async () => {
    const r = (await skillsTool.execute({ action: "disable", skillName: "no" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
  });

  it("disable 成功", async () => {
    mockDisable.mockReturnValueOnce(true);
    const r = (await skillsTool.execute({ action: "disable", skillName: "active" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.message).toContain("已禁用");
  });

  it("enable 未禁用的技能应返回错误", async () => {
    const r = (await skillsTool.execute({ action: "enable", skillName: "active" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
  });

  it("enable 成功", async () => {
    mockEnable.mockReturnValueOnce(true);
    const r = (await skillsTool.execute({ action: "enable", skillName: "disabled" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
  });

  it("reload 应重新加载技能列表", async () => {
    mockListVisible.mockReturnValueOnce([{ category: "code", description: "d", name: "r1", source: "b" } as any]);
    const r = (await skillsTool.execute({ action: "reload" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.total).toBe(1);
  });
});

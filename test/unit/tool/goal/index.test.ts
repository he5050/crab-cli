/**
 * src/tool/goal 单元测试
 *
 * 测试范围:
 *   - create / update / complete / list / status 各 action 分支
 *   - 参数校验和错误处理
 *
 * 策略: mock.module 替换 @/mission (goalManager)，验证路由逻辑。
 */
import { afterEach, describe, expect, it, mock } from "bun:test";

// ── Mock 外部依赖 ──────────────────────────────────────────────────

const mockCreateGoal = mock(
  (_opts: any) => ({ id: "g1", objective: "测试目标", status: "active", tokenBudget: 2000000 }) as any,
);
const mockLoadGoal = mock((_sid: string) => null as any);
const mockLoadAllGoals = mock(() => [] as any);
const mockModelUpdateGoal = mock((_sid: string, _opts: any) => null as any);
const mockFormatSummary = mock((_goal: any) => "摘要");

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

mock.module("@/mission", () => ({
  goalManager: {
    createGoal: mockCreateGoal,
    formatSummary: mockFormatSummary,
    loadAllGoals: mockLoadAllGoals,
    loadGoal: mockLoadGoal,
    modelUpdateGoal: mockModelUpdateGoal,
  },
}));

import { goalTool } from "@/tool/goal";

afterEach(() => {
  mockCreateGoal.mockClear();
  mockLoadGoal.mockClear();
  mockLoadAllGoals.mockClear();
  mockModelUpdateGoal.mockClear();
  mockFormatSummary.mockClear();
});

// ═══════════════════════════════════════════════════════════════════
// create
// ═══════════════════════════════════════════════════════════════════
describe("goalTool — create", () => {
  it("缺 objective 应返回错误", async () => {
    const r = (await goalTool.execute({ action: "create" }, { sessionId: "s1", messageId: "m1" } as any)) as Record<
      string,
      unknown
    >;
    expect(r.success).toBe(false);
    expect(r.error).toContain("objective");
  });

  it("正常创建目标", async () => {
    mockCreateGoal.mockReturnValueOnce({
      id: "g1",
      objective: "完成重构",
      status: "active",
      tokenBudget: 500000,
    } as any);
    const r = (await goalTool.execute({ action: "create", objective: "完成重构" }, {
      sessionId: "s1",
      messageId: "m1",
    } as any)) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.action).toBe("create");
    expect((r.goal as Record<string, unknown>).id).toBe("g1");
  });

  it("支持自定义 tokenBudget", async () => {
    mockCreateGoal.mockReturnValueOnce({ id: "g2", objective: "限量", status: "active", tokenBudget: 100 });
    const r = (await goalTool.execute({ action: "create", objective: "限量", tokenBudget: 100 }, {} as any)) as Record<
      string,
      unknown
    >;
    expect(r.success).toBe(true);
    expect((r.goal as Record<string, unknown>).tokenBudget).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// update
// ═══════════════════════════════════════════════════════════════════
describe("goalTool — update", () => {
  it("无活跃目标应返回错误", async () => {
    const r = (await goalTool.execute({ action: "update" }, { sessionId: "s1" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("活跃目标");
  });

  it("有活跃目标应返回详情", async () => {
    mockLoadGoal.mockReturnValueOnce({
      id: "g1",
      objective: "目标",
      runCount: 3,
      status: "active",
      tokenBudget: 2000000,
      tokensUsed: 50000,
    } as any);
    const r = (await goalTool.execute({ action: "update" }, { sessionId: "s1", messageId: "m1" } as any)) as Record<
      string,
      unknown
    >;
    expect(r.success).toBe(true);
    expect(r.action).toBe("update");
  });
});

// ═══════════════════════════════════════════════════════════════════
// complete
// ═══════════════════════════════════════════════════════════════════
describe("goalTool — complete", () => {
  it("缺 status 应返回错误", async () => {
    const r = (await goalTool.execute({ action: "complete" }, { sessionId: "s1" })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("status");
  });

  it("无活跃目标应返回错误", async () => {
    const r = (await goalTool.execute({ action: "complete", status: "achieved" }, {
      sessionId: "s1",
      messageId: "m1",
    } as any)) as Record<string, unknown>;
    expect(r.success).toBe(false);
  });

  it("标记 achieved 应成功", async () => {
    mockModelUpdateGoal.mockReturnValueOnce({
      id: "g1",
      lastExplanation: "测试通过",
      runCount: 5,
      status: "achieved",
      tokensUsed: 80000,
    } as any);
    const r = (await goalTool.execute({ action: "complete", status: "achieved", explanation: "测试通过" }, {
      sessionId: "s1",
      messageId: "m1",
    } as any)) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.action).toBe("complete");
    expect((r.goal as Record<string, unknown>).status).toBe("achieved");
  });
});

// ═══════════════════════════════════════════════════════════════════
// list
// ═══════════════════════════════════════════════════════════════════
describe("goalTool — list", () => {
  it("应列出所有目标", async () => {
    mockLoadAllGoals.mockReturnValueOnce([
      {
        id: "g1",
        objective: "目标1",
        status: "active",
        sessionId: "s1",
        runCount: 0,
        tokenBudget: 100,
        tokensUsed: 0,
      } as any,
      {
        id: "g2",
        objective: "目标2",
        status: "achieved",
        sessionId: "s2",
        runCount: 3,
        tokenBudget: 200,
        tokensUsed: 50,
      } as any,
    ]);
    const r = (await goalTool.execute({ action: "list" }, {} as any)) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.total).toBe(2);
    expect(r.action).toBe("list");
  });

  it("空列表应返回 total=0", async () => {
    const r = (await goalTool.execute({ action: "list" }, {} as any)) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// status
// ═══════════════════════════════════════════════════════════════════
describe("goalTool — status", () => {
  it("不存在的目标应返回错误", async () => {
    const r = (await goalTool.execute({ action: "status" }, {
      sessionId: "noexist",
      messageId: "m1",
    } as any)) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toContain("没有找到");
  });

  it("存在的目标应返回详情和摘要", async () => {
    mockLoadGoal.mockReturnValueOnce({
      id: "g1",
      objective: "详情目标",
      status: "active",
      runCount: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastExplanation: "进行中",
      tokenBudget: 100,
      tokensUsed: 20,
    } as any);
    mockFormatSummary.mockReturnValueOnce("进度: 20%");
    const r = (await goalTool.execute({ action: "status" }, { sessionId: "s1" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.action).toBe("status");
    expect(r.summary).toBe("进度: 20%");
  });
});

/**
 * src/tool/agentComms 单元测试
 *
 * 测试范围:
 *   - sendMessageToAgentTool: 发送消息（目标不存在/存在/投递失败）
 *   - queryAgentsStatusTool: 查询状态（全部/单个/不存在）
 *
 * 策略: mock.module 替换 @/agent 依赖，验证路由和错误处理。
 */
import { afterEach, describe, expect, it, mock } from "bun:test";

// ── Mock 外部依赖 ──────────────────────────────────────────────────

const mockIsRunning = mock((_id: string) => false);
const mockInjectMessage = mock((_id: string, _msg: string) => false);
const mockListSubAgents = mock(() => [] as any[]);

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

mock.module("@/agent", () => ({
  injectToolSubAgentMessage: mockInjectMessage,
  isToolSubAgentRunning: mockIsRunning,
  listToolSubAgents: mockListSubAgents,
}));

import { queryAgentsStatusTool, sendMessageToAgentTool } from "@/tool/agentComms";

afterEach(() => {
  mockIsRunning.mockClear();
  mockInjectMessage.mockClear();
  mockListSubAgents.mockClear();
});

// ═══════════════════════════════════════════════════════════════════
// sendMessageToAgentTool
// ═══════════════════════════════════════════════════════════════════
describe("sendMessageToAgentTool", () => {
  it("目标不存在应返回错误", async () => {
    mockIsRunning.mockReturnValueOnce(false);
    const r = (await sendMessageToAgentTool.execute({
      message: "你好",
      targetInstanceId: "nonexistent",
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.error).toContain("不存在或已停止");
  });

  it("投递失败应返回错误", async () => {
    mockIsRunning.mockReturnValueOnce(true);
    mockInjectMessage.mockReturnValueOnce(false);
    const r = (await sendMessageToAgentTool.execute({
      message: "你好",
      targetInstanceId: "agent_1",
    })) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.error).toContain("消息投递失败");
  });

  it("成功投递应返回 delivered=true", async () => {
    mockIsRunning.mockReturnValueOnce(true);
    mockInjectMessage.mockReturnValueOnce(true);
    const r = (await sendMessageToAgentTool.execute({
      message: "执行任务",
      targetInstanceId: "agent_1",
      fromLabel: "主控",
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.delivered).toBe(true);
    expect(r.targetInstanceId).toBe("agent_1");
    expect(r.messageLength).toBe(4); // "执行任务" length
  });

  it("无 fromLabel 应默认为主控", async () => {
    mockIsRunning.mockReturnValueOnce(true);
    mockInjectMessage.mockReturnValueOnce(true);
    const r = (await sendMessageToAgentTool.execute({
      message: "test",
      targetInstanceId: "a1",
    })) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(mockInjectMessage).toHaveBeenCalledWith("a1", "[主代理] test");
  });
});

// ═══════════════════════════════════════════════════════════════════
// queryAgentsStatusTool
// ═══════════════════════════════════════════════════════════════════
describe("queryAgentsStatusTool", () => {
  it("列出所有 Agent（空列表）", async () => {
    const r = (await queryAgentsStatusTool.execute({})) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.totalRunning).toBe(0);
    expect(r.agents).toEqual([]);
  });

  it("列出所有 Agent（有数据）", async () => {
    mockListSubAgents.mockReturnValueOnce([
      { agentName: "coder", instanceId: "a1", messageCount: 2, startedAt: Date.now() - 60000 } as any,
    ]);
    const r = (await queryAgentsStatusTool.execute({})) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.totalRunning).toBe(1);
    expect((r.agents as Array<Record<string, unknown>>)[0]!.agentName).toBe("coder");
  });

  it("查询单个不存在的 Agent", async () => {
    mockIsRunning.mockReturnValueOnce(false);
    const r = (await queryAgentsStatusTool.execute({ instanceId: "noexist" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.found).toBe(false);
    expect(r.status).toBe("not_running");
  });

  it("查询单个存在的 Agent", async () => {
    mockIsRunning.mockReturnValueOnce(true);
    mockListSubAgents.mockReturnValueOnce([
      { agentName: "reviewer", instanceId: "a2", messageCount: 0, startedAt: Date.now() } as any,
    ]);
    const r = (await queryAgentsStatusTool.execute({ instanceId: "a2" })) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect(r.found).toBe(true);
    expect((r.agent as Record<string, unknown>).agentName).toBe("reviewer");
  });
});

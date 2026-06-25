import { describe, expect, test } from "bun:test";

import { subagentTool } from "@/tool/subagent";

/** execute 返回 unknown，测试中需要类型断言 */
interface ToolResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * subagentTool execute 的 no-context fallback 路径测试。
 *
 * 不传入 context（或传入 undefined），利用无 context 时各 action 的回退行为：
 *   spawn  → pending 状态
 *   status → "子代理不存在" 错误
 *   list   → 空列表
 *   stop   → 检查 spawnedAgentIds 集合
 */
describe("subagentTool", () => {
  // ------------------------------------------------------------------
  // spawn
  // ------------------------------------------------------------------
  describe("spawn", () => {
    test("缺少 prompt 和 name 时返回 error", async () => {
      const result = (await subagentTool.execute({ action: "spawn" })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("prompt");
      expect(result.error).toContain("name");
    });

    test("只有 name 无 prompt，无 context 时返回 pending 状态", async () => {
      const result = (await subagentTool.execute({ action: "spawn", name: "my-task" })) as ToolResult;
      expect(result.success).toBe(true);
      expect(result.action).toBe("spawn");
      expect(result.status).toBe("pending");
      expect(result.name).toBe("my-task");
      expect(result.agentId).toBeDefined();
      expect(typeof result.agentId).toBe("string");
    });

    test("有 prompt，无 context 时返回 pending 状态", async () => {
      const result = (await subagentTool.execute({
        action: "spawn",
        prompt: "请帮我搜索资料",
      })) as ToolResult;
      expect(result.success).toBe(true);
      expect(result.action).toBe("spawn");
      expect(result.status).toBe("pending");
      expect(result.prompt).toBe("请帮我搜索资料");
      expect(result.agentId).toBeDefined();
    });

    test("spawn 成功后返回的 agentId 在后续 stop 中可被识别", async () => {
      const spawnResult = (await subagentTool.execute({
        action: "spawn",
        prompt: "test stop integration",
      })) as ToolResult;
      expect(spawnResult.success).toBe(true);

      // 同一 agentId 应该能被 stop（spawnedAgentIds 是模块级 Set）
      const stopResult = (await subagentTool.execute({
        action: "stop",
        agentId: spawnResult.agentId as string,
      })) as ToolResult;
      expect(stopResult.success).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // status
  // ------------------------------------------------------------------
  describe("status", () => {
    test("缺少 agentId 时返回 error", async () => {
      const result = (await subagentTool.execute({ action: "status" })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("agentId");
    });

    test("不存在的 agentId，无 context 时返回 error", async () => {
      const result = (await subagentTool.execute({
        action: "status",
        agentId: "nonexistent-id",
      })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("nonexistent-id");
      expect(result.action).toBe("status");
    });
  });

  // ------------------------------------------------------------------
  // list
  // ------------------------------------------------------------------
  describe("list", () => {
    test("无 context 时返回空列表", async () => {
      const result = (await subagentTool.execute({ action: "list" })) as ToolResult;
      expect(result.success).toBe(true);
      expect(result.action).toBe("list");
      expect(result.agents).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // stop
  // ------------------------------------------------------------------
  describe("stop", () => {
    test("缺少 agentId 时返回 error", async () => {
      const result = (await subagentTool.execute({ action: "stop" })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("agentId");
    });

    test("不存在的 agentId（不在 spawnedAgentIds 中）返回 error", async () => {
      const result = (await subagentTool.execute({
        action: "stop",
        agentId: "no-such-agent",
      })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("no-such-agent");
    });
  });

  // ------------------------------------------------------------------
  // 未知 action
  // ------------------------------------------------------------------
  describe("unknown action", () => {
    test("未知 action 返回 error", async () => {
      const result = (await subagentTool.execute({ action: "foobar" } as unknown as { action: "spawn" })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("foobar");
    });
  });

  // ------------------------------------------------------------------
  // 工具定义元数据
  // ------------------------------------------------------------------
  describe("tool definition", () => {
    test("导出 subagentTool 且包含必要字段", () => {
      expect(subagentTool.name).toBe("subagent");
      expect(subagentTool.description).toContain("子代理");
      expect(subagentTool.permission).toBe("subagent");
    });
  });
});

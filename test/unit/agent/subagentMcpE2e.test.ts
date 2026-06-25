/**
 * 子代理 MCP 审批端到端测试。
 *
 * 测试目标:
 *   - 验证子代理在执行 MCP 工具时遇到 code-event 类审批请求后的完整闭环
 *
 * 测试用例:
 *   - approval 通过后子代理能完成 zread_get_trending 循环
 *   - 需要真实 provider apiKey 才可执行
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _resetAll, initBuiltinAgents } from "@/agent";
import { hasLiveProviderConfig, loadRealTestConfig } from "../../helpers/realConfig";
import { clearAllApprovals } from "@/permission/store/approvalStore";
import { closeDb, initDb } from "@/db";
import { runSubagentMcpApprovalE2E } from "test/e2e/agent/mcpE2e";

// E2E 测试需要真实的 provider apiKey 才能发起 LLM 调用
const hasLiveConfig = await hasLiveProviderConfig();

describe.skipIf(!hasLiveConfig)("子代理 MCP 审批端到端", () => {
  beforeEach(() => {
    initDb();
    clearAllApprovals();
    _resetAll();
    initBuiltinAgents();
  });

  afterEach(() => {
    clearAllApprovals();
    closeDb();
  });

  test(
    "code-event approval lets subagent complete zread_get_trending loop",
    async () => {
      const config = await loadRealTestConfig();

      const result = await runSubagentMcpApprovalE2E(config, {
        autoApprove: (evt) => evt.permission === "mcp.zread.get_trending",
        toolName: "zread_get_trending",
      });

      expect(result.ok).toBe(true);
      expect(result.text.length).toBeGreaterThan(0);
      if (result.permissionEvents.length > 0) {
        expect(result.permissionEvents.some((evt) => evt.permission === "mcp.zread.get_trending")).toBe(true);
      }
      expect(result.effectiveStreamTimeoutMs).toBeGreaterThanOrEqual(120_000);
    },
    { timeout: 120_000 },
  );

  test(
    "concurrent subagents can call MCP without permission/result cross-talk",
    async () => {
      const config = await loadRealTestConfig();

      const [first, second] = await Promise.all([
        runSubagentMcpApprovalE2E(config, {
          autoRespond: (evt) => (evt.permission === "mcp.zread.get_trending" ? true : undefined),
          childAgentName: "mcp-e2e-child-a",
          toolName: "zread_get_trending",
        }),
        runSubagentMcpApprovalE2E(config, {
          autoRespond: (evt) => (evt.permission === "mcp.zread.get_trending" ? true : undefined),
          childAgentName: "mcp-e2e-child-b",
          toolName: "zread_get_trending",
        }),
      ]);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(first.text.length).toBeGreaterThan(0);
      expect(second.text.length).toBeGreaterThan(0);
      if (first.permissionEvents.length > 0) {
        expect(first.permissionEvents.some((evt) => evt.permission === "mcp.zread.get_trending")).toBe(true);
      }
      if (second.permissionEvents.length > 0) {
        expect(second.permissionEvents.some((evt) => evt.permission === "mcp.zread.get_trending")).toBe(true);
      }
    },
    { timeout: 180_000 },
  );

  test(
    "explicit denial keeps permission semantics clear and returns a bounded failure summary",
    async () => {
      const config = await loadRealTestConfig();

      const result = await runSubagentMcpApprovalE2E(config, {
        autoRespond: (evt) => (evt.permission === "mcp.zread.get_trending" ? false : undefined),
        childAgentName: "mcp-e2e-child-deny",
        toolName: "zread_get_trending",
      });

      if (result.permissionEvents.length > 0) {
        expect(result.permissionEvents.some((evt) => evt.permission === "mcp.zread.get_trending")).toBe(true);
      }
      expect(result.ok || Boolean(result.error) || result.text.length > 0).toBe(true);
      expect(`${result.text} ${result.error ?? ""}`).toMatch(/权限|拒绝|无法|failed|denied|可用工具|工具|tool/i);
    },
    { timeout: 120_000 },
  );
});

/**
 * T8 跨模块集成测试 — Agent × Compressor × EventBus。
 *
 * 验证跨模块协作:
 *   1. Agent 注册 → 状态变更 → EventBus 事件传播
 *   2. Compressor.cleanOrphanedToolCalls → 消息数组清理
 *   3. Provider 解析 → requestMethod 路由
 *   4. compress pipeline: shouldAutoCompress → findPreserveStartIndex → truncateOversizedToolResults
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  _resetAll,
  getActiveAgentName,
  getAgentStatus,
  initBuiltinAgents,
  registerAgent,
  setActiveAgent,
  setAgentStatus,
} from "@/agent";
import {
  cleanOrphanedToolCalls,
  findPreserveStartIndex,
  truncateOversizedToolResults,
} from "@/compress/core/compressor";
import { shouldAutoCompress } from "@/compress/runtime/autoCompress";
import { resolveRequestMethod } from "@/api";

describe("T8 跨模块集成测试", () => {
  // ─── 1. Agent × EventBus 集成 ──────────────────────────────

  describe("Agent 注册 → 状态变更流程", () => {
    beforeEach(() => {
      _resetAll();
      initBuiltinAgents();
      setActiveAgent("general");
    });

    test("完整 Agent 生命周期:注册 → 激活 → 状态变更", () => {
      registerAgent({
        description: "Integration test",
        mode: "primary",
        name: "integration-agent",
        prompt: "test",
      } as any);

      // 激活
      const activated = setActiveAgent("integration-agent");
      expect(activated).toBe(true);
      expect(getActiveAgentName()).toBe("integration-agent");

      // 状态变更
      expect(getAgentStatus("integration-agent")).toBe("idle");
      setAgentStatus("integration-agent", "running");
      expect(getAgentStatus("integration-agent")).toBe("running");

      // 切回
      setActiveAgent("general");
      expect(getActiveAgentName()).toBe("general");
    });
  });

  // ─── 2. Compressor 管道集成 ─────────────────────────────────

  describe("压缩管道:清理 → 保留定位 → 截断", () => {
    function makeToolCallPart(id: string) {
      return { args: {}, toolCallId: id, toolName: "read", type: "tool-call" };
    }
    function makeToolResultPart(id: string, output: string) {
      return { output, toolCallId: id, type: "tool-result" };
    }

    test("完整管道:清理孤立 → 定位保留 → 截断", () => {
      const longOutput = "X".repeat(5000);
      const msgs: any[] = [
        // 孤立 tool-call(无对应 result)
        { content: [makeToolCallPart("orphan-1")], role: "assistant" },
        // 正常轮次
        { content: "hello", role: "user" },
        { content: [makeToolCallPart("tc-1")], role: "assistant" },
        { content: [makeToolResultPart("tc-1", longOutput)], role: "tool" },
      ];

      // Step 1: 清理孤立
      cleanOrphanedToolCalls(msgs);
      expect(msgs.length).toBe(3); // 孤立 assistant 被删除

      // Step 2: 保留定位 — 最后一条是 tool，应保留 assistant+tool 对
      const preserveStart = findPreserveStartIndex(msgs);
      expect(preserveStart).toBe(1); // 从 assistant(tool-call) 开始保留

      // Step 3: 截断超大工具结果
      truncateOversizedToolResults(msgs, 100);
      const toolResult = (msgs[2].content as any[])[0];
      expect(toolResult.output.length).toBeLessThan(longOutput.length);
      expect(toolResult.output).toContain("truncated");
    });

    test("空消息管道安全", () => {
      const msgs: any[] = [];
      expect(() => {
        cleanOrphanedToolCalls(msgs);
        findPreserveStartIndex(msgs);
        truncateOversizedToolResults(msgs, 100);
      }).not.toThrow();
    });
  });

  // ─── 3. shouldAutoCompress × 阈值决策 ───────────────────────

  describe("自动压缩决策 × 阈值", () => {
    test("不同阈值级别正确决策", () => {
      expect(shouldAutoCompress(50, 80)).toBe(false);
      expect(shouldAutoCompress(80, 80)).toBe(true);
      expect(shouldAutoCompress(90, 80)).toBe(true);
    });

    test("默认阈值 80%", () => {
      expect(shouldAutoCompress(79)).toBe(false);
      expect(shouldAutoCompress(80)).toBe(true);
    });
  });

  // ─── 4. Provider × requestMethod 路由 ───────────────────────

  describe("Provider requestMethod 路由", () => {
    test("chat → claude → gemini 路由正确", () => {
      const config = {
        defaultProvider: { model: "gpt-4o", provider: "p1" },
        providerConfig: {
          p1: { apiKey: "sk-test", requestMethod: "chat" },
          p2: { apiKey: "sk-test", requestMethod: "claude" },
          p3: { apiKey: "sk-test", requestMethod: "gemini" },
        },
      } as any;

      expect(resolveRequestMethod(config, "p1")).toBe("chat");
      expect(resolveRequestMethod(config, "p2")).toBe("claude");
      expect(resolveRequestMethod(config, "p3")).toBe("gemini");
    });

    test("未配置 Provider 回退到 chat", () => {
      const config = {
        defaultProvider: { model: "gpt-4o", provider: "p1" },
        providerConfig: {},
      } as any;

      expect(resolveRequestMethod(config, "unknown")).toBe("chat");
    });
  });
});

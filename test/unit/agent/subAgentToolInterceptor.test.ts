// @ts-nocheck
/**
 * 子代理工具拦截器测试。
 *
 * 覆盖导出:
 *   - interceptSendMessage
 *   - interceptQueryStatus
 *   - interceptSpawnSubAgent
 *   - interceptAskUser
 *   - interceptBuiltinTools
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type InterceptedToolCall,
  type InterceptorContext,
  interceptAskUser,
  interceptBuiltinTools,
  interceptQueryStatus,
  interceptSendMessage,
  interceptSpawnSubAgent,
} from "@/agent/subagent/toolInterceptor";
import { subAgentTracker } from "@/agent/subagent/tracker";
import { _resetAll as resetAgentManager } from "@/agent/core/manager";

// Helper: 构造 tool call
function tc(toolName: string, args: Record<string, unknown> = {}, id?: string): InterceptedToolCall {
  return {
    args,
    toolCallId: id ?? `tc_${toolName}_${Date.now()}`,
    toolName,
  };
}

// Helper: 构造上下文
function makeCtx(overrides?: Partial<InterceptorContext>): InterceptorContext {
  return {
    agentId: "general",
    agentName: "General Agent",
    instanceId: "inst-test",
    spawnDepth: 0,
    spawnedChildInstanceIds: new Set(),
    ...overrides,
  };
}

describe("子代理工具拦截器", () => {
  beforeEach(() => {
    // 清理 tracker 中所有注册的实例
    for (const inst of subAgentTracker.listRunning()) {
      subAgentTracker.unregister(inst.instanceId);
    }
  });

  // ─── interceptSendMessage ───────────────────────────────

  describe("interceptSendMessage", () => {
    test("无 send_message_to_agent 调用时原样返回", () => {
      const calls = [tc("bash", { command: "ls" })];
      const result = interceptSendMessage(makeCtx(), calls);
      expect(result.handled).toHaveLength(0);
      expect(result.remaining).toHaveLength(1);
    });

    test("无 instanceId 时原样返回", () => {
      const calls = [tc("send_message_to_agent", { message: "hi" })];
      const result = interceptSendMessage(makeCtx({ instanceId: undefined }), calls);
      expect(result.handled).toHaveLength(0);
      expect(result.remaining).toHaveLength(1);
    });

    test("空消息返回错误", () => {
      const result = interceptSendMessage(makeCtx(), [tc("send_message_to_agent", { message: "" })]);
      expect(result.handled).toHaveLength(1);
      expect(result.results[0].output).toMatchObject({
        result: expect.stringContaining("empty"),
        success: false,
      });
    });

    test("无 target 参数返回错误", () => {
      const result = interceptSendMessage(makeCtx(), [tc("send_message_to_agent", { message: "hello" })]);
      expect(result.results[0].output).toMatchObject({
        result: expect.stringContaining("must be provided"),
        success: false,
      });
    });

    test("向不存在的 targetInstanceId 发送失败", () => {
      const result = interceptSendMessage(makeCtx(), [
        tc("send_message_to_agent", {
          message: "hello",
          target_instance_id: "non-existent",
        }),
      ]);
      expect(result.results[0].output).toMatchObject({
        success: false,
      });
    });

    test("向不存在的 targetAgentId 发送失败", () => {
      const result = interceptSendMessage(makeCtx(), [
        tc("send_message_to_agent", {
          message: "hello",
          target_agent_id: "ghost-agent",
        }),
      ]);
      expect(result.results[0].output).toMatchObject({
        result: expect.stringContaining("No running agent"),
        success: false,
      });
    });

    test("向自己发送消息返回错误", () => {
      subAgentTracker.register({
        abortController: new AbortController(),
        agentId: "general",
        agentName: "General Agent",
        instanceId: "inst-test",
        prompt: "test",
      });

      const result = interceptSendMessage(makeCtx(), [
        tc("send_message_to_agent", {
          message: "hello",
          target_agent_id: "general",
        }),
      ]);

      expect(result.results[0].output).toMatchObject({
        result: expect.stringContaining("yourself"),
        success: false,
      });

      subAgentTracker.unregister("inst-test");
    });

    test("handled 的调用从 remaining 中移除", () => {
      const calls = [
        tc("send_message_to_agent", { message: "hello", target_agent_id: "other" }),
        tc("bash", { command: "ls" }),
      ];
      const result = interceptSendMessage(makeCtx(), calls);
      expect(result.remaining).toHaveLength(1);
      expect(result.remaining[0].toolName).toBe("bash");
    });
  });

  // ─── interceptQueryStatus ───────────────────────────────

  describe("interceptQueryStatus", () => {
    test("无 query_agents_status 调用时原样返回", () => {
      const calls = [tc("bash")];
      const result = interceptQueryStatus(makeCtx(), calls);
      expect(result.handled).toHaveLength(0);
      expect(result.remaining).toHaveLength(1);
    });

    test("返回运行中 agent 列表(空)", () => {
      const result = interceptQueryStatus(makeCtx(), [tc("query_agents_status")]);
      expect(result.handled).toHaveLength(1);
      expect(result.results[0].output.totalRunning).toBe(0);
      expect(result.results[0].output.agents).toEqual([]);
    });

    test("返回运行中 agent 列表(有数据)", () => {
      subAgentTracker.register({
        abortController: new AbortController(),
        agentId: "review",
        agentName: "Review Agent",
        instanceId: "inst-review",
        prompt: "review code",
      });

      const result = interceptQueryStatus(makeCtx(), [tc("query_agents_status")]);

      expect(result.results[0].output.totalRunning).toBe(1);
      expect(result.results[0].output.agents[0].agentId).toBe("review");
      expect(result.results[0].output.agents[0].isSelf).toBe(false);

      subAgentTracker.unregister("inst-review");
    });

    test("标记自身 isSelf", () => {
      subAgentTracker.register({
        abortController: new AbortController(),
        agentId: "general",
        agentName: "General Agent",
        instanceId: "inst-test",
        prompt: "test",
      });

      const result = interceptQueryStatus(makeCtx(), [tc("query_agents_status")]);

      const self = result.results[0].output.agents.find((a: any) => a.instanceId === "inst-test");
      expect(self.isSelf).toBe(true);

      subAgentTracker.unregister("inst-test");
    });
  });

  // ─── interceptSpawnSubAgent ─────────────────────────────

  describe("interceptSpawnSubAgent", () => {
    test("无 spawn 调用时原样返回", () => {
      const calls = [tc("bash")];
      const result = interceptSpawnSubAgent(makeCtx(), calls);
      expect(result.handled).toHaveLength(0);
    });

    test("无 instanceId 时原样返回", () => {
      const result = interceptSpawnSubAgent(makeCtx({ instanceId: undefined }), [
        tc("spawn_sub_agent", { agent_id: "review", prompt: "test" }),
      ]);
      expect(result.handled).toHaveLength(0);
    });

    test("缺少 agent_id 和 prompt 返回错误", () => {
      const result = interceptSpawnSubAgent(makeCtx(), [tc("spawn_sub_agent", {})]);
      expect(result.results[0].output.success).toBe(false);
      expect(result.results[0].output.error).toContain("required");
    });

    test("self-spawn 被拒绝", () => {
      const result = interceptSpawnSubAgent(makeCtx({ agentId: "general", agentName: "General Agent" }), [
        tc("spawn_sub_agent", { agent_id: "general", prompt: "do work" }),
      ]);
      expect(result.results[0].output.success).toBe(false);
      expect(result.results[0].output.error).toContain("SAME type");
    });

    test("成功 spawn 不同类型的 agent", () => {
      const executor = mock(() => Promise.resolve({ result: "done", success: true }));
      const ctx = makeCtx({ spawnExecutor: executor });
      const result = interceptSpawnSubAgent(ctx, [
        tc("spawn_sub_agent", { agent_id: "review", prompt: "review code" }),
      ]);
      expect(result.results[0].output.success).toBe(true);
      expect(result.results[0].output.result).toContain("spawned");
      expect(ctx.spawnedChildInstanceIds.size).toBe(1);
    });

    test("spawn 的子代理注册到 tracker", () => {
      const executor = mock(() => Promise.resolve({ result: "done", success: true }));
      interceptSpawnSubAgent(makeCtx({ spawnExecutor: executor }), [
        tc("spawn_sub_agent", { agent_id: "review", prompt: "review" }),
      ]);

      const running = subAgentTracker.listRunning();
      expect(running.length).toBeGreaterThanOrEqual(1);
      expect(running.some((a) => a.agentId === "review")).toBe(true);
    });

    test("有 spawnExecutor 时异步调用", async () => {
      const executor = mock(() => Promise.resolve({ result: "done", success: true }));
      interceptSpawnSubAgent(makeCtx({ spawnExecutor: executor }), [
        tc("spawn_sub_agent", { agent_id: "review", prompt: "review" }),
      ]);

      // SpawnExecutor 是异步的，等待一小段时间
      await new Promise((r) => setTimeout(r, 100));
      expect(executor).toHaveBeenCalled();
    });
  });

  // ─── interceptAskUser ───────────────────────────────────

  describe("interceptAskUser", () => {
    test("无 askuser 调用时原样返回", async () => {
      const result = await interceptAskUser(makeCtx(), [tc("bash")]);
      expect(result.handled).toHaveLength(0);
    });

    test("无 askUserCallback 时原样返回", async () => {
      const result = await interceptAskUser(makeCtx({ askUserCallback: undefined }), [
        tc("askuser-choice", { question: "ok?" }),
      ]);
      expect(result.handled).toHaveLength(0);
    });

    test("正常调用返回用户选择", async () => {
      const callback = mock(() => Promise.resolve({ customInput: undefined, selected: "Yes" }));
      const result = await interceptAskUser(makeCtx({ askUserCallback: callback }), [
        tc("askuser-choice", { options: ["Yes", "No"], question: "Continue?" }),
      ]);
      expect(result.handled).toHaveLength(1);
      expect(result.results[0].output.answer).toBe("Yes");
      expect(result.results[0].isError).toBe(false);
    });

    test("多选返回逗号分隔", async () => {
      const callback = mock(() => Promise.resolve({ customInput: undefined, selected: ["A", "B"] }));
      const result = await interceptAskUser(makeCtx({ askUserCallback: callback }), [
        tc("askuser-multi", { multiSelect: true, options: ["A", "B", "C"], question: "Pick" }),
      ]);
      expect(result.results[0].output.answer).toBe("A, B");
    });

    test("自定义输入附加到选择后", async () => {
      const callback = mock(() => Promise.resolve({ customInput: "custom value", selected: "Other" }));
      const result = await interceptAskUser(makeCtx({ askUserCallback: callback }), [
        tc("askuser-choice", { question: "Pick" }),
      ]);
      expect(result.results[0].output.answer).toContain("custom value");
    });

    test("callback 抛出错误时返回 isError=true", async () => {
      const callback = mock(() => Promise.reject(new Error("user cancelled")));
      const result = await interceptAskUser(makeCtx({ askUserCallback: callback }), [
        tc("askuser-choice", { question: "?" }),
      ]);
      expect(result.results[0].isError).toBe(true);
      expect(result.results[0].output.error).toContain("cancelled");
    });
  });

  // ─── interceptBuiltinTools(统一入口) ──────────────────

  describe("interceptBuiltinTools", () => {
    test("所有非内置工具返回到 remaining", async () => {
      const calls = [tc("bash"), tc("fs_read")];
      const result = await interceptBuiltinTools(makeCtx(), calls);
      expect(result.remaining).toHaveLength(2);
      expect(result.results).toHaveLength(0);
    });

    test("混合调用正确分发", async () => {
      const calls = [
        tc("send_message_to_agent", { message: "hello", target_agent_id: "x" }),
        tc("query_agents_status"),
        tc("bash", { command: "ls" }),
      ];
      const result = await interceptBuiltinTools(makeCtx(), calls);
      expect(result.results.length).toBeGreaterThanOrEqual(2);
      expect(result.remaining).toHaveLength(1);
      expect(result.remaining[0].toolName).toBe("bash");
    });

    test("空调用列表返回空结果", async () => {
      const result = await interceptBuiltinTools(makeCtx(), []);
      expect(result.results).toHaveLength(0);
      expect(result.remaining).toHaveLength(0);
    });
  });
});

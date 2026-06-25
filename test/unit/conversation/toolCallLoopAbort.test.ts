/**
 * 工具调用中止处理测试
 *
 * 覆盖 toolCallLoop.ts 中中止信号处理逻辑:
 *   1. 正常执行流程
 *   2. 中止信号触发后为剩余工具生成中止结果
 *   3. 多工具中部分工具完成时中止
 *   4. 权限拒绝流程
 */

import { describe, expect, it } from "bun:test";
import {
  type ToolCallExecutionResult,
  type ToolCallRequest,
  type ToolExecutor,
  executeToolCallRound,
} from "@/conversation/core/toolCallLoop";

/**
 * 创建模拟的工具调用请求
 */
function createToolCall(index: number): ToolCallRequest {
  return {
    args: `{}`,
    toolCallId: `call_${index}`,
    toolName: `tool_${index}`,
  };
}

/**
 * 创建模拟执行器
 */
function createMockExecutor(output: unknown = "ok", isError = false): ToolExecutor {
  return {
    execute: async (_tc: ToolCallRequest) => ({
      isError,
      output,
      toolCallId: _tc.toolCallId,
      toolName: _tc.toolName,
    }),
  };
}

describe("executeToolCallRound", () => {
  it("无工具调用时返回空结果", async () => {
    const result = await executeToolCallRound({
      executor: createMockExecutor(),
      toolCalls: [],
    });
    expect(result.results).toEqual([]);
    expect(result.aborted).toBe(false);
  });

  it("单工具正常执行返回正确结果", async () => {
    const toolCall = createToolCall(0);
    const result = await executeToolCallRound({
      autoApprove: true,
      executor: createMockExecutor("文件内容"),
      toolCalls: [toolCall],
    });

    expect(result.aborted).toBe(false);
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.toolCallId).toBe("call_0");
    expect(result.results[0]!.toolName).toBe("tool_0");
    expect(result.results[0]!.isError).toBe(false);
    expect(result.results[0]!.output).toBe("文件内容");
  });

  it("单工具执行失败时返回 isError=true", async () => {
    const toolCall = createToolCall(0);
    const result = await executeToolCallRound({
      autoApprove: true,
      executor: createMockExecutor("文件不存在", true),
      toolCalls: [toolCall],
    });

    expect(result.aborted).toBe(false);
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.isError).toBe(true);
    expect(result.results[0]!.output).toBe("文件不存在");
  });

  it("多工具串行执行全部完成", async () => {
    const toolCalls = [createToolCall(0), createToolCall(1), createToolCall(2)];
    const callOrder: string[] = [];

    const executor: ToolExecutor = {
      execute: async (tc) => {
        callOrder.push(tc.toolCallId);
        return { isError: false, output: `result_${tc.toolCallId}`, toolCallId: tc.toolCallId, toolName: tc.toolName };
      },
    };

    const result = await executeToolCallRound({
      autoApprove: true,
      executor,
      toolCalls,
    });

    expect(result.aborted).toBe(false);
    expect(result.results.length).toBe(3);
    expect(callOrder).toEqual(["call_0", "call_1", "call_2"]);
    expect(result.results.map((r) => r.toolCallId)).toEqual(["call_0", "call_1", "call_2"]);
  });

  it("已中止的信号在执行前触发时全部生成中止结果", async () => {
    const toolCalls = [createToolCall(0), createToolCall(1)];
    const abortController = new AbortController();
    abortController.abort(); // 立即中止

    const result = await executeToolCallRound({
      abortSignal: abortController.signal,
      autoApprove: true,
      executor: createMockExecutor(),
      toolCalls,
    });

    expect(result.aborted).toBe(true);
    expect(result.results.length).toBe(2);
    // 所有工具都收到中止结果
    for (const r of result.results) {
      expect(r.isError).toBe(true);
      expect(String(r.output)).toContain("中止");
    }
  });

  it("中止信号在第一个工具执行后触发时，后续工具生成中止结果", async () => {
    const toolCalls = [createToolCall(0), createToolCall(1), createToolCall(2)];
    const abortController = new AbortController();

    let callCount = 0;
    const executor: ToolExecutor = {
      execute: async (tc) => {
        callCount++;
        if (callCount === 1) {
          abortController.abort();
        }
        return { isError: false, output: "ok", toolCallId: tc.toolCallId, toolName: tc.toolName };
      },
    };

    const result = await executeToolCallRound({
      abortSignal: abortController.signal,
      autoApprove: true,
      executor,
      toolCalls,
    });

    expect(result.aborted).toBe(true);
    expect(result.results.length).toBe(3);
    // Call_0 正常完成
    expect(result.results[0]!.toolCallId).toBe("call_0");
    expect(result.results[0]!.isError).toBe(false);
    // Call_1 和 call_2 收到中止结果
    expect(result.results[1]!.isError).toBe(true);
    expect(result.results[1]!.toolCallId).toBe("call_1");
    expect(result.results[2]!.isError).toBe(true);
    expect(result.results[2]!.toolCallId).toBe("call_2");
  });

  it("onToolStart 回调在执行前触发", async () => {
    const toolCall = createToolCall(0);
    const startedCalls: { name: string; callId: string }[] = [];

    await executeToolCallRound({
      autoApprove: true,
      executor: createMockExecutor(),
      onToolStart: (name: string, callId: string) => {
        startedCalls.push({ callId, name });
      },
      toolCalls: [toolCall],
    });

    expect(startedCalls).toEqual([{ callId: "call_0", name: "tool_0" }]);
  });

  it("onToolComplete 回调在执行后触发", async () => {
    const toolCall = createToolCall(0);
    const completedIds: string[] = [];

    await executeToolCallRound({
      autoApprove: true,
      executor: createMockExecutor(),
      onToolComplete: (r: ToolCallExecutionResult) => {
        completedIds.push(r.toolCallId);
      },
      toolCalls: [toolCall],
    });

    expect(completedIds).toEqual(["call_0"]);
  });

  it("onToolRejected 在权限拒绝时触发", async () => {
    const toolCall = createToolCall(0);
    const rejectedCalls: { name: string; callId: string }[] = [];

    const result = await executeToolCallRound({
      autoApprove: false,
      executor: createMockExecutor(),
      onConfirm: async () => false,
      onToolRejected: (name: string, callId: string) => {
        rejectedCalls.push({ callId, name });
      },
      toolCalls: [toolCall],
    });

    expect(result.aborted).toBe(false);
    expect(result.results.length).toBe(1);
    expect(result.results[0]!.isError).toBe(true);
    expect(result.results[0]!.output).toBe("权限被拒绝");
    expect(rejectedCalls).toEqual([{ callId: "call_0", name: "tool_0" }]);
  });

  it("autoApprove=true 时跳过权限确认直接执行", async () => {
    const toolCall = createToolCall(0);
    let confirmCalled = false;

    await executeToolCallRound({
      autoApprove: true,
      executor: createMockExecutor(),
      onConfirm: async () => {
        confirmCalled = true;
        return true;
      },
      toolCalls: [toolCall],
    });

    expect(confirmCalled).toBe(false);
  });
});

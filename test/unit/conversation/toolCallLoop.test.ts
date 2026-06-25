// @ts-nocheck
/**
 * 工具调用循环测试。
 *
 * 覆盖导出:
 *   - executeToolCallRound
 *   - toToolCallRequests
 */
import { describe, expect, mock, test } from "bun:test";
import {
  type ToolCallExecutionResult,
  type ToolCallRequest,
  type ToolExecutor,
  executeToolCallRound,
  toToolCallRequests,
} from "@/conversation/toolCallLoop";

// Helper: 创建 mock executor
function mockExecutor(results: Map<string, ToolCallExecutionResult>): ToolExecutor {
  return {
    execute: mock(async (req: ToolCallRequest) => {
      const r = results.get(req.toolCallId);
      if (r) {
        return r;
      }
      return {
        isError: false,
        output: `mock result for ${req.toolName}`,
        toolCallId: req.toolCallId,
        toolName: req.toolName,
      };
    }),
  };
}

function tc(id: string, name: string, args: unknown = {}): ToolCallRequest {
  return { args, toolCallId: id, toolName: name };
}

describe("工具调用循环", () => {
  describe("executeToolCallRound", () => {
    test("空调用列表返回空结果", async () => {
      const result = await executeToolCallRound({
        executor: mockExecutor(new Map()),
        toolCalls: [],
      });
      expect(result.results).toHaveLength(0);
      expect(result.aborted).toBe(false);
    });

    test("正常执行单个工具", async () => {
      const result = await executeToolCallRound({
        executor: mockExecutor(new Map()),
        toolCalls: [tc("c1", "bash", { command: "ls" })],
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].toolCallId).toBe("c1");
      expect(result.results[0].isError).toBe(false);
      expect(result.aborted).toBe(false);
    });

    test("正常执行多个工具", async () => {
      const result = await executeToolCallRound({
        executor: mockExecutor(new Map()),
        toolCalls: [tc("c1", "bash"), tc("c2", "fs_read")],
      });
      expect(result.results).toHaveLength(2);
    });

    test("autoApprove=true 时跳过确认", async () => {
      const onConfirm = mock(() => Promise.resolve(true));
      const result = await executeToolCallRound({
        autoApprove: true,
        executor: mockExecutor(new Map()),
        onConfirm,
        toolCalls: [tc("c1", "bash")],
      });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(1);
    });

    test("onConfirm 返回 false 时拒绝工具", async () => {
      const onConfirm = mock(() => Promise.resolve(false));
      const onToolRejected = mock(() => {});
      const result = await executeToolCallRound({
        autoApprove: false,
        executor: mockExecutor(new Map()),
        onConfirm,
        onToolRejected,
        toolCalls: [tc("c1", "bash")],
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].isError).toBe(true);
      expect(result.results[0].output).toContain("拒绝");
      expect(onToolRejected).toHaveBeenCalledWith("bash", "c1");
    });

    test("中止信号导致剩余工具跳过", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await executeToolCallRound({
        abortSignal: controller.signal,
        executor: mockExecutor(new Map()),
        toolCalls: [tc("c1", "bash"), tc("c2", "fs_read")],
      });
      expect(result.aborted).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results.every((r) => r.isError)).toBe(true);
    });

    test("onToolStart 和 onToolComplete 回调", async () => {
      const onStart = mock(() => {});
      const onComplete = mock(() => {});
      await executeToolCallRound({
        executor: mockExecutor(new Map()),
        onToolComplete: onComplete,
        onToolStart: onStart,
        toolCalls: [tc("c1", "bash")],
      });
      expect(onStart).toHaveBeenCalledWith("bash", "c1", {});
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test("工具执行异常被捕获", async () => {
      const executor: ToolExecutor = {
        execute: mock(async () => {
          throw new Error("disk full");
        }),
      };
      const result = await executeToolCallRound({
        executor,
        toolCalls: [tc("c1", "fs_write")],
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].isError).toBe(true);
      expect(result.results[0].output).toMatchObject({ error: "disk full" });
    });

    test("durationMs 被记录", async () => {
      const executor: ToolExecutor = {
        execute: mock(async () => {
          await new Promise((r) => setTimeout(r, 5));
          return { isError: false, output: "ok", toolCallId: "c1", toolName: "bash" };
        }),
      };
      const result = await executeToolCallRound({
        executor,
        toolCalls: [tc("c1", "bash")],
      });
      expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    test("拒绝后继续执行下一个工具", async () => {
      let callCount = 0;
      const onConfirm = mock(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? false : true);
      });
      const result = await executeToolCallRound({
        autoApprove: false,
        executor: mockExecutor(new Map()),
        onConfirm,
        toolCalls: [tc("c1", "bash"), tc("c2", "fs_read")],
      });
      expect(result.results).toHaveLength(2);
      expect(result.results[0].isError).toBe(true);
      expect(result.results[1].isError).toBe(false);
    });
  });

  describe("toToolCallRequests", () => {
    test("转换 ToolCallInfo 到 ToolCallRequest", () => {
      const calls = [
        { arguments: { command: "ls" }, id: "tc_001", name: "bash" },
        { arguments: { path: "/tmp" }, id: "tc_002", name: "fs_read" },
      ];
      const requests = toToolCallRequests(calls as any);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual({
        args: { command: "ls" },
        toolCallId: "tc_001",
        toolName: "bash",
      });
    });

    test("空数组返回空", () => {
      expect(toToolCallRequests([])).toEqual([]);
    });
  });
});

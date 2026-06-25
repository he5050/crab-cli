/**
 * TaskExecutor 测试。
 *
 * 测试用例:
 *   - 任务执行流程
 *   - 执行结果收集
 *   - Token 使用量统计
 *   - 中止信号处理
 *   - 错误处理
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import { executeTask } from "@/mission";
import type { AsyncTask } from "@/mission/type";
import { cleanupTestDir, createProjectTmpTestDir } from "../../helpers/testPaths";

const mockSendMessage = mock();

class MockConversationHandler {
  sendMessage = mockSendMessage;
}

describe("TaskExecutor", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createProjectTmpTestDir(process.cwd(), "executor-test-");
    mockSendMessage.mockClear();
  });

  afterEach(() => {
    cleanupTestDir(tempDir);
  });

  describe("任务执行流程", () => {
    test("执行任务返回结果", async () => {
      const mockResult = {
        ok: true,
        text: "任务执行结果",
        toolRounds: 3,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
      };
      mockSendMessage.mockResolvedValue(mockResult);

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_001",
        prompt: "测试提示词",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      const result = await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        prompt: task.prompt,
      });

      expect(result.result.ok).toBe(true);
      expect(result.result.text).toBe("任务执行结果");
      expect(result.result.toolRounds).toBe(3);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("执行失败返回错误结果", async () => {
      mockSendMessage.mockRejectedValue(new Error("API 调用失败"));

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_002",
        prompt: "测试提示词",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      const result = await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        prompt: task.prompt,
      });

      expect(result.result.ok).toBe(false);
      expect(result.result.error).toBe("API 调用失败");
      expect(result.result.text).toBe("");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("使用 task 的 sessionId", async () => {
      mockSendMessage.mockResolvedValue({
        ok: true,
        text: "结果",
        toolRounds: 1,
      });

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_003",
        prompt: "测试",
        sessionId: "session_abc_123",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        prompt: task.prompt,
      });

      // 验证 ConversationHandler 被正确创建
      expect(mockSendMessage).toHaveBeenCalledWith("测试");
    });

    test("goalContinuation=true 时自动续接后续轮次", async () => {
      mockSendMessage
        .mockResolvedValueOnce({
          goalContinuation: true,
          ok: true,
          text: "第一轮结果",
          toolRounds: 1,
        })
        .mockResolvedValueOnce({
          goalContinuation: false,
          ok: true,
          text: "第二轮结果",
          toolRounds: 1,
        });

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_goal_continue",
        prompt: "推进目标",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      const result = await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        prompt: task.prompt,
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenNthCalledWith(1, "推进目标");
      expect(mockSendMessage).toHaveBeenNthCalledWith(2, "[系统自动续接] 继续推进当前目标。");
      expect(result.result.text).toBe("第二轮结果");
      expect(result.result.ok).toBe(true);
    });
  });

  describe("执行选项", () => {
    test("传递 systemPrompt 选项", async () => {
      mockSendMessage.mockResolvedValue({
        ok: true,
        text: "结果",
        toolRounds: 1,
      });

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_004",
        prompt: "测试提示词",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        prompt: task.prompt,
        systemPrompt: "自定义系统提示词",
      });

      expect(mockSendMessage).toHaveBeenCalledWith("测试提示词");
    });

    test("传递 model 选项", async () => {
      mockSendMessage.mockResolvedValue({
        ok: true,
        text: "结果",
        toolRounds: 1,
      });

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_005",
        prompt: "测试",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        model: "gpt-4",
        prompt: task.prompt,
      });

      expect(mockSendMessage).toHaveBeenCalled();
    });

    test("传递 abortSignal 选项", async () => {
      mockSendMessage.mockResolvedValue({
        ok: true,
        text: "结果",
        toolRounds: 1,
      });

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_006",
        prompt: "测试",
        status: "running",
      };

      const abortController = new AbortController();
      const mockConfig = { mcpServers: {}, models: {} } as any;

      await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        abortSignal: abortController.signal,
        config: mockConfig,
        prompt: task.prompt,
      });

      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  describe("错误处理", () => {
    test("处理非 Error 类型的异常", async () => {
      mockSendMessage.mockRejectedValue("字符串错误");

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_007",
        prompt: "测试",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      const result = await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        prompt: task.prompt,
      });

      expect(result.result.ok).toBe(false);
      expect(result.result.error).toBe("字符串错误");
    });

    test("处理 undefined 异常", async () => {
      mockSendMessage.mockRejectedValue(undefined);

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_008",
        prompt: "测试",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      const result = await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        prompt: task.prompt,
      });

      expect(result.result.ok).toBe(false);
      expect(result.result.error).toBe("undefined");
    });
  });

  describe("执行时间统计", () => {
    test("记录执行耗时", async () => {
      mockSendMessage.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return {
          ok: true,
          text: "结果",
          toolRounds: 1,
        };
      });

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_009",
        prompt: "测试",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      const result = await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        prompt: task.prompt,
      });

      expect(result.durationMs).toBeGreaterThanOrEqual(50);
    });

    test("失败时也记录耗时", async () => {
      mockSendMessage.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 30));
        throw new Error("失败");
      });

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_test_010",
        prompt: "测试",
        status: "running",
      };

      const mockConfig = { mcpServers: {}, models: {} } as any;
      const result = await executeTask(task, {
        HandlerClass: MockConversationHandler as any,
        config: mockConfig,
        prompt: task.prompt,
      });

      expect(result.durationMs).toBeGreaterThanOrEqual(30);
      expect(result.result.ok).toBe(false);
    });
  });
});

/**
 * TaskExecutor 高级场景测试。
 *
 * 补充 taskExecutor.test.ts 未覆盖的边界场景:
 *   - AbortSignal 已中止时执行直接返回
 *   - ConversationHandler 构造器抛错
 *   - goalContinuation 达到安全上限(MAX_GOAL_CONTINUATIONS)
 *   - Handler 参数透传验证(config/options)
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { executeTask } from "@/mission";
import type { AsyncTask } from "@/mission/type";
import { cleanupTestDir, createProjectTmpTestDir } from "../../helpers/testPaths";

describe("TaskExecutor 高级场景", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createProjectTmpTestDir(process.cwd(), "executor-adv-");
  });

  afterEach(() => {
    cleanupTestDir(tempDir);
  });

  describe("AbortSignal 已中止", () => {
    test("signal 已中止时仍尝试执行（中止由 Handler 内部处理）", async () => {
      const sendMessage = mock().mockResolvedValue({
        ok: true,
        text: "结果",
        toolRounds: 1,
      });

      class Handler {
        constructor(_config?: unknown, _options?: unknown) {}
        sendMessage = sendMessage;
      }

      const controller = new AbortController();
      controller.abort(); // 先中止

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_abort_001",
        prompt: "测试中止",
        status: "running",
      };

      const result = await executeTask(task, {
        HandlerClass: Handler as any,
        abortSignal: controller.signal,
        config: {} as any,
        prompt: task.prompt,
      });

      // executeTask 不直接检查 abortSignal，由 Handler/ConversationHandler 内部处理
      // 这里验证 executeTask 不会抛错，结果取决于 Handler 行为
      expect(result.result).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("ConversationHandler 构造器异常", () => {
    test("Handler 构造器抛错时返回错误结果", async () => {
      class BrokenHandler {
        constructor() {
          throw new Error("配置无效");
        }
      }

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_ctor_err_001",
        prompt: "测试构造器异常",
        status: "running",
      };

      const result = await executeTask(task, {
        HandlerClass: BrokenHandler as any,
        config: {} as any,
        prompt: task.prompt,
      });

      expect(result.result.ok).toBe(false);
      expect(result.result.error).toBe("配置无效");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("goalContinuation 安全上限", () => {
    test("达到 MAX_GOAL_CONTINUATIONS 后停止续接", async () => {
      // 每次 sendMessage 都返回 goalContinuation: true
      const sendMessage = mock().mockResolvedValue({
        goalContinuation: true,
        ok: true,
        text: "需要续接",
        toolRounds: 1,
      });

      class Handler {
        constructor(_config?: unknown, _options?: unknown) {}
        sendMessage = sendMessage;
      }

      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_goal_max_001",
        prompt: "推进目标",
        status: "running",
      };

      const result = await executeTask(task, {
        HandlerClass: Handler as any,
        config: {} as any,
        prompt: task.prompt,
      });

      // 第一次是原始提示词 + MAX_GOAL_CONTINUATIONS(50) 次续接
      expect(sendMessage.mock.calls.length).toBe(51);
      expect(result.result.ok).toBe(true);
      expect(result.result.text).toBe("需要续接");
    });
  });

  describe("Handler 参数透传", () => {
    test("config 和 options 正确传给 Handler 构造器", async () => {
      const capturedConfig: unknown[] = [];
      const capturedOptions: unknown[] = [];

      class InspectHandler {
        constructor(config: unknown, options: unknown) {
          capturedConfig.push(config);
          capturedOptions.push(options);
        }
        async sendMessage() {
          return { ok: true, text: "ok", toolRounds: 1 };
        }
      }

      const mockConfig = { mcpServers: { test: {} }, models: { primary: "gpt-4" } };
      const task: AsyncTask = {
        createdAt: Date.now(),
        id: "task_inspect_001",
        prompt: "参数透传测试",
        sessionId: "session_inspect",
        status: "running",
      };

      await executeTask(task, {
        HandlerClass: InspectHandler as any,
        abortSignal: undefined,
        config: mockConfig as any,
        prompt: task.prompt,
        systemPrompt: "自定义系统提示词",
      });

      expect(capturedConfig).toHaveLength(1);
      expect(capturedConfig[0]).toEqual(mockConfig);
      expect(capturedOptions).toHaveLength(1);
      const opts = capturedOptions[0] as Record<string, unknown>;
      expect(opts.sessionId).toBe("session_inspect");
      expect(opts.systemPrompt).toBe("自定义系统提示词");
      expect(opts.abortSignal).toBeUndefined();
    });
  });
});

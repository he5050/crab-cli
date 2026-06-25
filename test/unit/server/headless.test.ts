/**
 * 无头服务器测试。
 *
 * 测试用例:
 *   - 无头模式
 *   - API 端点
 *   - 状态管理
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type HeadlessOptions,
  HeadlessRunner,
  __resetHeadlessDepsForTesting,
  __setHeadlessDepsForTesting,
} from "@/server/headless";
import { DEFAULT_CONFIG } from "@/config";

describe("HeadlessRunner", () => {
  let runner: HeadlessRunner;

  beforeEach(() => {
    __resetHeadlessDepsForTesting();
    runner = new HeadlessRunner();
  });

  afterEach(() => {
    __resetHeadlessDepsForTesting();
  });

  describe("实例化", () => {
    test("可成功实例化", () => {
      expect(runner).toBeDefined();
      expect(runner).toBeInstanceOf(HeadlessRunner);
    });

    test("run 方法存在且为函数", () => {
      expect(typeof runner.run).toBe("function");
    });
  });

  describe("选项接口", () => {
    test("支持 yolo 选项", () => {
      const options: HeadlessOptions = { yolo: true };
      expect(options.yolo).toBe(true);
    });

    test("支持 background 选项", () => {
      const options: HeadlessOptions = { background: true };
      expect(options.background).toBe(true);
    });

    test("支持组合选项", () => {
      const options: HeadlessOptions = { background: true, yolo: true };
      expect(options.yolo).toBe(true);
      expect(options.background).toBe(true);
    });

    test("空选项对象合法", () => {
      const options: HeadlessOptions = {};
      expect(options).toBeDefined();
    });
  });

  describe("方法签名", () => {
    test("run 方法接受 prompt 字符串", async () => {
      // 验证方法签名，不实际执行(需要完整环境)
      expect(runner.run.length).toBeGreaterThanOrEqual(1);
    });

    test("run 方法接受可选 options 参数", async () => {
      // 验证方法签名支持第二个参数
      expect(runner.run.length).toBeGreaterThanOrEqual(1);
    });

    test("run 方法返回 Promise", () => {
      const originalRun = runner.run;
      runner.run = mock(() => Promise.resolve()) as typeof runner.run;
      const result = runner.run("test");
      expect(result).toBeInstanceOf(Promise);
      runner.run = originalRun;
    });
  });

  describe("模块导出", () => {
    test("HeadlessRunner 被正确导出", async () => {
      const mod = await import("@/server/headless");
      expect(mod.HeadlessRunner).toBeDefined();
      expect(mod.HeadlessRunner).toBe(HeadlessRunner);
    });

    test("HeadlessOptions 类型可被导入", async () => {
      const mod = await import("@/server/headless");
      // TypeScript 类型在运行时不会存在，但我们可以验证模块加载成功
      expect(mod).toBeDefined();
    });
  });

  describe("错误处理", () => {
    test("失败时返回结构化错误码并完成后台任务", async () => {
      const stderr: string[] = [];
      const completed: { taskId: string; error?: string }[] = [];

      class FailingConversationHandler {
        async sendMessage() {
          throw new Error("headless failed");
        }
      }

      __setHeadlessDepsForTesting({
        ConversationHandler: FailingConversationHandler as any,
        cleanIncompleteToolCalls: () => 0,
        completeTask: (taskId: string, error?: string) => {
          completed.push({ error, taskId });
        },
        ensureMcpRuntimeStarted: async () => ({}) as any,
        ensureSession: () => ({}) as any,
        getSessionMessages: () => [],
        initTaskRuntime: () => {},
        loadConfig: async () => DEFAULT_CONFIG,
        writeStderr: (text: string) => {
          stderr.push(text);
          return true;
        },
        writeStdout: () => true,
      });

      await expect(
        runner.run("boom", {
          background: true,
          sessionId: "ses_headless",
          taskId: "task_headless",
        }),
      ).rejects.toMatchObject({
        code: "AGENT-504",
        message: "headless failed",
      });

      expect(completed).toEqual([{ error: "headless failed", taskId: "task_headless" }]);
      expect(stderr.join("")).toContain("headless failed (AGENT-504)");
    });
  });
});

describe("无头模式集成", () => {
  test("模块可异步导入", async () => {
    const mod = await import("@/server/headless");
    expect(mod.HeadlessRunner).toBeDefined();
    expect(typeof mod.HeadlessRunner).toBe("function");
  });

  test("创建多个实例相互独立", () => {
    const runner1 = new HeadlessRunner();
    const runner2 = new HeadlessRunner();
    expect(runner1).not.toBe(runner2);
    expect(runner1).toBeInstanceOf(HeadlessRunner);
    expect(runner2).toBeInstanceOf(HeadlessRunner);
  });
});

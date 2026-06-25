/**
 * 停止处理 Hook 测试。
 *
 * 覆盖导出:
 *   - handleStopHook
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { handleStopHook } from "@/conversation/lifecycle/stopHandler";

describe("停止处理 Hook", () => {
  describe("handleStopHook", () => {
    test("无 sessionId 时直接返回 shouldContinue=false", async () => {
      const result = await handleStopHook(undefined);
      expect(result.shouldContinue).toBe(false);
      expect(result.injectedMessages).toBeUndefined();
    });

    test("空字符串 sessionId 直接返回", async () => {
      const result = await handleStopHook("");
      expect(result.shouldContinue).toBe(false);
    });

    test("正常 sessionId 返回结构正确", async () => {
      const result = await handleStopHook("ses_abc123");
      // HookExecutor.stop 可能没有注册 hook，但函数不应抛异常
      expect(result).toBeDefined();
      expect(typeof result.shouldContinue).toBe("boolean");
    });
  });
});

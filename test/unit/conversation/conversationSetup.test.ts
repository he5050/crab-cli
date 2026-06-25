// @ts-nocheck
/**
 * 对话准备测试。
 *
 * 覆盖导出:
 *   - prepareConversation
 */
import { describe, expect, test } from "bun:test";
import { prepareConversation } from "@/conversation/conversationSetup";
import type { ModelMessage } from "ai";

describe("对话准备", () => {
  describe("prepareConversation", () => {
    test("空消息列表返回 ok=true", async () => {
      const result = await prepareConversation([]);
      expect(result.ok).toBe(true);
      expect(result.availableTools).toBeDefined();
      expect(Array.isArray(result.availableTools)).toBe(true);
    });

    test("清理孤立 tool_calls", async () => {
      const messages: ModelMessage[] = [
        {
          content: "hello",
          role: "user",
        },
        {
          content: [
            { text: "let me check", type: "text" },
            { args: { command: "ls" }, toolCallId: "tc_orphan", toolName: "bash", type: "tool-call" },
          ],
          role: "assistant",
        },
      ];

      const result = await prepareConversation(messages);
      expect(result.ok).toBe(true);
      // 孤立 tool-call 应被清理
      const assistantMsg = messages[1];
      if (Array.isArray(assistantMsg.content)) {
        const hasToolCall = assistantMsg.content.some((p: any) => p.type === "tool-call");
        expect(hasToolCall).toBe(false);
      }
    });

    test("有对应 tool-result 的 tool-call 不被清理", async () => {
      const messages: ModelMessage[] = [
        {
          content: "run ls",
          role: "user",
        },
        {
          content: [{ args: { command: "ls" }, toolCallId: "tc_1", toolName: "bash", type: "tool-call" }],
          role: "assistant",
        },
        {
          content: [{ output: "file1.txt", toolCallId: "tc_1", type: "tool-result" }],
          role: "tool",
        },
      ];

      await prepareConversation(messages);
      const assistantMsg = messages[1];
      if (Array.isArray(assistantMsg.content)) {
        const hasToolCall = assistantMsg.content.some((p: any) => p.type === "tool-call");
        expect(hasToolCall).toBe(true);
      }
    });

    test("availableTools 包含已注册的工具", async () => {
      const result = await prepareConversation([]);
      expect(result.availableTools!.length).toBeGreaterThan(0);
    });
  });
});

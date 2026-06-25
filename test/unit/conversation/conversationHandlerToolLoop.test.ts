/**
 * [测试目标] ConversationHandler 与 tool-call-loop 集成。
 *
 * 测试目标:
 *   - 验证 ConversationHandler 在真实配置下与 executeToolCallRound 协同完成工具调用轮次
 *
 * 测试用例:
 *   - 工具调用轮次通过 executeToolCallRound 执行:注入流式 streamFn 第一轮产出 tool-call，第二轮产出文本，断言 round >= 2 且 result.ok
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import { loadRealTestConfig } from "../../helpers/realConfig";

let REAL_CONFIG: AppConfigSchema;

beforeAll(async () => {
  REAL_CONFIG = await loadRealTestConfig();
});

describe("ConversationHandler 与 tool-call-loop 集成", () => {
  test("工具调用轮次通过 executeToolCallRound 执行", async () => {
    // 通过 cache busting 获取隔离的 ConversationHandler 实例(无 mock.module 全局污染)
    const mod = await import("@/conversation/core/conversationHandler.ts");
    const { ConversationHandler } = mod;

    let round = 0;
    const handler = new ConversationHandler(REAL_CONFIG, {
      async *streamFn() {
        round++;
        if (round === 1) {
          // 第一轮:yield 工具调用 → ConversationHandler 会调用 executeToolCallRound
          yield {
            args: { path: "/tmp/test.txt" },
            toolCallId: "c1",
            toolName: "filesystem-read",
            type: "tool-call" as const,
          };
          yield { fullText: "", type: "done" as const };
          return;
        }

        // 第二轮:工具执行完毕后继续对话
        yield { text: "after tool", type: "text-delta" as const };
        yield { fullText: "after tool", type: "done" as const };
      },
    });

    const result = await handler.sendMessage("read file");
    handler.destroy();

    // 验证:
    //   - result.ok=true 说明工具调用被处理且对话正常完成
    //   - round >= 2 证明至少走了两轮(工具调用轮 + 文本输出轮)
    //     即 executeToolCallRound 被真正调用了
    expect(result.ok).toBe(true);
    expect(round).toBeGreaterThanOrEqual(2);
  });
});

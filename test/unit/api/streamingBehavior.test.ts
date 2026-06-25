/**
 * 流式行为测试。
 *
 * 测试用例:
 *   - 流式输出
 *   - 流中断处理
 *   - 流错误处理
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import { ConversationHandler } from "@/conversation";
import { createStreamFn } from "../../helpers/mockStream";
import { registerTestTool, resetTestTools } from "../../helpers/testTools";
import { loadRealTestConfig } from "../../helpers/realConfig";
import { installDbIsolation } from "../../helpers/dbIsolation";

let REAL_CONFIG: AppConfigSchema;
installDbIsolation("streaming-behavior-");

beforeAll(async () => {
  REAL_CONFIG = await loadRealTestConfig();
});

describe("流式行为 — 事件顺序验证", () => {
  test("text-delta 按顺序产出，done 包含完整文本", async () => {
    const deltas = ["你", "好", "，", "世", "界"];
    const streamFn = createStreamFn([
      [
        { text: deltas.join(""), type: "text" },
        { fullText: deltas.join(""), type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("hello");

    expect(result.ok).toBe(true);
    expect(result.text).toBe("你好，世界");
  });

  test("tool-call 在 text-delta 之后，done 在最后", async () => {
    const events: string[] = [];
    registerTestTool("fs_read", {
      execute: () => Promise.resolve({ content: "data" }),
      permission: "fs.read",
    });

    let callRound = 0;
    const streamFn = async function* streamFn() {
      callRound++;
      if (callRound === 1) {
        events.push("text-delta");
        yield { text: "让我读取文件。", type: "text-delta" as const };
        events.push("tool-call");
        yield { args: { path: "a.txt" }, toolCallId: "c1", toolName: "fs_read", type: "tool-call" as const };
        events.push("done");
        yield { fullText: "让我读取文件。", type: "done" as const };
        return;
      }
      events.push("text-delta");
      yield { text: "读取完成。", type: "text-delta" as const };
      events.push("done");
      yield { fullText: "读取完成。", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("fs_read").status).toBe("unique");

    const result = await handler.sendMessage("read file");
    expect(result.ok).toBe(true);
    expect(result.text).toBe("读取完成。");
    expect(events).toEqual(["text-delta", "tool-call", "done", "text-delta", "done"]);
  });

  test("error 事件返回失败结果，但保留已接收文本", async () => {
    const streamFn = async function* streamFn() {
      yield { text: "部分", type: "text-delta" as const };
      yield { error: new Error("连接中断"), type: "error" as const };
      yield { text: "继续", type: "text-delta" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("test");

    expect(result.ok).toBe(false);
    expect(result.text).toBe("部分");
    expect(result.error).toBe("连接中断");
  });

  test("大量 chunk 流式传输不丢数据", async () => {
    const chunkCount = 100;
    const chunks = Array.from({ length: chunkCount }, (_, i) => `chunk${i}_`);

    const streamFn = async function* streamFn() {
      for (const chunk of chunks) {
        yield { text: chunk, type: "text-delta" as const };
      }
      yield { fullText: chunks.join(""), type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("stress test");

    expect(result.ok).toBe(true);
    expect(result.text.length).toBe(chunks.join("").length);
  });

  test("空响应流(LLM 无内容)", async () => {
    const streamFn = createStreamFn([[{ fullText: "", type: "done" }]]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("empty");

    expect(result.ok).toBe(true);
    expect(result.text).toBe("");
  });
});

afterAll(() => resetTestTools());

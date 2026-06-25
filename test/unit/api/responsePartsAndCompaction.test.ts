/**
 * 响应部分和压缩测试。
 *
 * 测试用例:
 *   - responseParts 累积
 *   - compactionConfig 初始化
 *   - 多轮调用后重置
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import { createStreamFn } from "../../helpers/mockStream";
import { registerTestTool, resetTestTools } from "../../helpers/testTools";
import { loadRealTestConfig } from "../../helpers/realConfig";
import { installDbIsolation } from "../../helpers/dbIsolation";

let ConversationHandler: any;
let REAL_CONFIG: AppConfigSchema;
installDbIsolation("response-parts-compaction-");
beforeAll(async () => {
  mock.restore();
  REAL_CONFIG = await loadRealTestConfig();
  const mod = await import(`@/conversation/core/conversationHandler?case=${Date.now()}`);
  ({ ConversationHandler } = mod);
});

describe("ConversationHandler — responseParts string[] 累积", () => {
  test("纯文本回复正确累积(无 O(n²) 拼接)", async () => {
    const streamFn = createStreamFn([
      [
        { text: "第一段 ", type: "text" },
        { text: "第二段 ", type: "text" },
        { text: "第三段", type: "text" },
        { fullText: "第一段 第二段 第三段", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("测试消息");

    expect(result.ok).toBe(true);
    expect(result.text).toBe("第一段 第二段 第三段");

    const msgs = handler.getMessages();
    const asstMsg = msgs.find((m: any) => m.role === "assistant");
    expect(asstMsg).toBeDefined();
    expect(asstMsg!.content).toBe("第一段 第二段 第三段");

    handler.destroy();
  });

  test("工具调用轮次间 responseParts 正确重置", async () => {
    registerTestTool("fs_read", {
      execute: () => Promise.resolve("hello"),
      permission: "fs.read",
    });

    const streamFn = createStreamFn([
      [
        { text: "我来帮你查看 ", type: "text" },
        { args: { path: "a.txt" }, toolCallId: "c1", toolName: "fs_read", type: "tool-call" },
        { type: "done" },
      ],
      [
        { text: "文件内容是 hello", type: "text" },
        { fullText: "文件内容是 hello", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("fs.read", "**");
    expect(handler.enableExternalToolForSession("fs_read").status).toBe("unique");

    const result = await handler.sendMessage("读取 a.txt");

    expect(result.ok).toBe(true);
    expect(result.text).toBe("文件内容是 hello");
    expect(result.toolRounds).toBe(1);

    const msgs = handler.getMessages();
    const asstMsgs = msgs.filter((m: any) => m.role === "assistant");
    const firstAsst = asstMsgs[0] as any;
    expect(Array.isArray(firstAsst.content)).toBe(true);
    const textPart = firstAsst.content.find((p: any) => p.type === "text");
    expect(textPart.text).toBe("我来帮你查看 ");

    const secondAsst = asstMsgs[1] as any;
    expect(secondAsst.content).toBe("文件内容是 hello");

    handler.destroy();
  });

  test("error 事件后 responseParts 仍正确累积到失败结果", async () => {
    const streamFn = async function* streamFn() {
      yield { text: "部分回复 ", type: "text-delta" as const };
      yield { text: "继续", type: "text-delta" as const };
      yield { error: new Error("API 限流"), type: "error" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("测试");

    expect(result.ok).toBe(false);
    expect(result.text).toBe("部分回复 继续");
    expect(result.error).toBe("API 限流");

    handler.destroy();
  });
});

describe("ConversationHandler — compactionConfig 选项", () => {
  test("不传 compactionConfig 使用默认值", async () => {
    const streamFn = createStreamFn([
      [
        { text: "ok", type: "text" },
        { fullText: "ok", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("hi");
    expect(result.ok).toBe(true);

    handler.destroy();
  });

  test("自定义 compactionConfig 生效", async () => {
    const streamFn = createStreamFn([
      [
        { text: "ok", type: "text" },
        { fullText: "ok", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, {
      compactionConfig: {
        keepRecentTurns: 6,
        tokenThreshold: 50_000,
      },
      streamFn,
    });

    const result = await handler.sendMessage("hi");
    expect(result.ok).toBe(true);

    handler.destroy();
  });

  test("达到最大轮次时 responseParts 正确 join", async () => {
    registerTestTool("test_tool", {
      execute: () => Promise.resolve("ok"),
      permission: "test",
    });

    const streamFn = async function* streamFn() {
      let round = 0;
      round++;
      yield { args: {}, toolCallId: `c${round}`, toolName: "test_tool", type: "tool-call" as const };
      yield { fullText: "", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, {
      maxToolRounds: 2,
      streamFn,
    });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("test_tool").status).toBe("unique");

    const result = await handler.sendMessage("loop test");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("最大工具调用轮次");
    expect(result.toolRounds).toBe(2);

    handler.destroy();
  });
});

afterAll(() => {
  resetTestTools();
  mock.restore();
});

/**
 * Handler 边界情况测试。
 *
 * 测试用例:
 *   - abort 信号处理
 *   - 热更新
 *   - destroy 清理
 *   - 多工具调用
 *   - toToolResultOutput
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import { AppConfigSchema, type AppConfigSchema as AppConfigType } from "@/schema/config";
import { registerTestTool, resetTestTools } from "../../helpers/testTools";
import { buildDerivedProviderConfig, loadRealTestConfig } from "../../helpers/realConfig";
import { installDbIsolation } from "../../helpers/dbIsolation";

let ConversationHandler: any;
let globalBus: any;
let AppEvent: any;
let REAL_CONFIG: AppConfigType;
installDbIsolation("handler-edge-cases-");

beforeAll(async () => {
  mock.restore();
  REAL_CONFIG = await loadRealTestConfig();
  const chMod = await import(`@/conversation/core/conversationHandler?case=${Date.now()}`);
  ({ ConversationHandler } = chMod);
  const busMod = await import(`@/bus/core/eventBus?case=${Date.now()}`);
  ({ globalBus } = busMod);
  const evMod = await import(`@/bus/events/index?case=${Date.now()}`);
  ({ AppEvent } = evMod);
});

describe("ConversationHandler — abortSignal 中止", () => {
  test("已中止的 signal 直接返回 ok=false", async () => {
    const streamFn = async function* streamFn() {
      yield { text: "hi", type: "text-delta" as const };
    };

    const controller = new AbortController();
    controller.abort();

    const handler = new ConversationHandler(REAL_CONFIG, { abortSignal: controller.signal, streamFn });
    const result = await handler.sendMessage("test");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("中止");
  });
});

describe("ConversationHandler — ConfigUpdated 热更新", () => {
  test("发布 ConfigUpdated 事件后 handler 配置更新", async () => {
    const streamFn = async function* streamFn() {
      yield { text: "ok", type: "text-delta" as const };
      yield { fullText: "ok", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });

    const newConfig = await buildDerivedProviderConfig({
      model: "new-model",
      providerId: "new-provider",
      requestMethod: "claude",
    });

    globalBus.publish(AppEvent.ConfigUpdated, { config: newConfig });
    await new Promise((r) => setTimeout(r, 10));
    handler.destroy();
  });
});

describe("ConversationHandler — 销毁()", () => {
  test("destroy 后不再响应 ConfigUpdated 事件", async () => {
    const streamFn = async function* streamFn() {};

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.destroy();

    const newConfig = await buildDerivedProviderConfig({
      model: "y",
      providerId: "x",
      requestMethod: "chat",
    });
    globalBus.publish(AppEvent.ConfigUpdated, { config: newConfig });
  });
});

describe("ConversationHandler — 多工具同时调用", () => {
  test("LLM 一次返回多个 tool-call，全部执行并追加结果", async () => {
    const toolName = `multi_read_${Date.now()}`;
    const execCounts: Record<string, number> = {};
    registerTestTool(toolName, {
      execute: (args: any) => {
        execCounts[args.path] = (execCounts[args.path] || 0) + 1;
        return Promise.resolve({ content: `content of ${args.path}` });
      },
      parameters: z.object({ path: z.string() }),
      permission: "fs.read",
    });

    let callRound = 0;
    const streamFn = async function* streamFn() {
      callRound++;
      if (callRound === 1) {
        yield { args: { path: "a.txt" }, toolCallId: "c1", toolName, type: "tool-call" as const };
        yield { args: { path: "b.txt" }, toolCallId: "c2", toolName, type: "tool-call" as const };
        yield { fullText: "", type: "done" as const };
      } else {
        yield { text: "两个文件都读取完毕", type: "text-delta" as const };
        yield { fullText: "两个文件都读取完毕", type: "done" as const };
      }
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("fs.read", "**");
    expect(handler.enableExternalToolForSession(toolName).status).toBe("unique");

    const result = await handler.sendMessage("read a.txt and b.txt");

    expect(result.ok).toBe(true);
    expect(result.text).toBe("两个文件都读取完毕");
    expect(result.toolRounds).toBe(1);
    expect(execCounts["a.txt"]).toBe(1);
    expect(execCounts["b.txt"]).toBe(1);

    const msgs = handler.getMessages();
    const toolParts = msgs.filter((m: any) => m.role === "tool").flatMap((m: any) => m.content);
    expect(toolParts.length).toBe(2);
    expect(toolParts[0].toolCallId).toBe("c1");
    expect(toolParts[1].toolCallId).toBe("c2");
  });
});

describe("toToolResultOutput — 类型转换", () => {
  test("string → text 类型", async () => {
    registerTestTool("str_tool", {
      execute: () => Promise.resolve("string output"),
      permission: "test",
    });

    let round = 0;
    const streamFn = async function* streamFn() {
      round++;
      if (round === 1) {
        yield { args: {}, toolCallId: "c1", toolName: "str_tool", type: "tool-call" as const };
        yield { fullText: "", type: "done" as const };
      } else {
        yield { text: "ok", type: "text-delta" as const };
        yield { fullText: "ok", type: "done" as const };
      }
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("str_tool").status).toBe("unique");

    await handler.sendMessage("test");
    const msgs = handler.getMessages();
    const toolMsg = msgs.find((m: any) => m.role === "tool") as any;
    expect(toolMsg.content[0].output.type).toBe("text");
    expect(toolMsg.content[0].output.value).toBe("string output");

    handler.destroy();
  });

  test("object → text JSON 类型", async () => {
    registerTestTool("obj_tool", {
      execute: () => Promise.resolve({ count: 42, key: "value" }),
      permission: "test",
    });

    const streamFn = async function* streamFn() {
      yield { args: {}, toolCallId: "c1", toolName: "obj_tool", type: "tool-call" as const };
      yield { fullText: "", type: "done" as const };
      yield { text: "done", type: "text-delta" as const };
      yield { fullText: "done", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("obj_tool").status).toBe("unique");

    await handler.sendMessage("test");
    const msgs = handler.getMessages();
    const toolMsg = msgs.find((m: any) => m.role === "tool") as any;
    expect(toolMsg.content[0].output.type).toBe("text");
    expect(JSON.parse(toolMsg.content[0].output.value)).toEqual({ count: 42, key: "value" });

    handler.destroy();
  });

  test("error → error-text 类型", async () => {
    registerTestTool("err_tool", {
      execute: () => Promise.reject(new Error("execution failed")),
      permission: "test",
    });

    const streamFn = async function* streamFn() {
      yield { args: {}, toolCallId: "c1", toolName: "err_tool", type: "tool-call" as const };
      yield { fullText: "", type: "done" as const };
      yield { text: "handled", type: "text-delta" as const };
      yield { fullText: "handled", type: "done" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("err_tool").status).toBe("unique");

    await handler.sendMessage("test");
    const msgs = handler.getMessages();
    const toolMsg = msgs.find((m: any) => m.role === "tool") as any;
    expect(toolMsg.content[0].output.type).toBe("error-text");
    expect(toolMsg.content[0].output.value).toContain("execution failed");

    handler.destroy();
  });
});

afterAll(() => {
  resetTestTools();
  mock.restore();
});

/**
 * 对话流程测试。
 *
 * 测试用例:
 *   - 消息发送
 *   - 流式响应
 *   - 工具调用链
 *   - 会话管理
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AppConfigSchema } from "@/schema/config";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { ConversationHandler } from "@/conversation";
import { createStreamFn } from "../../helpers/mockStream";
import { registerTestTool, resetTestTools } from "../../helpers/testTools";
import { buildDerivedProviderConfig, loadRealTestConfig } from "../../helpers/realConfig";
import { closeDb, initDb } from "@/db";
import { clearAllApprovals } from "@/permission/store/approvalStore";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

let REAL_CONFIG: import("@/schema/config").AppConfigSchema;
let tempDir = "";
let originalXdgDataHome: string | undefined;

beforeAll(async () => {
  REAL_CONFIG = await loadRealTestConfig();
});

beforeEach(() => {
  tempDir = createGlobalTmpTestDir("conversation-flow-");
  originalXdgDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = tempDir;
  initDb();
  clearAllApprovals();
});

afterEach(() => {
  clearAllApprovals();
  closeDb();
  if (originalXdgDataHome !== undefined) {
    process.env.XDG_DATA_HOME = originalXdgDataHome;
  } else {
    delete process.env.XDG_DATA_HOME;
  }
  cleanupTestDir(tempDir);
  tempDir = "";
});

// ─── 纯文本对话 ────────────────────────────────────────────────

describe("对话流程 — 纯文本", () => {
  test("无工具调用时返回文本", async () => {
    const streamFn = createStreamFn([
      [
        { text: "Hello", type: "text" },
        { text: " World", type: "text" },
        { fullText: "Hello World", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("hi");

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Hello World");
    expect(result.toolRounds).toBe(0);
    expect(result.error).toBeUndefined();

    handler.destroy();
  });
});

// ─── 工具调用流程 ──────────────────────────────────────────────

describe("对话流程 — 工具执行", () => {
  test("工具调用 → 执行 → 结果追加 → LLM 回复", async () => {
    let execCalled = false;
    registerTestTool("fs_read", {
      execute: () => {
        execCalled = true;
        return Promise.resolve({ content: "hello" });
      },
      permission: "fs.read",
    });

    const streamFn = createStreamFn([
      [{ args: { path: "test.txt" }, toolCallId: "c1", toolName: "fs_read", type: "tool-call" }, { type: "done" }],
      [
        { text: "文件内容是 hello", type: "text" },
        { fullText: "文件内容是 hello", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("fs_read").status).toBe("unique");

    const result = await handler.sendMessage("read test.txt");

    expect(result.ok).toBe(true);
    expect(result.text).toBe("文件内容是 hello");
    expect(result.toolRounds).toBe(1);
    expect(execCalled).toBe(true);

    handler.destroy();
  });

  test("未知工具返回错误结果，对话继续", async () => {
    const streamFn = createStreamFn([
      [{ args: {}, toolCallId: "c1", toolName: "unknown_tool", type: "tool-call" }, { type: "done" }],
      [
        { text: "工具不存在", type: "text" },
        { fullText: "工具不存在", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("use unknown tool");

    expect(result.ok).toBe(true);
    expect(result.text).toBe("工具不存在");

    handler.destroy();
  });

  test("权限被拒后对话继续", async () => {
    let execCalled = false;
    registerTestTool("bash", {
      execute: () => {
        execCalled = true;
        return Promise.resolve("ok");
      },
      permission: "bash",
    });

    const streamFn = createStreamFn([
      [{ args: { cmd: "rm -rf /" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }, { type: "done" }],
      [
        { text: "权限被拒绝", type: "text" },
        { fullText: "权限被拒绝", type: "done" },
      ],
    ]);

    const config = structuredClone(REAL_CONFIG);
    config.permissions = [{ action: "ask", pattern: "*", permission: "bash" }];
    const handler = new ConversationHandler(config, { streamFn });

    const unsub = globalBus.subscribe(AppEvent.PermissionAsked, (evt) => {
      globalBus.publish(AppEvent.PermissionResolved, {
        allowed: false,
        id: evt.properties.id,
      });
    });

    try {
      const result = await handler.sendMessage("delete everything");
      expect(result.ok).toBe(true);
      expect(execCalled).toBe(false);
    } finally {
      unsub();
      handler.destroy();
    }
  });

  test("工具执行失败后对话继续", async () => {
    registerTestTool("fs_read", {
      execute: () => Promise.reject(new Error("ENOENT: no such file")),
      permission: "fs.read",
    });

    const streamFn = createStreamFn([
      [{ args: { path: "/no-file" }, toolCallId: "c1", toolName: "fs_read", type: "tool-call" }, { type: "done" }],
      [
        { text: "文件读取失败", type: "text" },
        { fullText: "文件读取失败", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("fs_read").status).toBe("unique");

    const result = await handler.sendMessage("read /no-file");
    expect(result.ok).toBe(true);
    expect(result.text).toBe("文件读取失败");

    handler.destroy();
  });
});

// ─── LLM 错误处理 ──────────────────────────────────────────────

describe("对话流程 — 错误处理", () => {
  test("LLM error 事件返回失败结果", async () => {
    const streamFn = async function* streamFn() {
      yield { error: new Error("API 调用失败"), type: "error" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("test");

    expect(result.ok).toBe(false);
    expect(result.text).toBe("");
    expect(result.error).toBe("API 调用失败");

    handler.destroy();
  });

  test("LLM error 前已累积的文本保留在失败结果中", async () => {
    const streamFn = async function* streamFn() {
      yield { text: "部分回复", type: "text-delta" as const };
      yield { error: new Error("连接中断"), type: "error" as const };
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("test");

    expect(result.ok).toBe(false);
    expect(result.text).toBe("部分回复");
    expect(result.error).toBe("连接中断");

    handler.destroy();
  });
});

// ─── 历史和结构 ────────────────────────────────────────────────

describe("对话流程 — 历史管理", () => {
  test("getMessages 返回副本而非引用", async () => {
    const streamFn = createStreamFn([
      [
        { text: "hi", type: "text" },
        { fullText: "hi", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    await handler.sendMessage("hi");

    const m1 = handler.getMessages();
    const m2 = handler.getMessages();
    expect(m1).not.toBe(m2);
    expect(m1).toEqual(m2);

    handler.destroy();
  });

  test("clearHistory 清空消息", async () => {
    const handler = new ConversationHandler(REAL_CONFIG, { async *streamFn() {} });
    handler.clearHistory();
    expect(handler.getMessages().length).toBe(0);

    handler.destroy();
  });

  test("updateConfig 清除 Provider 和 VerifiedMethod 缓存", async () => {
    const handler = new ConversationHandler(REAL_CONFIG, { async *streamFn() {} });

    const newConfig = await buildDerivedProviderConfig({
      model: "new-model",
      providerId: "new",
      requestMethod: "chat",
    });

    handler.updateConfig(newConfig);

    handler.destroy();
  });
});

// ─── 文本+工具调用混合场景 ────────────────────────────────────

describe("对话流程 — 文本+工具调用混合", () => {
  test("LLM 同时返回文本和工具调用时，文本保留在历史中", async () => {
    registerTestTool("fs_read", {
      execute: () => Promise.resolve({ content: "hello" }),
      permission: "fs.read",
    });

    const streamFn = createStreamFn([
      [
        { text: "我来帮你读取文件。", type: "text" },
        { args: { path: "test.txt" }, toolCallId: "c1", toolName: "fs_read", type: "tool-call" },
        { fullText: "我来帮你读取文件。", type: "done" },
      ],
      [
        { text: "文件内容是 hello", type: "text" },
        { fullText: "文件内容是 hello", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("fs_read").status).toBe("unique");

    const result = await handler.sendMessage("read test.txt");
    expect(result.ok).toBe(true);
    expect(result.text).toBe("文件内容是 hello");

    const msgs = handler.getMessages();
    expect(msgs.length).toBe(4);

    const assistantMsg = msgs[1] as any;
    if (Array.isArray(assistantMsg.content)) {
      const textParts = assistantMsg.content.filter((p: any) => p.type === "text");
      const toolParts = assistantMsg.content.filter((p: any) => p.type === "tool-call");
      expect(textParts.length).toBe(1);
      expect(textParts[0].text).toBe("我来帮你读取文件。");
      expect(toolParts.length).toBe(1);
      expect(toolParts[0].toolName).toBe("fs_read");
    }

    handler.destroy();
  });
});

afterAll(() => resetTestTools());

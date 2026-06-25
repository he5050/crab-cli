/**
 * 本地 ConversationHandler 测试。
 *
 * 测试用例:
 *   - 本地模型支持
 *   - 离线处理
 *   - 错误恢复
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import { ConversationHandler } from "@/conversation";
import { createStreamFn } from "../../helpers/mockStream";
import { registerTestTool, resetTestTools } from "../../helpers/testTools";
import { loadRealTestConfig } from "../../helpers/realConfig";
import { installDbIsolation } from "../../helpers/dbIsolation";

let REAL_CONFIG: AppConfigSchema;
installDbIsolation("conversation-handler-local-");

beforeAll(async () => {
  REAL_CONFIG = await loadRealTestConfig();
});

describe("ConversationHandler Mock 集成", () => {
  test("工具调用执行流程(streamFn 注入)", async () => {
    registerTestTool("fs_read", {
      execute: () => Promise.resolve({ content: "hello world" }),
      permission: "fs.read",
    });

    const streamFn = createStreamFn([
      [
        { args: { path: "README.md" }, toolCallId: "call_1", toolName: "fs_read", type: "tool-call" },
        { text: "我先读取文件。", type: "text" },
        { fullText: "我先读取文件。", type: "done" },
      ],
      [
        { text: "文件内容:hello world", type: "text" },
        { fullText: "文件内容:hello world", type: "done" },
      ],
    ]);

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    handler.getPermissionManager().approve("*", "**");
    expect(handler.enableExternalToolForSession("fs_read").status).toBe("unique");

    const result = await handler.sendMessage("read file");
    expect(result.ok).toBe(true);
    expect(result.text).toBe("文件内容:hello world");
  });
});

afterAll(() => resetTestTools());

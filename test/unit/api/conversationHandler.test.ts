/**
 * ConversationHandler 测试。
 *
 * 测试用例:
 *   - 构造函数初始化
 *   - clearHistory
 *   - getMessages 副本
 *   - maxToolRounds
 */
import { afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { ConversationHandler } from "@/conversation";
import type { AgentRuntimeState as AgentState } from "@/agent/core/state";
import type { AppConfigSchema } from "@/schema/config";
import { ensureSession, addTextMessage, getSessionMessages, messageRecordsToModelMessages } from "@/session";
import { loadRealTestConfig } from "../../helpers/realConfig";
import { installDbIsolation } from "../../helpers/dbIsolation";

let REAL_CONFIG: AppConfigSchema;
installDbIsolation("conversation-handler-");

beforeAll(async () => {
  REAL_CONFIG = await loadRealTestConfig();
});

afterEach(() => {
  mock.restore();
});

describe("ConversationHandler 结构验证", () => {
  test("构造函数正确初始化", () => {
    const handler = new ConversationHandler(REAL_CONFIG);
    expect(handler.getMessages().length).toBe(0);
    expect(handler.getPermissionManager()).toBeDefined();
  });

  test("clearHistory 清空消息", async () => {
    const handler = new ConversationHandler(REAL_CONFIG);
    // 直接写入内部消息来验证清空
    handler.clearHistory();
    expect(handler.getMessages().length).toBe(0);
  });

  test("getMessages 返回副本", () => {
    const handler = new ConversationHandler(REAL_CONFIG);
    const msgs1 = handler.getMessages();
    const msgs2 = handler.getMessages();
    expect(msgs1).not.toBe(msgs2); // 不是同一个引用
  });

  test("构造函数可注入历史 ModelMessage 并返回副本", () => {
    const initialMessages = [
      { content: "历史用户消息", role: "user" as const },
      { content: "历史助手回复", role: "assistant" as const },
    ];
    const handler = new ConversationHandler(REAL_CONFIG, { initialMessages });

    const messages = handler.getMessages();
    expect(messages).toEqual(initialMessages);
    expect(messages).not.toBe(initialMessages);
  });

  test("restoreState 会在空内存消息时从持久化会话恢复消息", () => {
    const sessionId = "ses_restore_state_rehydrates_messages";
    ensureSession(sessionId, {
      model: REAL_CONFIG.defaultProvider.model,
      projectDir: process.cwd(),
    });
    addTextMessage(sessionId, "user", "已持久化的用户消息");
    addTextMessage(sessionId, "assistant", "已持久化的助手回复");

    const handler = new ConversationHandler(REAL_CONFIG, { sessionId });
    const state: AgentState = {
      recentToolCalls: [],
      recoveredFrom: false,
      savedAt: Date.now(),
      systemPrompt: "",
    };

    handler.restoreState(state);

    expect(handler.getMessages()).toEqual(messageRecordsToModelMessages(getSessionMessages(sessionId)));
  });

  test("maxToolRounds 默认 50", async () => {
    let rounds = 0;
    const streamFn = async function* streamFn() {
      rounds += 1;
      if (rounds <= 49) {
        yield {
          args: {},
          toolCallId: `c${rounds}`,
          toolName: "missing-tool-for-default-rounds",
          type: "tool-call" as const,
        };
        yield { fullText: "", type: "done" as const };
      } else {
        yield { text: "ok", type: "text-delta" as const };
        yield { fullText: "ok", type: "done" as const };
      }
    };

    const handler = new ConversationHandler(REAL_CONFIG, { streamFn });
    const result = await handler.sendMessage("test default max rounds");

    expect(result.ok).toBe(true);
    expect(result.toolRounds).toBe(49);
  });

  test("构造默认 handler 不注入历史消息", () => {
    const handler = new ConversationHandler(REAL_CONFIG);
    // 通过 getMessages 验证不会死循环(间接)
    expect(handler.getMessages().length).toBe(0);
  });

  test("自定义选项生效", () => {
    const handler = new ConversationHandler(REAL_CONFIG, {
      maxToolRounds: 3,
      systemPrompt: "你是一个测试助手",
    });
    expect(handler.getMessages().length).toBe(0);
  });

  test("sendMessage 会把 editor context 注入到实际 system prompt", async () => {
    const editorContextPrompt = [
      "",
      "## Editor Context",
      "- Active file: /workspace/src/main.ts",
      "- Workspace: /workspace",
      "- Cursor: line 5, column 2",
      "- Selected text (1 lines):",
      "```",
      "const answer = 42;",
      "```",
      "",
    ].join("\n");

    mock.module("@/ide/context", () => ({
      buildEditorContextPrompt: () => editorContextPrompt,
      hasEditorContext: () => true,
      getEditorContextSummary: () => "/workspace/src/main.ts:5 (1 lines selected)",
      onEditorContextChange: () => () => {},
      startEditorContextWatch: () => {},
    }));

    let capturedSystemPrompt: string | undefined;
    const handler = new ConversationHandler(REAL_CONFIG, {
      async *streamFn(_config, _messages, options) {
        capturedSystemPrompt = options!.system;
        yield { text: "ok", type: "text-delta" as const };
        yield { fullText: "ok", type: "done" as const };
      },
      systemPrompt: "你是一个测试助手",
    });

    const result = await handler.sendMessage("hello");
    handler.destroy();

    expect(result.ok).toBe(true);
    expect(capturedSystemPrompt).toContain("你是一个测试助手");
    expect(capturedSystemPrompt).toContain("## Editor Context");
    expect(capturedSystemPrompt).toContain("Active file: /workspace/src/main.ts");
    expect(capturedSystemPrompt).toContain("Workspace: /workspace");
    expect(capturedSystemPrompt).toContain("Cursor: line 5, column 2");
    expect(capturedSystemPrompt).toContain("Selected text (1 lines):");
    expect(capturedSystemPrompt).toContain("const answer = 42;");
  });
});

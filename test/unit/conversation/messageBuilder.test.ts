/**
 * 消息构建器测试。
 *
 * 测试用例:
 *   - 消息组装
 *   - 格式转换
 *   - 内容验证
 */
import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import type { ConversationMessage, MessagePart } from "@/conversation/types";
import { buildParts, cleanOrphanedToolCallsFromModel, toModelMessages } from "@/conversation/message/messageBuilder";

// ─── 测试数据工厂 ──────────────────────────────────────────────

function createUserMessage(content: string, parts?: MessagePart[]): ConversationMessage {
  return {
    content,
    id: "msg_user_1",
    parts,
    role: "user",
    sessionId: "sess_1",
    timestamp: Date.now(),
  };
}

function createAssistantMessage(content: string, toolCalls?: ConversationMessage["toolCalls"]): ConversationMessage {
  return {
    content,
    id: "msg_assistant_1",
    role: "assistant",
    sessionId: "sess_1",
    timestamp: Date.now(),
    toolCalls,
  };
}

function createToolMessage(toolCallId: string, content: string): ConversationMessage {
  return {
    content,
    id: "msg_tool_1",
    role: "tool",
    sessionId: "sess_1",
    timestamp: Date.now(),
    toolCallId,
  };
}

function createSystemMessage(content: string): ConversationMessage {
  return {
    content,
    id: "msg_system_1",
    role: "system",
    sessionId: "sess_1",
    timestamp: Date.now(),
  };
}

// ─── toModelMessages ───────────────────────────────────────────

describe("toModelMessages", () => {
  test("转换用户消息", () => {
    const messages: ConversationMessage[] = [createUserMessage("Hello")];
    const result = toModelMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      content: "Hello",
      role: "user",
    });
  });

  test("转换系统消息", () => {
    const messages: ConversationMessage[] = [createSystemMessage("You are a helpful assistant")];
    const result = toModelMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      content: "You are a helpful assistant",
      role: "system",
    });
  });

  test("转换纯文本助手消息", () => {
    const messages: ConversationMessage[] = [createAssistantMessage("I can help you")];
    const result = toModelMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      content: "I can help you",
      role: "assistant",
    });
  });

  test("转换带工具调用的助手消息", () => {
    const messages: ConversationMessage[] = [
      createAssistantMessage("Let me check", [{ arguments: { path: "/test.txt" }, id: "call_1", name: "fs_read" }]),
      createToolMessage("call_1", "file content"),
    ];
    const result = toModelMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0]!.role).toBe("assistant");
    expect(result[1]!.role).toBe("tool");
    expect((result[1] as any).content[0].toolCallId).toBe("call_1");
  });

  test("过滤孤立 tool_calls(无对应 tool 结果)", () => {
    const messages: ConversationMessage[] = [
      createAssistantMessage("Let me check", [
        { arguments: { path: "/test.txt" }, id: "call_1", name: "fs_read" },
        { arguments: { cmd: "ls" }, id: "call_2", name: "bash" },
      ]),
      // 只有 call_1 有对应结果
      createToolMessage("call_1", "file content"),
    ];
    const result = toModelMessages(messages);

    expect(result).toHaveLength(2);
    const assistantContent = (result[0] as any).content;
    expect(Array.isArray(assistantContent)).toBe(true);
    // 只有 call_1 保留，call_2 被过滤
    const toolCalls = assistantContent.filter((p: any) => p.type === "tool-call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe("call_1");
  });

  test("工具消息输出截断", () => {
    const longContent = "a".repeat(20_000);
    const messages: ConversationMessage[] = [
      createAssistantMessage("Check", [{ arguments: {}, id: "call_1", name: "bash" }]),
      createToolMessage("call_1", longContent),
    ];
    const result = toModelMessages(messages, { toolOutputMaxChars: 1000 });

    const toolMsg = result[1] as any;
    const toolContent = toolMsg.content[0].output.value;
    expect(toolContent.length).toBeLessThan(longContent.length);
    expect(toolContent).toContain("[截断");
  });

  test("stripMedia 选项过滤图片和文件 parts", () => {
    const messages: ConversationMessage[] = [
      createUserMessage("Look at this", [
        { text: "Look at this", type: "text" },
        { type: "image", url: "https://example.com/img.png" },
        { content: "file content", path: "/test.txt", type: "file" },
      ]),
    ];
    const result = toModelMessages(messages, { stripMedia: true });

    expect(result[0]!.content).toBe("Look at this");
  });

  test("空消息数组返回空数组", () => {
    const result = toModelMessages([]);
    expect(result).toEqual([]);
  });

  test("混合角色消息转换", () => {
    const messages: ConversationMessage[] = [
      createSystemMessage("System prompt"),
      createUserMessage("User question"),
      createAssistantMessage("Assistant reply"),
    ];
    const result = toModelMessages(messages);

    expect(result).toHaveLength(3);
    expect(result[0]!.role).toBe("system");
    expect(result[1]!.role).toBe("user");
    expect(result[2]!.role).toBe("assistant");
  });

  test("工具消息从 parts 提取输出", () => {
    const messages: ConversationMessage[] = [
      createAssistantMessage("Check", [{ arguments: {}, id: "call_1", name: "bash" }]),
      {
        ...createToolMessage("call_1", ""),
        parts: [
          {
            input: {},
            output: "from parts",
            state: { output: "from parts", status: "completed", time: {} },
            tool: "bash",
            toolCallId: "call_1",
            type: "tool",
          },
        ],
      },
    ];
    const result = toModelMessages(messages);

    const toolContent = (result[1] as any).content;
    expect(Array.isArray(toolContent)).toBe(true);
    expect(toolContent[0].type).toBe("tool-result");
    expect(toolContent[0].output.value).toBe("from parts");
  });

  test("工具输出为对象时序列化为 JSON", () => {
    const messages: ConversationMessage[] = [
      createAssistantMessage("Check", [{ arguments: {}, id: "call_1", name: "json_tool" }]),
      {
        ...createToolMessage("call_1", ""),
        parts: [
          {
            input: {},
            output: { key: "value" },
            state: { output: "", status: "completed", time: {} },
            tool: "json_tool",
            toolCallId: "call_1",
            type: "tool",
          },
        ],
      },
    ];
    const result = toModelMessages(messages);

    const toolContent = (result[1] as any).content;
    expect(Array.isArray(toolContent)).toBe(true);
    expect(toolContent[0].type).toBe("tool-result");
    expect(toolContent[0].output.value).toBe('{"key":"value"}');
  });
});

// ─── buildParts ────────────────────────────────────────────────

describe("buildParts", () => {
  test("从 content 构建 text part", () => {
    const message = createUserMessage("Hello world");
    const parts = buildParts(message);

    expect(parts).toHaveLength(1);
    expect(parts![0]).toEqual({ text: "Hello world", type: "text" });
  });

  test("从 thinking 构建 thinking part", () => {
    const message: ConversationMessage = {
      ...createAssistantMessage(""),
      thinking: "Let me think...",
    };
    const parts = buildParts(message);

    const thinkingPart = parts!.find((p) => p.type === "thinking");
    expect(thinkingPart).toEqual({ text: "Let me think...", type: "thinking" });
  });

  test("从 reasoning 构建 thinking part", () => {
    const message: ConversationMessage = {
      ...createAssistantMessage(""),
      reasoning: "Reasoning process...",
    };
    const parts = buildParts(message);

    const thinkingPart = parts!.find((p) => p.type === "thinking");
    expect(thinkingPart).toEqual({ text: "Reasoning process...", type: "thinking" });
  });

  test("从 toolCalls 构建 tool parts", () => {
    const message: ConversationMessage = {
      ...createAssistantMessage(""),
      toolCalls: [{ arguments: { path: "/test.txt" }, id: "call_1", name: "fs_read" }],
    };
    const parts = buildParts(message);

    const toolPart = parts!.find((p) => p.type === "tool") as any;
    expect(toolPart).toBeDefined();
    expect(toolPart.tool).toBe("fs_read");
    expect(toolPart.toolCallId).toBe("call_1");
    expect(toolPart.input).toEqual({ path: "/test.txt" });
    expect(toolPart.state.status).toBe("pending");
  });

  test("组合多个 parts", () => {
    const message: ConversationMessage = {
      ...createAssistantMessage("Result"),
      thinking: "Thinking...",
      toolCalls: [{ arguments: { cmd: "ls" }, id: "call_1", name: "bash" }],
    };
    const parts = buildParts(message);

    expect(parts).toHaveLength(3);
    expect(parts!.some((p) => p.type === "thinking")).toBe(true);
    expect(parts!.some((p) => p.type === "text")).toBe(true);
    expect(parts!.some((p) => p.type === "tool")).toBe(true);
  });

  test("空消息返回 undefined", () => {
    const message = createAssistantMessage("");
    delete (message as any).content;
    const parts = buildParts(message);

    expect(parts).toBeUndefined();
  });
});

// ─── cleanOrphanedToolCallsFromModel ───────────────────────────

describe("cleanOrphanedToolCallsFromModel", () => {
  test("清理无对应 tool-result 的 tool-call", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { text: "Let me help", type: "text" },
          { input: {}, toolCallId: "call_1", toolName: "fs_read", type: "tool-call" },
          { input: {}, toolCallId: "call_2", toolName: "bash", type: "tool-call" },
        ],
        role: "assistant",
      },
      {
        content: [{ output: "result", toolCallId: "call_1", toolName: "fs_read", type: "tool-result" }],
        role: "assistant",
      } as any,
    ];

    cleanOrphanedToolCallsFromModel(messages);

    const assistantContent = (messages[0] as any).content;
    const toolCalls = assistantContent.filter((p: any) => p.type === "tool-call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCallId).toBe("call_1");
  });

  test("保留有对应 tool-result 的 tool-call", () => {
    const messages: ModelMessage[] = [
      {
        content: [{ input: {}, toolCallId: "call_1", toolName: "fs_read", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: "result", toolCallId: "call_1", toolName: "fs_read", type: "tool-result" }],
        role: "assistant",
      } as any,
    ];

    cleanOrphanedToolCallsFromModel(messages);

    const assistantContent = (messages[0] as any).content;
    expect(assistantContent).toHaveLength(1);
  });

  test("非数组 content 不处理", () => {
    const messages: ModelMessage[] = [
      { content: "Plain text", role: "assistant" },
      { content: "Hello", role: "user" },
    ];

    // 不应抛出错误
    cleanOrphanedToolCallsFromModel(messages);

    expect(messages[0]!.content).toBe("Plain text");
  });

  test("清理后 assistant content 为空时设为空字符串", () => {
    const messages: ModelMessage[] = [
      {
        content: [{ input: {}, toolCallId: "orphan", toolName: "tool", type: "tool-call" }],
        role: "assistant",
      },
    ];

    cleanOrphanedToolCallsFromModel(messages);

    expect((messages[0] as any).content).toBe("");
  });

  test("多个 assistant 消息分别处理", () => {
    const messages: ModelMessage[] = [
      {
        content: [{ input: {}, toolCallId: "call_1", toolName: "tool1", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: "result1", toolCallId: "call_1", toolName: "tool1", type: "tool-result" }],
        role: "assistant",
      } as any,
      {
        content: [{ input: {}, toolCallId: "call_2", toolName: "tool2", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: "result2", toolCallId: "call_2", toolName: "tool2", type: "tool-result" }],
        role: "assistant",
      } as any,
    ];

    cleanOrphanedToolCallsFromModel(messages);

    // 所有 tool-call 都有对应结果，应全部保留
    const assistantMessages = messages.filter((m) => m.role === "assistant" && Array.isArray((m as any).content));
    for (const msg of assistantMessages) {
      const { content } = msg as any;
      expect(content).toHaveLength(1);
    }
  });
});

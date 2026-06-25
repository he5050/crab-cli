/**
 * Message-adapter 白盒测试 — 纯函数:messageRoleToChatRole, messagePartsToChatParts, extractPlainText。
 */
import { describe, expect, test } from "bun:test";
import { extractPlainText, messagePartsToChatParts, messageRoleToChatRole } from "@/session";
import type { MessagePart } from "@/session/type";

describe("messageRoleToChatRole", () => {
  test("用户 → 用户", () => {
    expect(messageRoleToChatRole("user")).toBe("user");
  });

  test("助手 → 助手", () => {
    expect(messageRoleToChatRole("assistant")).toBe("assistant");
  });

  test("系统 → 系统", () => {
    expect(messageRoleToChatRole("system")).toBe("system");
  });

  test("tool → system(UI 层映射)", () => {
    expect(messageRoleToChatRole("tool")).toBe("system");
  });
});

describe("messagePartsToChatParts", () => {
  test("TextPart → ChatTextPart", () => {
    const parts: MessagePart[] = [{ content: "Hello", type: "text" }];
    const result = messagePartsToChatParts(parts);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual({ text: "Hello", type: "text" });
  });

  test("ThinkingPart → ChatThinkingPart", () => {
    const parts: MessagePart[] = [{ content: "Let me think...", type: "thinking" }];
    const result = messagePartsToChatParts(parts);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual({ text: "Let me think...", type: "thinking" });
  });

  test("ToolUsePart + ToolResultPart 配对", () => {
    const parts: MessagePart[] = [
      { content: '{"path": "/foo"}', tool_name: "read_file", tool_use_id: "call-1", type: "tool_use" },
      { content: "file contents", result: "file contents", tool_use_id: "call-1", type: "tool_result" },
    ];
    const result = messagePartsToChatParts(parts);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe("tool");
    expect((result[0] as any).tool).toBe("read_file");
    expect((result[0] as any).status).toBe("done");
    expect((result[0] as any).output).toBe("file contents");
  });

  test("ToolPart 保留 OpenCode 对齐字段", () => {
    const parts: MessagePart[] = [
      {
        callId: "call-rich",
        content: '{"path":"/foo"}',
        diagnostics: [{ message: "demo", severity: "warning" }],
        files: [{ kind: "read", path: "/foo", status: "pending" }],
        input: { path: "/foo" },
        metadata: { renderer: "read" },
        subSessionId: "sess_child",
        time: { startedAt: 10 },
        tool_name: "filesystem-read",
        tool_use_id: "call-rich",
        type: "tool_use",
      },
      {
        callId: "call-rich",
        content: "contents",
        files: [{ kind: "read", path: "/foo", status: "done" }],
        metadata: { loaded: true, renderer: "read" },
        result: "contents",
        subSessionId: "sess_child",
        success: true,
        time: { endedAt: 30 },
        tool_use_id: "call-rich",
        truncated: false,
        type: "tool_result",
      },
    ];
    const result = messagePartsToChatParts(parts);
    expect(result.length).toBe(1);
    const tool = result[0] as any;
    expect(tool.callId).toBe("call-rich");
    expect(tool.input).toEqual({ path: "/foo" });
    expect(tool.metadata).toEqual({ loaded: true, renderer: "read" });
    expect(tool.files[0]).toEqual({ kind: "read", path: "/foo", status: "done" });
    expect(tool.diagnostics[0].severity).toBe("warning");
    expect(tool.subSessionId).toBe("sess_child");
    expect(tool.durationMs).toBe(20);
  });

  test("ToolUsePart 无配对 → calling 状态", () => {
    const parts: MessagePart[] = [{ content: "{}", tool_name: "bash", tool_use_id: "call-2", type: "tool_use" }];
    const result = messagePartsToChatParts(parts);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe("tool");
    expect((result[0] as any).status).toBe("calling");
  });

  test("独立 ToolResultPart", () => {
    const parts: MessagePart[] = [{ content: "result", result: "result", tool_use_id: "call-3", type: "tool_result" }];
    const result = messagePartsToChatParts(parts);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe("tool");
    expect((result[0] as any).tool).toBe("unknown");
  });

  test("混合多种 parts", () => {
    const parts: MessagePart[] = [
      { content: "Hello", type: "text" },
      { content: "hmm", type: "thinking" },
      { content: "World", type: "text" },
    ];
    const result = messagePartsToChatParts(parts);
    expect(result.length).toBe(3);
  });

  test("空数组", () => {
    expect(messagePartsToChatParts([])).toEqual([]);
  });
});

describe("extractPlainText", () => {
  test("提取文本 parts", () => {
    const parts: MessagePart[] = [
      { content: "Hello", type: "text" },
      { content: "World", type: "text" },
    ];
    expect(extractPlainText(parts)).toBe("Hello\nWorld");
  });

  test("thinking 不纳入 content", () => {
    const parts: MessagePart[] = [
      { content: "secret", type: "thinking" },
      { content: "visible", type: "text" },
    ];
    expect(extractPlainText(parts)).toBe("visible");
  });

  test("tool_use 提取工具名", () => {
    const parts: MessagePart[] = [{ content: "{}", tool_name: "read_file", tool_use_id: "c1", type: "tool_use" }];
    expect(extractPlainText(parts)).toBe("⟳ read_file");
  });

  test("tool_result 截断长输出", () => {
    const longOutput = "x".repeat(500);
    const parts: MessagePart[] = [{ content: longOutput, result: longOutput, tool_use_id: "c1", type: "tool_result" }];
    const text = extractPlainText(parts);
    expect(text.length).toBeLessThanOrEqual(200);
  });

  test("空数组返回空字符串", () => {
    expect(extractPlainText([])).toBe("");
  });
});

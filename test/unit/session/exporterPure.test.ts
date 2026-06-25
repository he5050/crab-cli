/**
 * Exporter 白盒测试 — serializeSessionAsMarkdown, serializeSessionAsJson。
 *
 * 这两个函数接受纯数据参数，可以脱离 session/message 直接测试。
 */
import { describe, expect, test } from "bun:test";
import {
  serializeSessionAsHtml,
  serializeSessionAsJson,
  serializeSessionAsMarkdown,
  serializeSessionAsText,
} from "@/session";
import type { MessageRecord } from "@/session/type";

function makeMessage(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    createdAt: Date.now(),
    id: "msg-001",
    parts: [{ content: "Hello", type: "text" }],
    role: "user",
    sessionId: "sess-001",
    ...overrides,
  };
}

describe("serializeSessionAsMarkdown", () => {
  test("单条用户消息", () => {
    const msgs = [makeMessage({ parts: [{ content: "Hello world", type: "text" }], role: "user" })];
    const md = serializeSessionAsMarkdown("Test Chat", msgs);
    expect(md).toContain("# Test Chat");
    expect(md).toContain("Hello world");
    expect(md).toContain("用户");
  });

  test("多角色消息", () => {
    const msgs = [
      makeMessage({ parts: [{ content: "Hi", type: "text" }], role: "user" }),
      makeMessage({ parts: [{ content: "Hello!", type: "text" }], role: "assistant" }),
      makeMessage({ parts: [{ content: "System msg", type: "text" }], role: "system" }),
      makeMessage({ parts: [{ content: "Result", type: "text" }], role: "tool" }),
    ];
    const md = serializeSessionAsMarkdown("All Roles", msgs);
    expect(md).toContain("用户");
    expect(md).toContain("助手");
    expect(md).toContain("系统");
    expect(md).toContain("工具");
  });

  test("tool_use part 渲染", () => {
    const msgs = [
      makeMessage({
        parts: [{ content: '{"file": "a.ts"}', tool_name: "read_file", tool_use_id: "tu1", type: "tool_use" }],
        role: "assistant",
      }),
    ];
    const md = serializeSessionAsMarkdown("Tool Use", msgs);
    expect(md).toContain("**工具调用**");
    expect(md).toContain("read_file");
    expect(md).toContain('{"file": "a.ts"}');
  });

  test("tool_result part 渲染", () => {
    const msgs = [
      makeMessage({
        parts: [{ content: "file contents", result: "file contents", tool_use_id: "tu1", type: "tool_result" }],
        role: "tool",
      }),
    ];
    const md = serializeSessionAsMarkdown("Tool Result", msgs);
    expect(md).toContain("**工具结果**");
    expect(md).toContain("file contents");
  });

  test("thinking part 渲染", () => {
    const msgs = [
      makeMessage({
        parts: [{ content: "Let me think...", type: "thinking" }],
        role: "assistant",
      }),
    ];
    const md = serializeSessionAsMarkdown("Thinking", msgs);
    expect(md).toContain("思考过程");
    expect(md).toContain("Let me think...");
    expect(md).toContain("<details>");
    expect(md).toContain("</details>");
  });

  test("空消息列表", () => {
    const md = serializeSessionAsMarkdown("Empty", []);
    expect(md).toContain("# Empty");
    expect(md).toContain("导出时间");
  });
});

describe("serializeSessionAsJson", () => {
  test("基本 JSON 序列化", () => {
    const msgs = [
      makeMessage({ parts: [{ content: "Hi", type: "text" }], role: "user" }),
      makeMessage({ parts: [{ content: "Hello!", type: "text" }], role: "assistant" }),
    ];
    const json = serializeSessionAsJson("Test Chat", "sess-001", msgs);
    const parsed = JSON.parse(json);
    expect(parsed.sessionId).toBe("sess-001");
    expect(parsed.title).toBe("Test Chat");
    expect(parsed.messageCount).toBe(2);
    expect(parsed.messages.length).toBe(2);
    expect(parsed.messages[0].role).toBe("user");
  });

  test("包含 exportedAt 时间戳", () => {
    const json = serializeSessionAsJson("T", "s1", []);
    const parsed = JSON.parse(json);
    expect(typeof parsed.exportedAt).toBe("number");
    expect(parsed.exportedAt).toBeGreaterThan(0);
  });

  test("空消息列表", () => {
    const json = serializeSessionAsJson("Empty", "s1", []);
    const parsed = JSON.parse(json);
    expect(parsed.messageCount).toBe(0);
    expect(parsed.messages).toEqual([]);
  });

  test("消息包含完整字段", () => {
    const msgs = [makeMessage()];
    const json = serializeSessionAsJson("T", "s1", msgs);
    const parsed = JSON.parse(json);
    expect(parsed.messages[0].id).toBe("msg-001");
    expect(parsed.messages[0].role).toBe("user");
    expect(parsed.messages[0].parts).toEqual([{ content: "Hello", type: "text" }]);
    expect(typeof parsed.messages[0].createdAt).toBe("number");
  });
});

describe("serializeSessionAsText", () => {
  test("纯文本导出包含标题、角色和消息正文", () => {
    const txt = serializeSessionAsText("Text Chat", [
      makeMessage({ parts: [{ content: "Plain question", type: "text" }], role: "user" }),
      makeMessage({ parts: [{ content: "Plain answer", type: "text" }], role: "assistant" }),
    ]);

    expect(txt).toContain("Title: Text Chat");
    expect(txt).toContain("## 用户");
    expect(txt).toContain("Plain question");
    expect(txt).toContain("## 助手");
    expect(txt).toContain("Plain answer");
  });
});

describe("serializeSessionAsHtml", () => {
  test("HTML 导出包含可回读的 article role 和转义正文", () => {
    const html = serializeSessionAsHtml("HTML Chat", [
      makeMessage({ parts: [{ content: "<script>alert(1)</script>", type: "text" }], role: "user" }),
    ]);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h1>HTML Chat</h1>");
    expect(html).toContain('data-role="user"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

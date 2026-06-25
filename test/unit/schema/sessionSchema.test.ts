/**
 * 会话 Schema 测试。
 *
 * 测试用例:
 *   - Session ID 格式验证（引用 ids.ts SessionID）
 *   - Message ID 格式验证（引用 ids.ts MessageID）
 *   - SessionStatus 枚举值
 *   - MessagePart 类型（text / tool_use / tool_result）
 *   - MessagePart.tool_use_id 引用 ToolCallID
 *   - Message 完整结构验证
 *   - Session 完整结构验证
 *   - SessionListItem 轻量版验证
 *   - 边界用例与异常场景
 */
import { describe, expect, test } from "bun:test";
import { Message, Session, SessionListItem, MessageRole, PartType, MessagePart, SessionStatus } from "@/schema/session";

const validSessionId = "ses_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const validMessageId = "msg_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const validToolCallId = "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const now = Date.now();

describe("Session Schema 验证", () => {
  test("Session ID 必须以 ses_ 开头并符合 ULID 格式", () => {
    const validSession = {
      created_at: now,
      id: validSessionId,
      messages: [],
      status: "active",
      title: "测试会话",
      updated_at: now,
    };
    expect(Session.safeParse(validSession).success).toBe(true);

    const invalidSession = { ...validSession, id: "msg_01ARZ3NDEKTSV4RRFFQ69G5FAV" };
    expect(Session.safeParse(invalidSession).success).toBe(false);
  });

  test("Message ID 必须以 msg_ 开头", () => {
    const validMessage = {
      created_at: now,
      id: validMessageId,
      parts: [{ content: "hello", type: "text" }],
      role: "user",
    };
    expect(Message.safeParse(validMessage).success).toBe(true);

    const invalidMessage = { ...validMessage, id: "ses_01ARZ3NDEKTSV4RRFFQ69G5FAV" };
    expect(Session.safeParse(invalidMessage).success).toBe(false);
  });
});

describe("SessionStatus 枚举", () => {
  test("四种合法状态值", () => {
    for (const status of ["active", "paused", "completed", "error"]) {
      expect(SessionStatus.safeParse(status).success).toBe(true);
    }
  });

  test("拒绝非法状态值", () => {
    expect(SessionStatus.safeParse("running").success).toBe(false);
    expect(SessionStatus.safeParse("pending").success).toBe(false);
    expect(SessionStatus.safeParse("").success).toBe(false);
  });
});

describe("MessageRole 枚举", () => {
  test("四种合法角色", () => {
    for (const role of ["system", "user", "assistant", "tool"]) {
      expect(MessageRole.safeParse(role).success).toBe(true);
    }
  });

  test("拒绝非法角色", () => {
    expect(MessageRole.safeParse("function").success).toBe(false);
  });
});

describe("PartType 枚举", () => {
  test("三种合法类型", () => {
    for (const type of ["text", "tool_use", "tool_result"]) {
      expect(PartType.safeParse(type).success).toBe(true);
    }
  });

  test("拒绝非法类型", () => {
    expect(PartType.safeParse("image").success).toBe(false);
  });
});

describe("MessagePart", () => {
  test("纯文本部分", () => {
    const part = { content: "你好世界", type: "text" };
    expect(MessagePart.safeParse(part).success).toBe(true);
  });

  test("tool_use 部分（使用合法 ToolCallID）", () => {
    const part = { content: "read_file", tool_name: "read_file", tool_use_id: validToolCallId, type: "tool_use" };
    expect(MessagePart.safeParse(part).success).toBe(true);
  });

  test("tool_result 部分（使用合法 ToolCallID）", () => {
    const part = { content: "文件内容", result: { data: "test" }, tool_use_id: validToolCallId, type: "tool_result" };
    expect(MessagePart.safeParse(part).success).toBe(true);
  });

  test("tool_result 的 result 可选", () => {
    const part = { content: "成功", tool_use_id: validToolCallId, type: "tool_result" };
    expect(MessagePart.safeParse(part).success).toBe(true);
  });

  test("tool_use_id 拒绝非 tool_ 前缀 ID", () => {
    const part = { content: "read_file", tool_name: "read_file", tool_use_id: "call_123", type: "tool_use" };
    expect(MessagePart.safeParse(part).success).toBe(false);
  });

  test("tool_use 的 tool_name 和 tool_use_id 可选", () => {
    const part = { content: "纯文本", type: "text" };
    expect(MessagePart.safeParse(part).success).toBe(true);
  });

  test("拒绝缺少 type 字段", () => {
    expect(MessagePart.safeParse({ content: "hello" }).success).toBe(false);
  });

  test("拒绝非法 type 值", () => {
    expect(MessagePart.safeParse({ content: "hello", type: "thinking" }).success).toBe(false);
  });

  test("拒绝 content 为非字符串", () => {
    expect(MessagePart.safeParse({ content: 123, type: "text" }).success).toBe(false);
    expect(MessagePart.safeParse({ content: null, type: "text" }).success).toBe(false);
  });
});

describe("Message 完整结构", () => {
  test("最小合法消息（text 部分）", () => {
    const msg = {
      created_at: now,
      id: validMessageId,
      parts: [{ content: "你好", type: "text" }],
      role: "user",
    };
    expect(Message.safeParse(msg).success).toBe(true);
  });

  test("包含 tool_use 部分的消息", () => {
    const msg = {
      created_at: now,
      id: validMessageId,
      parts: [
        { content: "读取文件", type: "text" },
        { content: "read_file", tool_name: "read_file", tool_use_id: validToolCallId, type: "tool_use" },
      ],
      role: "assistant",
    };
    expect(Message.safeParse(msg).success).toBe(true);
  });

  test("包含混合 part 类型的消息（text + tool_use）", () => {
    const msg = {
      created_at: now,
      id: validMessageId,
      parts: [
        { content: "我来读取文件", type: "text" },
        { content: "read_file", tool_name: "read_file", tool_use_id: validToolCallId, type: "tool_use" },
      ],
      role: "assistant",
    };
    expect(Message.safeParse(msg).success).toBe(true);
  });

  test("tool 角色消息", () => {
    const msg = {
      created_at: now,
      id: validMessageId,
      parts: [{ content: "文件内容", tool_use_id: validToolCallId, type: "tool_result" }],
      role: "tool",
    };
    expect(Message.safeParse(msg).success).toBe(true);
  });

  test("拒绝缺少必填字段", () => {
    expect(Message.safeParse({ id: validMessageId, parts: [], role: "user" }).success).toBe(false);
    expect(Message.safeParse({ created_at: now, parts: [], role: "user" }).success).toBe(false);
    expect(Message.safeParse({ created_at: now, id: validMessageId, role: "user" }).success).toBe(false);
    expect(Message.safeParse({ created_at: now, id: validMessageId, parts: [] }).success).toBe(false);
  });

  test("拒绝 created_at 为字符串", () => {
    const msg = {
      created_at: "2024-01-01",
      id: validMessageId,
      parts: [{ content: "hello", type: "text" }],
      role: "user",
    };
    expect(Message.safeParse(msg).success).toBe(false);
  });

  test("空 parts 数组合法", () => {
    const msg = {
      created_at: now,
      id: validMessageId,
      parts: [],
      role: "system",
    };
    expect(Message.safeParse(msg).success).toBe(true);
  });
});

describe("Session 完整结构", () => {
  test("最小合法会话", () => {
    const session = {
      created_at: now,
      id: validSessionId,
      messages: [],
      status: "active",
      title: "测试",
      updated_at: now,
    };
    expect(Session.safeParse(session).success).toBe(true);
  });

  test("包含消息的完整会话", () => {
    const session = {
      created_at: now,
      id: validSessionId,
      messages: [{ created_at: now, id: validMessageId, parts: [{ content: "你好", type: "text" }], role: "user" }],
      model: "gpt-4o",
      status: "active",
      title: "对话",
      updated_at: now,
    };
    expect(Session.safeParse(session).success).toBe(true);
  });

  test("model 字段可选", () => {
    const session = {
      created_at: now,
      id: validSessionId,
      messages: [],
      status: "completed",
      title: "已结束",
      updated_at: now,
    };
    const result = Session.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBeUndefined();
    }
  });

  test("拒绝缺少必填字段", () => {
    expect(
      Session.safeParse({ created_at: now, id: validSessionId, messages: [], status: "active", title: "" }).success,
    ).toBe(false);
  });

  test("拒绝错误状态值", () => {
    const session = {
      created_at: now,
      id: validSessionId,
      messages: [],
      status: "running",
      title: "测试",
      updated_at: now,
    };
    expect(Session.safeParse(session).success).toBe(false);
  });

  test("拒绝 title 为非字符串", () => {
    const session = {
      created_at: now,
      id: validSessionId,
      messages: [],
      status: "active",
      title: 123,
      updated_at: now,
    };
    expect(Session.safeParse(session).success).toBe(false);
  });
});

describe("SessionListItem 轻量版", () => {
  test("合法列表项", () => {
    const item = {
      created_at: now,
      id: validSessionId,
      message_count: 10,
      status: "active",
      title: "测试会话",
      updated_at: now,
    };
    expect(SessionListItem.safeParse(item).success).toBe(true);
  });

  test("拒绝包含 messages 字段（strict 模式拒绝多余字段）", () => {
    const item = {
      created_at: now,
      id: validSessionId,
      message_count: 10,
      messages: [],
      status: "active",
      title: "测试",
      updated_at: now,
    };
    expect(SessionListItem.safeParse(item).success).toBe(false);
  });

  test("拒绝缺少 message_count", () => {
    const item = {
      created_at: now,
      id: validSessionId,
      status: "active",
      title: "测试",
      updated_at: now,
    };
    expect(SessionListItem.safeParse(item).success).toBe(false);
  });
});

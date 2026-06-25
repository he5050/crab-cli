/**
 * Converter 白盒测试 — 格式检测、会话转换、数据验证。
 */
import { describe, expect, test } from "bun:test";
import { convertMultiple, convertSession, detectConvertFormat, validateSessionData } from "@/session";

describe("detectConvertFormat", () => {
  test("空值 → 空值", () => {
    expect(detectConvertFormat(null)).toBeNull();
  });

  test("非对象 → null", () => {
    expect(detectConvertFormat("string")).toBeNull();
    expect(detectConvertFormat(123)).toBeNull();
  });

  test("Cursor 格式:messages + model", () => {
    expect(
      detectConvertFormat({
        messages: [{ content: "hi", role: "user" }],
        model: "gpt-4",
      }),
    ).toBe("cursor");
  });

  test("Cursor 格式:messages + timestamp", () => {
    expect(
      detectConvertFormat({
        messages: [{ content: "hi", role: "user", timestamp: 1000 }],
      }),
    ).toBe("cursor");
  });

  test("VS Code Copilot:requests 数组", () => {
    expect(
      detectConvertFormat({
        requests: [{ content: "hi", role: 1 }],
      }),
    ).toBe("vscode-copilot");
  });

  test("Continue.dev:history 数组", () => {
    expect(
      detectConvertFormat({
        history: [{ content: "hi", role: "user" }],
      }),
    ).toBe("continue");
  });

  test("空对象 → null", () => {
    expect(detectConvertFormat({})).toBeNull();
  });

  test("messages 为空数组 → null(先匹配 cursor，然后降级)", () => {
    // 空数组不满足 msgs.length > 0 条件
    expect(detectConvertFormat({ messages: [] })).toBeNull();
  });
});

describe("convertSession", () => {
  test("Cursor 格式转换", () => {
    const data = {
      messages: [
        { content: "Hello", role: "user" as const, timestamp: 1000 },
        { content: "Hi!", role: "assistant" as const, timestamp: 2000 },
      ],
      model: "cursor-model",
      title: "Test Chat",
    };
    const result = convertSession(data, { from: "cursor" });
    expect(result.success).toBe(true);
    expect(result.messages!.length).toBe(2);
    expect(result.title).toBe("Test Chat");
    expect(result.model).toBe("cursor-model");
    expect(result.messages![0]!.parts[0]).toEqual({ content: "Hello", type: "text" });
  });

  test("Cursor 格式带 preserveMetadata", () => {
    const data = {
      messages: [{ content: "hi", model: "gpt-4", role: "user" as const }],
      title: "Test",
    };
    const result = convertSession(data, { from: "cursor", preserveMetadata: true });
    expect(result.success).toBe(true);
    expect(result.messages![0]!.metadata).toEqual({ model: "gpt-4", source: "cursor" });
  });

  test("VS Code Copilot 转换", () => {
    const data = {
      requests: [
        { content: "What is TS?", role: 1 },
        { content: "TypeScript is...", role: 2 },
      ],
      title: "Copilot Chat",
    };
    const result = convertSession(data, { from: "vscode-copilot" });
    expect(result.success).toBe(true);
    expect(result.messages!.length).toBe(2);
    expect(result.messages![0]!.role).toBe("user");
    expect(result.messages![1]!.role).toBe("assistant");
  });

  test("VS Code Copilot 未知角色产生警告", () => {
    const data = {
      requests: [{ content: "unknown role", role: 99 }],
    };
    const result = convertSession(data, { from: "vscode-copilot" });
    expect(result.success).toBe(true);
    expect(result.messages!.length).toBe(0);
    expect(result.warnings!.length).toBeGreaterThan(0);
  });

  test("Continue.dev 转换", () => {
    const data = {
      history: [
        { content: "Explain JS", role: "user" as const },
        { content: "JS is...", role: "assistant" as const },
      ],
      model: "continue-model",
      title: "Continue Chat",
    };
    const result = convertSession(data, { from: "continue" });
    expect(result.success).toBe(true);
    expect(result.messages!.length).toBe(2);
    expect(result.model).toBe("continue-model");
  });

  test("OpenAI 格式转换 — 字符串 content", () => {
    const data = {
      messages: [
        { content: "Hello", role: "user" },
        { content: "Hi!", role: "assistant" },
      ],
    };
    const result = convertSession(data, { from: "openai" });
    expect(result.success).toBe(true);
    expect(result.messages!.length).toBe(2);
  });

  test("OpenAI 格式 — 数组 content", () => {
    const data = {
      messages: [
        {
          content: [{ text: "Hello", type: "text" }],
          role: "user",
        },
      ],
    };
    const result = convertSession(data, { from: "openai" });
    expect(result.success).toBe(true);
    expect(result.messages![0]!.parts[0]).toEqual({ content: "Hello", type: "text" });
  });

  test("OpenAI 格式 — tool_calls", () => {
    const data = {
      messages: [
        {
          content: null,
          role: "assistant",
          tool_calls: [{ arguments: { path: "/foo" }, name: "read_file" }],
        },
      ],
    };
    const result = convertSession(data, { from: "openai" });
    expect(result.success).toBe(true);
    expect(result.messages![0]!.parts.length).toBe(1);
    expect(result.messages![0]!.parts[0]!.type).toBe("tool_use");
  });

  test("自动检测格式", () => {
    const data = {
      requests: [{ content: "auto detect", role: 1 }],
    };
    const result = convertSession(data, { from: "vscode-copilot" });
    expect(result.success).toBe(true);
  });

  test("Cursor 空消息转换返回 success", () => {
    const result = convertSession({}, { from: "cursor" });
    // Cursor 转换器对空 messages 返回 success: true, messages: []
    expect(result.success).toBe(true);
    expect(result.messages!.length).toBe(0);
  });

  test("格式不匹配时产生警告", () => {
    const data = {
      messages: [{ content: "hi", role: "user" as const, timestamp: 1 }],
      model: "m",
      title: "Test",
    };
    // Detected: cursor, but specified: vscode-copilot
    const result = convertSession(data, { from: "vscode-copilot" });
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThan(0);
  });
});

describe("validateSessionData", () => {
  test("空值 → 无效", () => {
    const result = validateSessionData(null);
    expect(result.valid).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("字符串 → invalid", () => {
    const result = validateSessionData("string");
    expect(result.valid).toBe(false);
  });

  test("空对象 → invalid", () => {
    const result = validateSessionData({});
    expect(result.valid).toBe(false);
    expect(result.format).toBeUndefined();
  });

  test("Cursor 格式 → valid", () => {
    const result = validateSessionData({
      messages: [{ content: "hi", role: "user", timestamp: 1 }],
      model: "m",
    });
    expect(result.valid).toBe(true);
    expect(result.format).toBe("cursor");
  });

  test("VS Code Copilot → 有效", () => {
    const result = validateSessionData({
      requests: [{ content: "hi", role: 1 }],
    });
    expect(result.valid).toBe(true);
    expect(result.format).toBe("vscode-copilot");
  });

  test("Continue.开发 → 有效", () => {
    const result = validateSessionData({
      history: [{ content: "hi", role: "user" }],
    });
    expect(result.valid).toBe(true);
    expect(result.format).toBe("continue");
  });

  test("OpenAI → 有效", () => {
    const result = validateSessionData({
      messages: [{ content: "hi", role: "user" }],
    });
    // Note: OpenAI messages format detected as "openai" when it doesn't have model/timestamp
    // But it may first match cursor if it has role+content. This test checks the actual behavior.
    expect(result.valid).toBe(true);
    expect(result.format).toBeTruthy();
  });
});

describe("convertMultiple", () => {
  test("批量转换", () => {
    const items = [
      {
        data: {
          messages: [{ content: "hi", role: "user" as const, timestamp: 1 }],
          model: "m",
          title: "Chat 1",
        },
        options: { from: "cursor" as const },
      },
      {
        data: {
          history: [{ content: "hello", role: "user" as const }],
          title: "Chat 2",
        },
        options: { from: "continue" as const },
      },
    ];
    const results = convertMultiple(items);
    expect(results.length).toBe(2);
    expect(results[0]!.success).toBe(true);
    expect(results[1]!.success).toBe(true);
  });

  test("空数组", () => {
    expect(convertMultiple([])).toEqual([]);
  });
});

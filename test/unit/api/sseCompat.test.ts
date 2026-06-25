/**
 * SSE 兼容性处理模块单元测试
 *
 * 测试目标:
 * - normalizeOpenAICompatibleBaseURL: 自动补 /v1 路径
 * - normalizeOpenAICompatibleChatChunk: 补齐缺失的 choice/tool_call index
 * - processOpenAICompatibleSseBlock: 在 SSE 块级别执行归一化
 * - wrapOpenAICompatibleChatFetch: 包装 fetch，对 SSE 流做实时归一化
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { _sseCompat } from "@/api/stream/sseCompat";

// mock 日志模块，避免测试中产生日志输出
mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  }),
}));

const {
  normalizeOpenAICompatibleBaseURL,
  normalizeOpenAICompatibleChatChunk,
  processOpenAICompatibleSseBlock,
  wrapOpenAICompatibleChatFetch,
} = _sseCompat;

describe("normalizeOpenAICompatibleBaseURL", () => {
  it("空字符串应返回 undefined", () => {
    expect(normalizeOpenAICompatibleBaseURL("")).toBeUndefined();
  });

  it("undefined 应返回 undefined", () => {
    expect(normalizeOpenAICompatibleBaseURL(undefined)).toBeUndefined();
  });

  it("带尾斜杠的 URL 应去除尾斜杠", () => {
    expect(normalizeOpenAICompatibleBaseURL("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
  });

  it("带多个尾斜杠的 URL 应去除所有尾斜杠", () => {
    expect(normalizeOpenAICompatibleBaseURL("https://api.example.com/v1///")).toBe("https://api.example.com/v1");
  });

  it("无路径时应自动补 /v1", () => {
    const result = normalizeOpenAICompatibleBaseURL("https://api.example.com");
    expect(result).toBe("https://api.example.com/v1");
  });

  it("仅有根路径 / 时应自动补 /v1", () => {
    const result = normalizeOpenAICompatibleBaseURL("https://api.example.com/");
    expect(result).toBe("https://api.example.com/v1");
  });

  it("已有路径时不应修改", () => {
    expect(normalizeOpenAICompatibleBaseURL("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("已有自定义路径时不应修改", () => {
    expect(normalizeOpenAICompatibleBaseURL("https://api.example.com/custom/path")).toBe(
      "https://api.example.com/custom/path",
    );
  });

  it("无效 URL 应原样返回（去除尾斜杠）", () => {
    expect(normalizeOpenAICompatibleBaseURL("not-a-valid-url")).toBe("not-a-valid-url");
  });

  it("无效 URL 带尾斜杠应仅去除尾斜杠", () => {
    expect(normalizeOpenAICompatibleBaseURL("not-a-valid-url/")).toBe("not-a-valid-url");
  });
});

describe("normalizeOpenAICompatibleChatChunk", () => {
  it("null 应原样返回", () => {
    expect(normalizeOpenAICompatibleChatChunk(null)).toBeNull();
  });

  it("非对象（字符串）应原样返回", () => {
    expect(normalizeOpenAICompatibleChatChunk("hello")).toBe("hello");
  });

  it("非对象（数字）应原样返回", () => {
    expect(normalizeOpenAICompatibleChatChunk(42)).toBe(42);
  });

  it("无 choices 字段应原样返回", () => {
    const payload = { id: "abc" };
    expect(normalizeOpenAICompatibleChatChunk(payload)).toBe(payload);
  });

  it("choices 非数组时应原样返回", () => {
    const payload = { choices: "not-array" };
    expect(normalizeOpenAICompatibleChatChunk(payload)).toBe(payload);
  });

  it("choice 缺少 index 时应自动补齐", () => {
    const payload = { choices: [{ delta: { content: "hi" } }] };
    const result = normalizeOpenAICompatibleChatChunk(payload) as any;
    expect(result.choices[0].index).toBe(0);
  });

  it("多个 choice 缺少 index 时应按序补齐", () => {
    const payload = { choices: [{ delta: { content: "a" } }, { delta: { content: "b" } }] };
    const result = normalizeOpenAICompatibleChatChunk(payload) as any;
    expect(result.choices[0].index).toBe(0);
    expect(result.choices[1].index).toBe(1);
  });

  it("delta 中 null 的 role 字段应被清除", () => {
    const payload = { choices: [{ delta: { role: null, content: "hi" } }] };
    const result = normalizeOpenAICompatibleChatChunk(payload) as any;
    expect(result.choices[0].delta.role).toBeUndefined();
    expect(result.choices[0].delta.content).toBe("hi");
  });

  it("delta 中 null 的 content 字段应被清除", () => {
    const payload = { choices: [{ delta: { role: "assistant", content: null } }] };
    const result = normalizeOpenAICompatibleChatChunk(payload) as any;
    expect(result.choices[0].delta.content).toBeUndefined();
    expect(result.choices[0].delta.role).toBe("assistant");
  });

  it("delta 中 null 的 reasoning_content 字段应被清除", () => {
    const payload = { choices: [{ delta: { reasoning_content: null } }] };
    const result = normalizeOpenAICompatibleChatChunk(payload) as any;
    expect(result.choices[0].delta.reasoning_content).toBeUndefined();
  });

  it("delta 中 null 的 reasoning_details 字段应被清除", () => {
    const payload = { choices: [{ delta: { reasoning_details: null } }] };
    const result = normalizeOpenAICompatibleChatChunk(payload) as any;
    expect(result.choices[0].delta.reasoning_details).toBeUndefined();
  });

  it("delta 中 null 的 tool_calls 字段应被清除", () => {
    const payload = { choices: [{ delta: { tool_calls: null } }] };
    const result = normalizeOpenAICompatibleChatChunk(payload) as any;
    expect(result.choices[0].delta.tool_calls).toBeUndefined();
  });

  it("tool_calls 中缺 index 时应按序补齐", () => {
    const payload = {
      choices: [
        {
          delta: {
            tool_calls: [
              { id: "call_1", function: { name: "foo" } },
              { id: "call_2", function: { name: "bar" } },
            ],
          },
        },
      ],
    };
    const result = normalizeOpenAICompatibleChatChunk(payload) as any;
    expect(result.choices[0].delta.tool_calls[0].index).toBe(0);
    expect(result.choices[0].delta.tool_calls[1].index).toBe(1);
  });

  it("完整规范的 chunk 不应修改（返回同一引用）", () => {
    const payload = {
      choices: [{ index: 0, delta: { role: "assistant", content: "hi" } }],
    };
    expect(normalizeOpenAICompatibleChatChunk(payload)).toBe(payload);
  });
});

describe("processOpenAICompatibleSseBlock", () => {
  it("无 data 行的块应原样返回", () => {
    const block = "event: message\nid: 123";
    expect(processOpenAICompatibleSseBlock(block)).toBe(block);
  });

  it("[DONE] 行应原样返回", () => {
    const block = "data: [DONE]";
    expect(processOpenAICompatibleSseBlock(block)).toBe(block);
  });

  it("正常 JSON 不需要归一化时应原样返回", () => {
    const block = 'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}';
    expect(processOpenAICompatibleSseBlock(block)).toBe(block);
  });

  it("需要归一化的 JSON 应被修改", () => {
    const block = 'data: {"choices":[{"delta":{"content":"hi"}}]}';
    const result = processOpenAICompatibleSseBlock(block);
    // 应补上 index: 0
    expect(result).toContain('"index":0');
  });

  it("混合多行块中只修改需要归一化的行", () => {
    const block = 'event: message\ndata: {"choices":[{"delta":{"content":"hi"}}]}\ndata: [DONE]';
    const result = processOpenAICompatibleSseBlock(block);
    // 第一行不变
    expect(result.startsWith("event: message")).toBe(true);
    // [DONE] 不变
    expect(result).toContain("data: [DONE]");
    // data JSON 行应被归一化
    expect(result).toContain('"index":0');
  });

  it("无效 JSON 的 data 行应原样返回", () => {
    const block = "data: {not-valid-json";
    expect(processOpenAICompatibleSseBlock(block)).toBe(block);
  });
});

describe("wrapOpenAICompatibleChatFetch", () => {
  afterEach(() => {
    mock.restore();
  });

  it("非 SSE 响应应直接透传原始 response", async () => {
    const fakeResponse = new Response("ok", {
      headers: { "content-type": "application/json" },
    });
    const mockFetch = mock(() => Promise.resolve(fakeResponse));

    const wrappedFetch = wrapOpenAICompatibleChatFetch(mockFetch as any);
    const result = await wrappedFetch("https://api.example.com/chat/completions");

    expect(result).toBe(fakeResponse);
  });

  it("SSE 响应应对 chunk 进行归一化处理", async () => {
    // 构造一个 SSE 流，其中 chunk 缺少 index
    const sseData = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' + "data: [DONE]\n\n";

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseData));
        controller.close();
      },
    });

    const fakeResponse = new Response(body, {
      headers: {
        "content-type": "text/event-stream",
      },
    });
    const mockFetch = mock(() => Promise.resolve(fakeResponse));

    const wrappedFetch = wrapOpenAICompatibleChatFetch(mockFetch as any);
    const result = await wrappedFetch("https://api.example.com/chat/completions");

    // 读取转换后的流内容
    const reader = result.body!.getReader();
    const decoder = new TextDecoder();
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }

    // 应包含归一化后的 index: 0
    expect(output).toContain('"index":0');
    // [DONE] 保持不变
    expect(output).toContain("data: [DONE]");
  });

  it("URL 不包含 /chat/completions 时应直接透传", async () => {
    const fakeResponse = new Response("ok", {
      headers: { "content-type": "text/event-stream" },
    });
    const mockFetch = mock(() => Promise.resolve(fakeResponse));

    const wrappedFetch = wrapOpenAICompatibleChatFetch(mockFetch as any);
    const result = await wrappedFetch("https://api.example.com/other/path");

    expect(result).toBe(fakeResponse);
  });

  it("response.body 为空时应直接透传", async () => {
    const fakeResponse = new Response(null, {
      headers: { "content-type": "text/event-stream" },
    });
    const mockFetch = mock(() => Promise.resolve(fakeResponse));

    const wrappedFetch = wrapOpenAICompatibleChatFetch(mockFetch as any);
    const result = await wrappedFetch("https://api.example.com/chat/completions");

    expect(result).toBe(fakeResponse);
  });
});

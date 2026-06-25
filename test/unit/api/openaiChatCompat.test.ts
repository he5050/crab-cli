/**
 * OpenAI Chat 兼容层测试。
 *
 * 测试用例:
 *   - baseURL 仅有域名时补齐 /v1
 *   - 已带路径(如 /v1 或 /codex)时保持原样
 *   - 缺失的 choice.index 注入默认值
 *   - tool_calls 边界处理
 */
import { describe, expect, test } from "bun:test";
import { _compatForTesting } from "@/api";

describe("OpenAI chat 兼容层", () => {
  test("baseURL 仅有域名时会补齐 /v1", () => {
    expect(_compatForTesting.normalizeOpenAICompatibleBaseURL("https://api.iamhc.cn")).toBe("https://api.iamhc.cn/v1");
    expect(_compatForTesting.normalizeOpenAICompatibleBaseURL("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1",
    );
    expect(_compatForTesting.normalizeOpenAICompatibleBaseURL("https://relay.example.com/codex")).toBe(
      "https://relay.example.com/codex",
    );
  });

  test("为缺失的 choice.index 注入默认值", () => {
    const chunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                function: { arguments: "", name: "filesystem-read" },
                id: "functions.read:0",
                index: 0,
                type: "function",
              },
            ],
          },
          finish_reason: null,
        },
      ],
      id: "x",
      object: "chat.completion.chunk",
    };

    const normalized = _compatForTesting.normalizeOpenAICompatibleChatChunk(chunk) as any;
    expect(normalized.choices[0].index).toBe(0);
    expect(normalized.choices[0].delta.tool_calls[0].index).toBe(0);
  });

  test("为缺失的 tool_calls.index 注入默认值", () => {
    const chunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                function: { arguments: "", name: "filesystem-read" },
                id: "functions.read:0",
                type: "function",
              },
            ],
          },
          finish_reason: null,
          index: 0,
        },
      ],
      id: "x",
      object: "chat.completion.chunk",
    };

    const normalized = _compatForTesting.normalizeOpenAICompatibleChatChunk(chunk) as any;
    expect(normalized.choices[0].delta.tool_calls[0].index).toBe(0);
  });

  test("SSE block 归一化会补齐缺失 index", () => {
    const block =
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"id":"functions.read:0","type":"function","function":{"name":"filesystem-read","arguments":""}}]},"finish_reason":null}]}';
    const normalized = _compatForTesting.processOpenAICompatibleSseBlock(block);
    expect(normalized).toContain('"index":0');
  });

  test("SSE block 归一化会移除 delta 中的 null 字段", () => {
    const block =
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":null,"content":"在线","reasoning_content":null,"reasoning_details":null,"tool_calls":null},"finish_reason":null}]}';
    const normalized = _compatForTesting.processOpenAICompatibleSseBlock(block);
    const payload = JSON.parse(normalized.replace(/^data: /, ""));
    expect(payload.choices[0].delta).toEqual({ content: "在线" });
  });
});

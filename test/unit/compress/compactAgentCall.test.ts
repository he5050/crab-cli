/**
 * CompactAgent.call 测试。
 *
 * 测试用例:
 *   - call 成功返回文本
 *   - call 失败抛出错误
 *   - call 自定义选项（systemPrompt/maxTokens/temperature）
 *   - extractWebPageContent 成功提取
 *   - extractWebPageContent 失败返回原文
 *   - extractWebPageContent 空结果返回原文
 */
import { describe, expect, test, vi, beforeEach, mock, afterAll } from "bun:test";
import type { ModelMessage } from "ai";

const mockCompleteLlm = vi.fn();

// 预导入真实模块，spread 后只覆盖 completeLlm，保留所有其他导出
const realLlmModule = await import("@/api/core/llm");

mock.module("@/api/core/llm", () => ({
  ...realLlmModule,
  completeLlm: (...args: unknown[]) => mockCompleteLlm(...args),
}));

afterAll(() => {
  mock.restore();
});

function mockConfig() {
  return {
    defaultProvider: { provider: "test", model: "test-model" },
  } as never;
}

describe("CompactAgent.call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("call 成功返回完整响应", async () => {
    mockCompleteLlm.mockResolvedValue({ text: "你好，这是摘要结果" });

    const { CompactAgent } = await import("@/compress/utils");
    const agent = new CompactAgent();
    const messages = [{ role: "user" as const, content: "请总结这段对话" }];

    const result = await agent.call(messages, mockConfig());
    expect(result).toBe("你好，这是摘要结果");
    expect(mockCompleteLlm).toHaveBeenCalledTimes(1);

    // 验证默认参数（completeLlm 参数为: config, messages, { maxTokens, system, temperature, timeout }）
    const callOpts = mockCompleteLlm.mock.calls[0]![2] as Record<string, unknown>;
    expect(callOpts.maxTokens).toBe(4096);
    expect(callOpts.temperature).toBe(0.3);
    expect(callOpts.timeout).toBe(15_000);
  });

  test("call 使用自定义选项", async () => {
    mockCompleteLlm.mockResolvedValue({ text: "结果" });

    const { CompactAgent } = await import("@/compress/utils");
    const agent = new CompactAgent();
    const messages = [{ role: "user" as const, content: "test" }];

    const result = await agent.call(messages, mockConfig(), {
      maxTokens: 1024,
      systemPrompt: "自定义提示词",
      temperature: 0.8,
      timeout: 5000,
    });

    expect(result).toBe("结果");
    const callOpts = mockCompleteLlm.mock.calls[0]![2] as Record<string, unknown>;
    expect(callOpts.maxTokens).toBe(1024);
    expect(callOpts.system).toBe("自定义提示词");
    expect(callOpts.temperature).toBe(0.8);
    expect(callOpts.timeout).toBe(5000);
  });

  test("call 失败抛出原始错误", async () => {
    mockCompleteLlm.mockRejectedValue(new Error("网络超时"));

    const { CompactAgent } = await import("@/compress/utils");
    const agent = new CompactAgent();
    const messages = [{ role: "user" as const, content: "test" }];

    await expect(agent.call(messages, mockConfig())).rejects.toThrow("网络超时");
  });

  test("call 非标准错误抛出字符串", async () => {
    mockCompleteLlm.mockRejectedValue("未知错误格式");

    const { CompactAgent } = await import("@/compress/utils");
    const agent = new CompactAgent();
    const messages = [{ role: "user" as const, content: "test" }];

    await expect(agent.call(messages, mockConfig())).rejects.toThrow("未知错误格式");
  });
});

describe("CompactAgent.extractWebPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("成功提取网页内容", async () => {
    mockCompleteLlm.mockResolvedValue({ text: "提取的关键信息" });

    const { CompactAgent } = await import("@/compress/utils");
    const agent = new CompactAgent();

    const result = await agent.extractWebPageContent(
      "<html>网页内容</html>",
      "查询关键词",
      "https://example.com",
      mockConfig(),
    );

    expect(result).toBe("提取的关键信息");
  });

  test("Agent 不可用时返回原文", async () => {
    const { CompactAgent } = await import("@/compress/utils");
    const agent = new CompactAgent();
    const noProviderConfig = { defaultProvider: {} } as never;

    const result = await agent.extractWebPageContent("原始内容", "查询", "https://example.com", noProviderConfig);

    expect(result).toBe("原始内容");
    expect(mockCompleteLlm).not.toHaveBeenCalled();
  });

  test("LLM 返回空结果时返回原文", async () => {
    mockCompleteLlm.mockResolvedValue({ text: "   " });

    const { CompactAgent } = await import("@/compress/utils");
    const agent = new CompactAgent();

    const result = await agent.extractWebPageContent("原始内容", "查询", "https://example.com", mockConfig());

    expect(result).toBe("原始内容");
  });

  test("LLM 抛出异常时返回原文", async () => {
    mockCompleteLlm.mockRejectedValue(new Error("API 限流"));

    const { CompactAgent } = await import("@/compress/utils");
    const agent = new CompactAgent();

    const result = await agent.extractWebPageContent("原始内容", "查询", "https://example.com", mockConfig());

    expect(result).toBe("原始内容");
  });

  test("提取时使用指定的提取提示词", async () => {
    mockCompleteLlm.mockResolvedValue({ text: "提取结果" });

    const { CompactAgent } = await import("@/compress/utils");
    const agent = new CompactAgent();

    await agent.extractWebPageContent("内容", "查询", "https://example.com", mockConfig());

    const callArgs = mockCompleteLlm.mock.calls[0]!;
    const callMessages = callArgs[1] as ModelMessage[];
    const callOpts = callArgs[2] as Record<string, unknown>;
    // 验证消息包含查询关键词和 URL
    expect(callMessages[0]!.content).toContain("查询");
    expect(callMessages[0]!.content).toContain("https://example.com");
    expect(callOpts.system).toBe("You are a content extraction assistant.");
    expect(callOpts.temperature).toBe(0.2);
  });
});

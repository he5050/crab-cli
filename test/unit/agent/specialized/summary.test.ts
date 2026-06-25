/**
 * Summary Agent 单元测试
 *
 * 测试覆盖:
 *   - buildSummaryPrompt 各类型的提示词生成
 *   - parseSummaryResponse 要点和行动建议提取
 *   - createFallbackSummary 降级摘要
 *   - summarizeConversation / summarizeCodeChanges / summarizeDocument / createSummary 集成
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

describe("Summary Agent", () => {
  afterEach(() => {
    mock.restore();
  });

  test("buildSummaryPrompt 生成对话总结提示词", async () => {
    const { buildSummaryPrompt } = await import("@/agent/specialized/summary");
    const prompt = buildSummaryPrompt("conversation", "用户: 你好\n助手: 你好", {
      includeActionItems: false,
      includeBulletPoints: true,
      language: "zh",
      maxLength: 100,
      temperature: 0.3,
      type: "conversation",
    });
    expect(prompt).toContain("总结以下对话内容");
    expect(prompt).toContain("用户: 你好");
    expect(prompt).toContain("100 个字符");
  });

  test("buildSummaryPrompt 生成代码变更总结提示词", async () => {
    const { buildSummaryPrompt } = await import("@/agent/specialized/summary");
    const prompt = buildSummaryPrompt("code-change", "added file.ts", {
      includeActionItems: false,
      includeBulletPoints: true,
      language: "en",
      maxLength: 200,
      temperature: 0.3,
      type: "code-change",
    });
    expect(prompt).toContain("English");
    expect(prompt).toContain("代码变更");
  });

  test("buildSummaryPrompt 默认类型处理", async () => {
    const { buildSummaryPrompt } = await import("@/agent/specialized/summary");
    const prompt = buildSummaryPrompt("error" as any, "something failed", {
      includeActionItems: true,
      includeBulletPoints: true,
      language: "zh",
      maxLength: 50,
      temperature: 0.3,
      type: "error" as any,
    });
    expect(prompt).toContain("错误信息");
    expect(prompt).toContain("解决建议");
  });

  test("parseSummaryResponse 提取要点", async () => {
    const { parseSummaryResponse } = await import("@/agent/specialized/summary");
    const result = parseSummaryResponse("这是总结\n\n关键要点:\n- 要点1\n- 要点2", {
      includeActionItems: false,
      includeBulletPoints: true,
      language: "zh",
      maxLength: 100,
      temperature: 0.3,
      type: "conversation",
    });
    expect(result.summary).toBe("这是总结\n\n关键要点:\n- 要点1\n- 要点2");
    expect(result.bulletPoints).toBeDefined();
    expect(result.bulletPoints!.length).toBeGreaterThanOrEqual(1);
  });

  test("parseSummaryResponse 提取行动建议", async () => {
    const { parseSummaryResponse } = await import("@/agent/specialized/summary");
    const result = parseSummaryResponse("总结内容\n\n行动建议:\n- 行动1\n- 行动2", {
      includeActionItems: true,
      includeBulletPoints: false,
      language: "zh",
      maxLength: 100,
      temperature: 0.3,
      type: "conversation",
    });
    expect(result.actionItems).toBeDefined();
    expect(result.actionItems!.length).toBeGreaterThanOrEqual(1);
  });

  test("parseSummaryResponse 不提取时返回 undefined", async () => {
    const { parseSummaryResponse } = await import("@/agent/specialized/summary");
    const result = parseSummaryResponse("纯总结", {
      includeActionItems: false,
      includeBulletPoints: false,
      language: "zh",
      maxLength: 100,
      temperature: 0.3,
      type: "conversation",
    });
    expect(result.summary).toBe("纯总结");
    expect(result.bulletPoints).toBeUndefined();
    expect(result.actionItems).toBeUndefined();
  });

  test("createFallbackSummary 生成降级结果", async () => {
    const { createFallbackSummary } = await import("@/agent/specialized/summary");
    const result = createFallbackSummary(
      "document",
      "这是一段很长的内容需要被总结",
      {
        includeActionItems: false,
        includeBulletPoints: true,
        language: "zh",
        maxLength: 10,
        temperature: 0.3,
        type: "document",
      },
      "AI 失败",
    );
    expect(result.success).toBe(true);
    expect(result.error).toBe("AI 失败");
    expect(result.compressionRate).toBeGreaterThan(0);
    expect(result.originalLength).toBe(14);
  });

  test("createFallbackSummary 空内容处理", async () => {
    const { createFallbackSummary } = await import("@/agent/specialized/summary");
    const result = createFallbackSummary("document", "", {
      includeActionItems: false,
      includeBulletPoints: true,
      language: "zh",
      maxLength: 100,
      temperature: 0.3,
      type: "document",
    });
    expect(result.success).toBe(false);
    expect(result.compressionRate).toBe(0);
  });

  test("summarizeConversation 调用 LLM 并返回结果", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.resolve({ text: "对话总结结果\n\n关键要点:\n- 要点1" })),
    }));

    const { summarizeConversation } = await import("@/agent/specialized/summary");
    const result = await summarizeConversation(
      [
        { content: "你好", role: "user" },
        { content: "你好，有什么可以帮你", role: "assistant" },
      ],
      { maxLength: 100 },
      { defaultProvider: { model: "test", provider: "openai" } } as any,
    );

    expect(result.success).toBe(true);
    expect(result.type).toBe("conversation");
    expect(result.content).toContain("对话总结结果");
    expect(result.originalLength).toBeGreaterThan(0);
  });

  test("summarizeConversation LLM 失败时返回降级结果", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.reject(new Error("LLM 错误"))),
    }));

    const { summarizeConversation } = await import("@/agent/specialized/summary");
    const result = await summarizeConversation([{ content: "测试", role: "user" }], {}, {
      defaultProvider: { model: "test", provider: "openai" },
    } as any);

    expect(result.success).toBe(true); // fallback still returns content
    expect(result.error).toContain("LLM 错误");
  });

  test("summarizeCodeChanges 处理变更列表", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.resolve({ text: "代码变更总结" })),
    }));

    const { summarizeCodeChanges } = await import("@/agent/specialized/summary");
    const result = await summarizeCodeChanges(
      [
        { changeType: "added", filePath: "src/new.ts", linesAdded: 10, linesDeleted: 0 },
        { changeType: "modified", filePath: "src/old.ts", linesAdded: 5, linesDeleted: 3 },
      ],
      {},
      { defaultProvider: { model: "test", provider: "openai" } } as any,
    );

    expect(result.success).toBe(true);
    expect(result.type).toBe("code-change");
  });

  test("summarizeDocument 处理文档内容", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.resolve({ text: "文档总结" })),
    }));

    const { summarizeDocument } = await import("@/agent/specialized/summary");
    const result = await summarizeDocument("这是一篇文档", { maxLength: 50 }, {
      defaultProvider: { model: "test", provider: "openai" },
    } as any);

    expect(result.success).toBe(true);
    expect(result.type).toBe("document");
  });

  test("createSummary 通用总结函数", async () => {
    mock.module("@api", () => ({
      completeLlm: mock(() => Promise.resolve({ text: "通用总结" })),
    }));

    const { createSummary } = await import("@/agent/specialized/summary");
    const result = await createSummary("测试内容", "session", {}, {
      defaultProvider: { model: "test", provider: "openai" },
    } as any);

    expect(result.success).toBe(true);
    expect(result.type).toBe("session");
  });
});

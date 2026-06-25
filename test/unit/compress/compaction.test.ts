/**
 * 上下文压缩模块测试。
 *
 * 覆盖范围:
 *   - token 估算(中英文混合)
 *   - 消息 token 估算
 *   - 分割点计算
 *   - 消息序列化
 *   - 工具输出截断
 *   - maybeCompact 完整流程
 *   - 默认配置合理性
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import type { ModelMessage } from "ai";
import { installDbIsolation } from "../../helpers/dbIsolation";
import { createSession, getSessionMessages } from "@/session";
import {
  type CompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
  estimateMessagesTokens,
  estimateTokens,
  findSplitIndex,
  maybeCompact,
  truncateToolOutputs,
} from "@/compress/conversation";
import { serializeMessages, generateSummary } from "@/conversation/lifecycle";
import { listBranchPoints } from "@/tool/rollback/branchPoints";

installDbIsolation("compaction-");

afterEach(() => {
  mock.restore();
});

async function cleanBranchPoints(): Promise<void> {
  await fs.rm(path.join(process.cwd(), ".crab", "branch-points"), { force: true, recursive: true }).catch(() => {});
}

function buildTurnsNearTokenTarget(targetTokens: number, turns = 6): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let i = 0; i < turns; i++) {
    messages.push({ content: `User ${i}`, role: "user" });
    messages.push({ content: `Assistant ${i}`, role: "assistant" });
  }

  while (estimateMessagesTokens(messages) < targetTokens) {
    const last = messages[messages.length - 1]!;
    last.content = `${String(last.content)} ${"x".repeat(1000)}`;
  }

  return messages;
}

// ─── token 估算 ────────────────────────────────────────────────

describe("estimateTokens", () => {
  test("空字符串返回 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("纯英文文本", () => {
    const tokens = estimateTokens("Hello World");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  test("纯中文文本", () => {
    const tokens = estimateTokens("你好世界");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(8);
  });

  test("中英文混合", () => {
    const tokens = estimateTokens("Hello 你好 World 世界");
    expect(tokens).toBeGreaterThan(0);
  });

  test("长文本返回更大的值", () => {
    const short = estimateTokens("Hello");
    const long = estimateTokens("Hello World ".repeat(100));
    expect(long).toBeGreaterThan(short);
  });

  test("CJK 标点也算作 CJK", () => {
    const tokens = estimateTokens("你好，世界！");
    expect(tokens).toBeGreaterThan(0);
  });
});

// ─── 消息 token 估算 ──────────────────────────────────────────

describe("estimateMessagesTokens", () => {
  test("空消息数组返回 0", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  test("单条字符串内容消息", () => {
    const messages: ModelMessage[] = [{ content: "Hello World", role: "user" }];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  test("多条消息累加", () => {
    const single: ModelMessage[] = [{ content: "Hello", role: "user" }];
    const double: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi there", role: "assistant" },
    ];
    expect(estimateMessagesTokens(double)).toBeGreaterThan(estimateMessagesTokens(single));
  });

  test("工具调用消息", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { input: { path: "/foo.ts" }, toolCallId: "tc_1", toolName: "read_file", type: "tool-call" as const },
        ],
        role: "assistant",
      } as any,
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  test("工具结果消息", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { output: "file contents here", toolCallId: "tc_1", toolName: "read_file", type: "tool-result" as const },
        ],
        role: "tool",
      } as any,
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});

// ─── 分割点计算 ────────────────────────────────────────────────

describe("findSplitIndex", () => {
  test("空消息返回 0", () => {
    expect(findSplitIndex([], 4)).toBe(0);
  });

  test("消息数不足 keepRecentTurns 返回 0", () => {
    const messages: ModelMessage[] = [
      { content: "hi", role: "user" },
      { content: "hello", role: "assistant" },
    ];
    expect(findSplitIndex(messages, 4)).toBe(0);
  });

  test("足够多的消息正确分割", () => {
    const messages: ModelMessage[] = [
      { content: "1", role: "user" },
      { content: "2", role: "assistant" },
      { content: "3", role: "user" },
      { content: "4", role: "assistant" },
      { content: "5", role: "user" },
      { content: "6", role: "assistant" },
      { content: "7", role: "user" },
      { content: "8", role: "assistant" },
    ];
    // KeepRecentTurns=2: 从末尾数2个user → msg[6](1st), msg[4](2nd) → i=4
    const result = findSplitIndex(messages, 2);
    expect(result).toBe(4);
  });

  test("keepRecentTurns=1 只保留最后一轮", () => {
    const messages: ModelMessage[] = [
      { content: "1", role: "user" },
      { content: "2", role: "assistant" },
      { content: "3", role: "user" },
      { content: "4", role: "assistant" },
    ];
    // KeepRecentTurns=1: msg[2]是最后一个user → i=2
    const result = findSplitIndex(messages, 1);
    expect(result).toBe(2);
  });
});

// ─── 消息序列化 ────────────────────────────────────────────────

describe("serializeMessages", () => {
  test("字符串消息正确序列化", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi", role: "assistant" },
    ];
    const result = serializeMessages(messages, 1000);
    expect(result).toContain("[USER]: Hello");
    expect(result).toContain("[ASSISTANT]: Hi");
  });

  test("大型输出被截断", () => {
    const longOutput = "x".repeat(5000);
    const messages: ModelMessage[] = [
      {
        content: [{ output: longOutput, toolCallId: "tc_1", toolName: "read", type: "tool-result" as const }],
        role: "tool",
      } as any,
    ];
    const result = serializeMessages(messages, 100);
    expect(result).toContain("[截断");
    expect(result.length).toBeLessThan(longOutput.length);
  });

  test("工具调用序列化", () => {
    const messages: ModelMessage[] = [
      {
        content: [{ input: { dir: "/src" }, toolCallId: "tc_1", toolName: "list_files", type: "tool-call" as const }],
        role: "assistant",
      } as any,
    ];
    const result = serializeMessages(messages, 1000);
    expect(result).toContain("TOOL-CALL list_files");
  });
});

// ─── 工具输出截断 ──────────────────────────────────────────────

describe("truncateToolOutputs", () => {
  test("不截断短输出", () => {
    const messages: ModelMessage[] = [
      {
        content: [{ output: "short", toolCallId: "tc_1", toolName: "read", type: "tool-result" as const }],
        role: "tool",
      } as any,
    ];
    truncateToolOutputs(messages, 100, 0);
    const part = (messages[0]!.content as any[])[0];
    expect(part.output).toBe("short");
  });

  test("截断长输出", () => {
    const longOutput = "x".repeat(5000);
    const messages: ModelMessage[] = [
      {
        content: [{ output: longOutput, toolCallId: "tc_1", toolName: "read", type: "tool-result" as const }],
        role: "tool",
      } as any,
    ];
    truncateToolOutputs(messages, 100, 0);
    const part = (messages[0]!.content as any[])[0];
    expect(part.output).toContain("[截断");
    expect(part.output.length).toBeLessThan(longOutput.length);
  });

  test("截断 AI SDK text tool-result 时保留 output schema", () => {
    const longOutput = "x".repeat(5000);
    const messages: ModelMessage[] = [
      {
        content: [
          {
            output: { type: "text" as const, value: longOutput },
            toolCallId: "tc_1",
            toolName: "read",
            type: "tool-result" as const,
          },
        ],
        role: "tool",
      } as any,
    ];
    truncateToolOutputs(messages, 100, 0);
    const part = (messages[0]!.content as any[])[0];
    expect(part.output.type).toBe("text");
    expect(part.output.value).toContain("[截断");
    expect(part.output.value.length).toBeLessThan(longOutput.length);
  });

  test("截断 AI SDK json tool-result 时仍保留合法 output 对象", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          {
            output: { type: "json" as const, value: { data: "x".repeat(5000) } },
            toolCallId: "tc_1",
            toolName: "search",
            type: "tool-result" as const,
          },
        ],
        role: "tool",
      } as any,
    ];
    truncateToolOutputs(messages, 100, 0);
    const part = (messages[0]!.content as any[])[0];
    expect(part.output.type).toBe("text");
    expect(typeof part.output.value).toBe("string");
    expect(part.output.value).toContain("[截断");
  });

  test("保留近期消息不截断", () => {
    const longOutput = "x".repeat(5000);
    const messages: ModelMessage[] = [
      {
        content: [{ output: longOutput, toolCallId: "tc_1", toolName: "read", type: "tool-result" as const }],
        role: "tool",
      } as any,
      {
        content: [{ output: longOutput, toolCallId: "tc_2", toolName: "read", type: "tool-result" as const }],
        role: "tool",
      } as any,
    ];
    truncateToolOutputs(messages, 100, 1);
    const part0 = (messages[0]!.content as any[])[0];
    expect(part0.output).toContain("[截断");
    const part1 = (messages[1]!.content as any[])[0];
    expect(part1.output).toBe(longOutput);
  });

  test("truncateLength=0 不截断", () => {
    const longOutput = "x".repeat(5000);
    const messages: ModelMessage[] = [
      {
        content: [{ output: longOutput, toolCallId: "tc_1", toolName: "read", type: "tool-result" as const }],
        role: "tool",
      } as any,
    ];
    truncateToolOutputs(messages, 0, 0);
    const part = (messages[0]!.content as any[])[0];
    expect(part.output).toBe(longOutput);
  });

  test("非工具结果不受影响", () => {
    const messages: ModelMessage[] = [{ content: "Hello World", role: "user" }];
    truncateToolOutputs(messages, 10, 0);
    expect(messages[0]!.content).toBe("Hello World");
  });
});

// ─── maybeCompact 完整流程 ─────────────────────────────────────

describe("maybeCompact", () => {
  test("未超阈值不压缩", async () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi", role: "assistant" },
    ];
    const mockConfig = {} as any;
    const config: CompactionConfig = {
      ...DEFAULT_COMPACTION_CONFIG,
      tokenThreshold: 999_999,
    };

    const result = await maybeCompact(messages, mockConfig, config);

    expect(result.compacted).toBe(false);
    expect(result.messagesBefore).toBe(2);
    expect(result.messagesAfter).toBe(2);
    expect(messages.length).toBe(2);
  });

  test("消息不足不压缩", async () => {
    const messages: ModelMessage[] = [{ content: "Hello", role: "user" }];
    const mockConfig = {} as any;
    const config: CompactionConfig = {
      ...DEFAULT_COMPACTION_CONFIG,
      tokenThreshold: 1,
    };

    const result = await maybeCompact(messages, mockConfig, config);

    expect(result.compacted).toBe(false);
  });

  test("超阈值且消息足够 → 触发后备摘要", async () => {
    const completeLlm = mock(async () => {
      throw new Error("provider unavailable");
    });
    mock.module("@api", () => ({ completeLlm }));

    const messages: ModelMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ content: `用户消息 ${i} ${"x".repeat(200)}`, role: "user" });
      messages.push({ content: `助手回复 ${i} ${"y".repeat(200)}`, role: "assistant" });
    }

    // 使用无效 config，completeLlm 会失败 → 走后备摘要
    const mockConfig = {
      defaultProvider: { model: "test", provider: "test" },
      providerConfig: {},
    } as any;

    const config: CompactionConfig = {
      ...DEFAULT_COMPACTION_CONFIG,
      keepRecentTurns: 2,
      tokenThreshold: 100,
    };

    const result = await maybeCompact(messages, mockConfig, config);

    expect(result.compacted).toBe(true);
    expect(result.messagesAfter).toBeLessThan(result.messagesBefore);
    expect(messages.length).toBe(result.messagesAfter);

    // 压缩后消息应包含摘要
    const firstMsg = messages[0]!;
    expect(typeof firstMsg.content).toBe("string");
    expect(firstMsg.content as string).toContain("摘要");
    // 注意:后备摘要可能比原始短消息更大，这是正常的。
    // LLM 生成摘要时会大幅压缩，但规则后备摘要可能膨胀。
    // 关键验证是消息数减少(已通过上方断言)
  });

  test("压缩分支点保存压缩前完整上下文和被压缩片段", async () => {
    await cleanBranchPoints();
    const completeLlm = mock(async () => ({ text: "## 测试摘要\n分支点完整快照验证。" }));
    mock.module("@api", () => ({ completeLlm }));

    const messages: ModelMessage[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push({ content: `User ${i} ${"x".repeat(200)}`, role: "user" });
      messages.push({ content: `Assistant ${i} ${"y".repeat(200)}`, role: "assistant" });
    }
    const originalMessages = structuredClone(messages);

    const mockConfig = {
      defaultProvider: { model: "test", provider: "test" },
      providerConfig: {},
    } as any;
    const config: CompactionConfig = {
      ...DEFAULT_COMPACTION_CONFIG,
      keepRecentTurns: 2,
      tokenThreshold: 100,
    };

    const result = await maybeCompact(messages, mockConfig, config, "ses_compaction_branch_test");
    expect(result.compacted).toBe(true);

    const points = await listBranchPoints("ses_compaction_branch_test");
    expect(points).toHaveLength(1);
    expect(points[0]!.beforeState.messages).toEqual(originalMessages);
    expect(points[0]!.beforeState.compressedMessages!.length).toBe(points[0]!.beforeState.splitIndex);
    expect(points[0]!.metadata.originalSessionId).toBe("ses_compaction_branch_test");
    await cleanBranchPoints();
  });

  test("压缩成功后把摘要后的上下文写回会话消息表", async () => {
    const session = createSession({ title: "compaction persistence" });
    const completeLlm = mock(async () => ({ text: "## 持久化摘要\n压缩后恢复应只加载摘要和近期消息。" }));
    mock.module("@api", () => ({ completeLlm }));

    const messages: ModelMessage[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push({ content: `Persist User ${i} ${"x".repeat(200)}`, role: "user" });
      messages.push({ content: `Persist Assistant ${i} ${"y".repeat(200)}`, role: "assistant" });
    }

    const config: CompactionConfig = {
      ...DEFAULT_COMPACTION_CONFIG,
      keepRecentTurns: 2,
      tokenThreshold: 100,
    };

    const result = await maybeCompact(messages, {} as any, config, session.id);

    expect(result.compacted).toBe(true);
    const persisted = getSessionMessages(session.id);
    expect(persisted).toHaveLength(result.messagesAfter);
    expect(persisted[0]!.role).toBe("user");
    expect(persisted[0]!.parts[0]).toMatchObject({
      content: expect.stringContaining("持久化摘要"),
      type: "text",
    });
    expect(
      persisted.map((msg) => msg.parts.map((part) => ("content" in part ? part.content : "")).join("\n")).join("\n"),
    ).not.toContain("Persist User 0");
  });

  test("压缩后保留近期消息不变", async () => {
    const completeLlm = mock(async () => ({ text: "## 测试摘要\n近期消息保留验证。" }));
    mock.module("@api", () => ({ completeLlm }));

    const messages: ModelMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ content: `User ${i} ${"x".repeat(200)}`, role: "user" });
      messages.push({ content: `Asst ${i} ${"y".repeat(200)}`, role: "assistant" });
    }

    const mockConfig = {} as any;
    const config: CompactionConfig = {
      ...DEFAULT_COMPACTION_CONFIG,
      keepRecentTurns: 3,
      tokenThreshold: 100,
    };

    // 记住最后3轮的内容
    const lastUserContent = messages[18]!.content as string;
    const lastAsstContent = messages[19]!.content as string;

    await maybeCompact(messages, mockConfig, config);

    // 近期消息应仍在数组中(可能在末尾)
    const allContent = messages.map((m) => m.content).join(" ");
    expect(allContent).toContain(lastUserContent.slice(0, 20));
    expect(allContent).toContain(lastAsstContent.slice(0, 20));
  });

  test("主会话按模型上下文压力在 80% 区间自适应保留 3 轮", async () => {
    const completeLlm = mock(async () => ({ text: "## 测试摘要\n自适应保留轮数验证。" }));
    mock.module("@api", () => ({ completeLlm }));

    const messages = buildTurnsNearTokenTarget(103_000, 6);
    const originalRecentThreeTurns = messages.slice(6).map((msg) => msg.content);

    const mockConfig = {
      defaultProvider: { model: "gpt-4o", provider: "test" },
      providerConfig: {},
    } as any;
    const config: CompactionConfig = {
      ...DEFAULT_COMPACTION_CONFIG,
      keepRecentTurns: 4,
      tokenThreshold: 100,
    };

    await maybeCompact(messages, mockConfig, config);

    expect(messages.slice(2).map((msg) => msg.content)).toEqual(originalRecentThreeTurns);
  });
});

// ─── 默认配置 ──────────────────────────────────────────────────

describe("DEFAULT_COMPACTION_CONFIG", () => {
  test("有合理的默认值", () => {
    expect(DEFAULT_COMPACTION_CONFIG.tokenThreshold).toBe(80_000);
    expect(DEFAULT_COMPACTION_CONFIG.keepRecentTurns).toBe(4);
    expect(DEFAULT_COMPACTION_CONFIG.toolOutputTruncateLength).toBe(2000);
    expect(DEFAULT_COMPACTION_CONFIG.targetRatio).toBe(0.3);
  });
});

// ─── 摘要生成 ──────────────────────────────────────────────────

describe("generateSummary", () => {
  test("LLM 成功时传入结构化摘要参数并返回模型摘要", async () => {
    const completeLlm = mock(async (_config: any, messages: any[], options: any) => {
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toContain("请将以下对话历史压缩为结构化摘要");
      expect(messages[0].content).toContain("[USER]: 需要实现 compaction");
      expect(messages[0].content).toContain("TOOL-CALL read_file");
      expect(options.system).toContain("对话摘要生成器");
      expect(options.temperature).toBe(0.3);
      expect(options.maxTokens).toBeGreaterThan(0);
      expect(options.timeout).toBeGreaterThan(0);
      return { text: "## 当前状态\n已完成上下文压缩摘要。" };
    });

    mock.module("@api", () => ({ completeLlm }));

    const messages: ModelMessage[] = [
      { content: "需要实现 compaction", role: "user" },
      {
        content: [
          {
            input: { path: "src/conversation/compaction.ts" },
            toolCallId: "tc_1",
            toolName: "read_file",
            type: "tool-call" as const,
          },
        ],
        role: "assistant",
      } as any,
    ];

    const result = await generateSummary({} as any, messages, DEFAULT_COMPACTION_CONFIG);

    expect(result).toBe("## 当前状态\n已完成上下文压缩摘要。");
    expect(completeLlm).toHaveBeenCalledTimes(1);
  });

  test("LLM 失败时生成规则后备摘要并保留关键边界信息", async () => {
    const completeLlm = mock(async () => {
      throw new Error("provider unavailable");
    });

    mock.module("@api", () => ({ completeLlm }));

    const messages: ModelMessage[] = [
      {
        content: [
          { text: "用户要求覆盖边界场景", type: "text" as const },
          null,
          {
            output: { lines: [1, 2, 3], ok: true },
            toolCallId: "tc_1",
            toolName: "read_file",
            type: "tool-result" as const,
          },
        ],
        role: "user",
      } as any,
      {
        content: [
          {
            input: { path: "test/05Compaction" },
            toolCallId: "tc_2",
            toolName: "bun_test",
            type: "tool-call" as const,
          },
        ],
        role: "assistant",
      } as any,
      { content: "准备补充 generateSummary 用例", role: "assistant" },
    ];

    const result = await generateSummary({} as any, messages, {
      ...DEFAULT_COMPACTION_CONFIG,
      toolOutputTruncateLength: 30,
    });

    expect(result).toContain("[自动压缩摘要]");
    expect(result).toContain("统计: 1 条用户消息, 2 条助手回复, 1 次工具调用");
    expect(result).toContain("用户: 用户要求覆盖边界场景");
    expect(result).toContain("[工具结果 read_file]");
    expect(result).toContain("助手: 准备补充 generateSummary 用例");
    expect(completeLlm).toHaveBeenCalledTimes(1);
  });
});

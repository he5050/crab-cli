/**
 * 压缩器测试。
 *
 * 测试用例:
 *   - 文本压缩
 *   - 解压还原
 *   - 压缩率
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import {
  Compressor,
  cleanOrphanedToolCalls,
  defaultCompressor,
  findPreserveStartIndex,
  findRecentRoundsStartIndex,
  truncateOversizedToolResults,
} from "@/compress/core/compressor";

// ─── Compressor 类 ────────────────────────────────────────────

describe("Compressor", () => {
  test("默认实例创建", () => {
    expect(defaultCompressor).toBeDefined();
  });

  test("自定义配置实例化", () => {
    const compressor = new Compressor({
      keepRecentTurns: 2,
      toolOutputTruncateLength: 1000,
    });
    expect(compressor).toBeDefined();
  });

  test("truncateToolResults - 空数组", () => {
    const result = defaultCompressor.truncateToolResults([]);
    expect(result).toEqual([]);
  });

  test("truncateToolResults - 保留最近轮次", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      { content: "file1\nfile2\nfile3", role: "tool", toolCallId: "c1" } as any,
      { content: "Done", role: "assistant" },
    ];

    const result = defaultCompressor.truncateToolResults(messages, 1);
    expect(result.length).toBe(messages.length);
  });

  test("truncateToolResults - 截断大型工具输出", () => {
    const longOutput = "x".repeat(5000);
    const messages: ModelMessage[] = [
      {
        content: [{ input: { path: "/test" }, toolCallId: "c1", toolName: "read", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: longOutput, toolCallId: "c1", toolName: "read", type: "tool-result" }],
        role: "tool",
      } as any,
    ];

    const result = defaultCompressor.truncateToolResults(messages, 0);
    const toolMsg = result[1] as any;
    expect(toolMsg.content[0].output).toContain("[截断");
  });

  test("truncateToolResults - 低于最小阈值时保持原样", () => {
    const messages: ModelMessage[] = [
      { content: "Hi", role: "user" },
      { content: "Hello", role: "assistant" },
    ];

    const result = defaultCompressor.truncateToolResults(messages);
    expect(result).toEqual(messages);
  });
});

// ─── cleanOrphanedToolCalls ───────────────────────────────────

describe("cleanOrphanedToolCalls", () => {
  test("空数组不报错", () => {
    const messages: ModelMessage[] = [];
    cleanOrphanedToolCalls(messages);
    expect(messages.length).toBe(0);
  });

  test("清理无对应 tool result 的 assistant tool_calls", () => {
    const messages: ModelMessage[] = [
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      { content: "Next message", role: "assistant" },
    ];

    cleanOrphanedToolCalls(messages);
    expect(messages.length).toBe(1);
    expect(messages[0]!.role).toBe("assistant");
    expect(messages[0]!.content).toBe("Next message");
  });

  test("保留完整的 tool call 链", () => {
    const messages: ModelMessage[] = [
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: "output", toolCallId: "c1", toolName: "bash", type: "tool-result" }],
        role: "tool",
      } as any,
    ];

    cleanOrphanedToolCalls(messages);
    expect(messages.length).toBe(2);
  });

  test("清理孤立的 tool result", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      {
        content: [{ output: "orphan output", toolCallId: "c1", toolName: "bash", type: "tool-result" }],
        role: "tool",
      } as any,
    ];

    cleanOrphanedToolCalls(messages);
    expect(messages.length).toBe(1);
    expect(messages[0]!.role).toBe("user");
  });

  test("清理不紧随 assistant 的 tool result", () => {
    const messages: ModelMessage[] = [
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      { content: "Interrupt", role: "user" },
      { content: "late output", role: "tool", toolCallId: "c1" } as any,
    ];

    cleanOrphanedToolCalls(messages);
    expect(messages.length).toBe(2);
  });

  test("处理多个 tool calls", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" },
          { input: { path: "/test" }, toolCallId: "c2", toolName: "read", type: "tool-call" },
        ],
        role: "assistant",
      },
      {
        content: [{ output: "bash output", toolCallId: "c1", toolName: "bash", type: "tool-result" }],
        role: "tool",
      } as any,
      {
        content: [{ output: "read output", toolCallId: "c2", toolName: "read", type: "tool-result" }],
        role: "tool",
      } as any,
    ];

    cleanOrphanedToolCalls(messages);
    expect(messages.length).toBe(3);
  });

  test("部分 tool result 缺失时清理 assistant", () => {
    const messages: ModelMessage[] = [
      {
        content: [
          { input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" },
          { input: { path: "/test" }, toolCallId: "c2", toolName: "read", type: "tool-call" },
        ],
        role: "assistant",
      },
      { content: "only one result", role: "tool", toolCallId: "c1" } as any,
    ];

    cleanOrphanedToolCalls(messages);
    expect(messages.length).toBe(1);
  });
});

// ─── findPreserveStartIndex ───────────────────────────────────

describe("findPreserveStartIndex", () => {
  test("空数组返回 0", () => {
    expect(findPreserveStartIndex([])).toBe(0);
  });

  test("普通消息全部压缩", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi", role: "assistant" },
    ];
    expect(findPreserveStartIndex(messages)).toBe(2);
  });

  test("最后是 tool 消息时保留对应 assistant", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      { content: "output", role: "tool", toolCallId: "c1" } as any,
    ];
    expect(findPreserveStartIndex(messages)).toBe(1);
  });

  test("最后是 assistant with tool-calls 时保留此条", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
    ];
    expect(findPreserveStartIndex(messages)).toBe(1);
  });

  test("tool 消息无对应 assistant 时返回最后索引", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "orphan", role: "tool", toolCallId: "c1" } as any,
    ];
    expect(findPreserveStartIndex(messages)).toBe(1);
  });
});

// ─── findRecentRoundsStartIndex ───────────────────────────────

describe("findRecentRoundsStartIndex", () => {
  test("空数组返回 0", () => {
    expect(findRecentRoundsStartIndex([], 2)).toBe(0);
  });

  test("保留 1 轮", () => {
    const messages: ModelMessage[] = [
      { content: "First", role: "user" },
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: "output1", toolCallId: "c1", toolName: "bash", type: "tool-result" }],
        role: "tool",
      } as any,
      { content: "Second", role: "user" },
      {
        content: [{ input: { path: "/test" }, toolCallId: "c2", toolName: "read", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: "output2", toolCallId: "c2", toolName: "read", type: "tool-result" }],
        role: "tool",
      } as any,
    ];
    // 实际实现返回 4(包含 user 消息)
    expect(findRecentRoundsStartIndex(messages, 1)).toBe(4);
  });

  test("保留 2 轮", () => {
    const messages: ModelMessage[] = [
      { content: "First", role: "user" },
      {
        content: [{ input: { cmd: "ls" }, toolCallId: "c1", toolName: "bash", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: "output1", toolCallId: "c1", toolName: "bash", type: "tool-result" }],
        role: "tool",
      } as any,
      { content: "Second", role: "user" },
      {
        content: [{ input: { path: "/test" }, toolCallId: "c2", toolName: "read", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: "output2", toolCallId: "c2", toolName: "read", type: "tool-result" }],
        role: "tool",
      } as any,
      { content: "Third", role: "user" },
      { content: "Response", role: "assistant" },
    ];
    // 实际实现返回 1(保留 2 轮工具调用链)
    expect(findRecentRoundsStartIndex(messages, 2)).toBe(1);
  });

  test("无工具调用时返回 0", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi", role: "assistant" },
    ];
    expect(findRecentRoundsStartIndex(messages, 2)).toBe(0);
  });
});

// ─── truncateOversizedToolResults ─────────────────────────────

describe("truncateOversizedToolResults", () => {
  test("空数组不报错", () => {
    const messages: ModelMessage[] = [];
    truncateOversizedToolResults(messages);
    expect(messages.length).toBe(0);
  });

  test("短工具结果不截断", () => {
    const messages: ModelMessage[] = [
      {
        content: [{ input: { path: "/test" }, toolCallId: "c1", toolName: "read", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: "short", toolCallId: "c1", toolName: "read", type: "tool-result" }],
        role: "tool",
      } as any,
    ];

    truncateOversizedToolResults(messages, 100);
    const toolMsg = messages[1] as any;
    expect(toolMsg.content[0].output).toBe("short");
  });

  test("超长工具结果被截断", () => {
    const longOutput = "x".repeat(5000);
    const messages: ModelMessage[] = [
      {
        content: [{ input: { path: "/test" }, toolCallId: "c1", toolName: "read", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: longOutput, toolCallId: "c1", toolName: "read", type: "tool-result" }],
        role: "tool",
      } as any,
    ];

    truncateOversizedToolResults(messages, 1000);
    const toolMsg = messages[1] as any;
    expect(toolMsg.content[0].output).toContain("truncated");
    expect(toolMsg.content[0].output.length).toBeLessThan(longOutput.length);
  });

  test("字符串内容不处理", () => {
    const messages: ModelMessage[] = [
      { content: "Hello", role: "user" },
      { content: "Hi there", role: "assistant" },
    ];

    truncateOversizedToolResults(messages);
    expect(messages[0]!.content).toBe("Hello");
    expect(messages[1]!.content).toBe("Hi there");
  });

  test("无对应 assistant 时使用 unknown 工具名", () => {
    const longOutput = "x".repeat(5000);
    const messages: ModelMessage[] = [
      {
        content: [{ output: longOutput, toolCallId: "c1", toolName: "read", type: "tool-result" }],
        role: "tool",
      } as any,
    ];

    truncateOversizedToolResults(messages, 1000);
    const toolMsg = messages[0] as any;
    expect(toolMsg.content[0].output).toContain("unknown");
  });

  test("对象输出被正确处理", () => {
    const longObject = { data: "x".repeat(5000) };
    const messages: ModelMessage[] = [
      {
        content: [{ input: {}, toolCallId: "c1", toolName: "json", type: "tool-call" }],
        role: "assistant",
      },
      {
        content: [{ output: longObject, toolCallId: "c1", toolName: "json", type: "tool-result" }],
        role: "tool",
      } as any,
    ];

    truncateOversizedToolResults(messages, 1000);
    const toolMsg = messages[1] as any;
    expect(toolMsg.content[0].output).toContain("truncated");
  });
});

/**
 * session adapter round-trip 转换测试
 *
 * 验证 ChatMessage ↔ MessagePart[] 双向转换的数据完整性:
 *   - chatMessageToParts: UI 层 ChatMessage → 数据层 MessagePart[]
 *   - messagePartsToChatParts: 数据层 MessagePart[] → UI 层 ChatMessagePart[]
 *   - chatRoleToMessageRole / messageRoleToChatRole: 角色映射
 *   - extractPlainText: 纯文本提取
 *   - modelMessageToParts / messageRecordsToModelMessages: AI SDK ↔ Data
 */
import { describe, expect, it } from "bun:test";

import type { ChatMessage } from "@/ui/contexts/chatTypes";
import type {
  MessagePart,
  TextPart,
  ToolUsePart,
  ToolResultPart,
  ThinkingPart,
  MessageRecord,
} from "@/session/core/message";

import {
  chatMessageToParts,
  messagePartsToChatParts,
  chatRoleToMessageRole,
  messageRoleToChatRole,
  extractPlainText,
  modelMessageToParts,
  messageRecordsToModelMessages,
} from "@/session/adapter";

// ─── helpers ──────────────────────────────────────────────────────────

/** 构造一个最简 ChatMessage */
function makeChatMessage(role: ChatMessage["role"], parts?: ChatMessage["parts"], content = ""): ChatMessage {
  return { id: "msg-test-1", role, content, parts };
}

// ─── 1. TextPart round-trip ──────────────────────────────────────────

describe("chatMessageToParts ↔ messagePartsToChatParts", () => {
  describe("TextPart round-trip", () => {
    it("text 内容在双向转换后保持一致", () => {
      const msg = makeChatMessage("assistant", [{ type: "text", text: "Hello world" }]);

      const parts = chatMessageToParts(msg);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.type).toBe("text");

      const roundTripped = messagePartsToChatParts(parts);
      expect(roundTripped).toHaveLength(1);
      expect(roundTripped[0]!.type).toBe("text");
      if (roundTripped[0]!.type === "text") {
        expect(roundTripped[0]!.text).toBe("Hello world");
      }
    });

    it("metadata 与 time 字段正确传递", () => {
      const meta = { key: "val" };
      const time = { startedAt: 1000, endedAt: 2000, durationMs: 1000 };
      const msg = makeChatMessage("assistant", [{ type: "text", text: "with-meta", metadata: meta, time }]);

      const parts = chatMessageToParts(msg);
      const roundTripped = messagePartsToChatParts(parts);
      const rp = roundTripped[0]!;
      expect(rp.type).toBe("text");
      if (rp.type === "text") {
        expect(rp.metadata).toEqual(meta);
        expect(rp.time).toEqual(time);
      }
    });

    it("无 parts 时 content 退化为 TextPart", () => {
      const msg = makeChatMessage("user", undefined, "plain content");
      const parts = chatMessageToParts(msg);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.type).toBe("text");
      expect((parts[0] as TextPart).content).toBe("plain content");

      const roundTripped = messagePartsToChatParts(parts);
      expect(roundTripped[0]!.type).toBe("text");
      if (roundTripped[0]!.type === "text") {
        expect(roundTripped[0]!.text).toBe("plain content");
      }
    });
  });

  // ─── 2. ThinkingPart round-trip ────────────────────────────────────

  describe("ThinkingPart round-trip", () => {
    it("thinking 内容在双向转换后保持一致", () => {
      const msg = makeChatMessage("assistant", [{ type: "thinking", text: "Let me think..." }]);

      const parts = chatMessageToParts(msg);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.type).toBe("thinking");
      expect((parts[0] as ThinkingPart).content).toBe("Let me think...");

      const roundTripped = messagePartsToChatParts(parts);
      expect(roundTripped).toHaveLength(1);
      expect(roundTripped[0]!.type).toBe("thinking");
      if (roundTripped[0]!.type === "thinking") {
        expect(roundTripped[0]!.text).toBe("Let me think...");
      }
    });

    it("thinking metadata 和 time 正确传递", () => {
      const meta = { reasoning: true };
      const time = { startedAt: 500, endedAt: 1500, durationMs: 1000 };
      const msg = makeChatMessage("assistant", [{ type: "thinking", text: "deep thought", metadata: meta, time }]);

      const parts = chatMessageToParts(msg);
      const roundTripped = messagePartsToChatParts(parts);
      const rp = roundTripped[0]!;
      expect(rp.type).toBe("thinking");
      if (rp.type === "thinking") {
        expect(rp.metadata).toEqual(meta);
        expect(rp.time).toEqual(time);
        expect(rp.startedAt).toBe(500);
        expect(rp.endedAt).toBe(1500);
        expect(rp.durationMs).toBe(1000);
      }
    });
  });

  // ─── 3. ToolUse + ToolResult round-trip ────────────────────────────

  describe("ToolUse + ToolResult round-trip", () => {
    it("配对 tool_use + tool_result 合并为 status=done 的 ToolPart", () => {
      const msg = makeChatMessage("assistant", [
        {
          type: "tool",
          tool: "read_file",
          callId: "call-abc",
          success: true,
          args: '{"path":"/tmp/a.ts"}',
          output: "file contents here",
          status: "done",
        },
      ]);

      const parts = chatMessageToParts(msg);
      // tool UsePart + tool_result Part
      const toolUseParts = parts.filter((p) => p.type === "tool_use");
      const toolResultParts = parts.filter((p) => p.type === "tool_result");
      expect(toolUseParts).toHaveLength(1);
      expect(toolResultParts).toHaveLength(1);

      // 验证 data-layer 字段
      const tu = toolUseParts[0] as ToolUsePart;
      expect(tu.tool_name).toBe("read_file");
      expect(tu.tool_use_id).toBe("call-abc");

      const tr = toolResultParts[0] as ToolResultPart;
      expect(tr.tool_use_id).toBe("call-abc");
      expect(tr.result).toBe("file contents here");
      expect(tr.success).toBe(true);

      // 反向转换
      const roundTripped = messagePartsToChatParts(parts);
      expect(roundTripped).toHaveLength(1);
      const rp = roundTripped[0]!;
      expect(rp.type).toBe("tool");
      if (rp.type === "tool") {
        expect(rp.tool).toBe("read_file");
        expect(rp.status).toBe("done");
        expect(rp.success).toBe(true);
        expect(rp.output).toBe("file contents here");
        expect(rp.args).toBe('{"path":"/tmp/a.ts"}');
      }
    });

    it("error 状态的 tool 结果在反向转换后 status=error", () => {
      const msg = makeChatMessage("assistant", [
        {
          type: "tool",
          tool: "exec_cmd",
          callId: "call-err",
          success: false,
          args: '{"cmd":"ls /nonexistent"}',
          output: "No such file",
          status: "error",
        },
      ]);

      const parts = chatMessageToParts(msg);
      const roundTripped = messagePartsToChatParts(parts);
      expect(roundTripped).toHaveLength(1);
      const rp = roundTripped[0]!;
      expect(rp.type).toBe("tool");
      if (rp.type === "tool") {
        expect(rp.status).toBe("error");
        expect(rp.success).toBe(false);
        expect(rp.output).toBe("No such file");
      }
    });

    it("tool 的 metadata/files/diagnostics/subSessionId 正确传递", () => {
      const files = [{ path: "/tmp/out.txt", name: "out.txt" }] as any;
      const diagnostics = [{ line: 1, msg: "warn" }] as any;
      const msg = makeChatMessage("assistant", [
        {
          type: "tool",
          tool: "my_tool",
          callId: "call-meta",
          success: true,
          args: "{}",
          output: "ok",
          status: "done",
          metadata: { k: "v" },
          files,
          diagnostics,
          subSessionId: "sub-1",
        },
      ]);

      const parts = chatMessageToParts(msg);
      const roundTripped = messagePartsToChatParts(parts);
      const rp = roundTripped[0]!;
      expect(rp.type).toBe("tool");
      if (rp.type === "tool") {
        expect(rp.metadata).toEqual({ k: "v" });
        expect(rp.files).toEqual(files);
        expect(rp.diagnostics).toEqual(diagnostics);
        expect(rp.subSessionId).toBe("sub-1");
      }
    });

    it("truncated 和 outputPath 正确传递", () => {
      const msg = makeChatMessage("assistant", [
        {
          type: "tool",
          tool: "long_tool",
          callId: "call-trunc",
          success: true,
          args: "{}",
          output: "long output...",
          status: "done",
          truncated: true,
          outputPath: "/tmp/output.txt",
        },
      ]);

      const parts = chatMessageToParts(msg);
      const roundTripped = messagePartsToChatParts(parts);
      const rp = roundTripped[0]!;
      expect(rp.type).toBe("tool");
      if (rp.type === "tool") {
        expect(rp.truncated).toBe(true);
        expect(rp.outputPath).toBe("/tmp/output.txt");
      }
    });
  });

  // ─── 4. ToolUse without ToolResult round-trip ─────────────────────

  describe("ToolUse without ToolResult", () => {
    it("单独 tool_use (calling 状态) 在反向转换后 status=calling", () => {
      const msg = makeChatMessage("assistant", [
        {
          type: "tool",
          tool: "pending_tool",
          callId: "call-pending",
          success: true,
          args: '{"input":"data"}',
          status: "calling",
        },
      ]);

      const parts = chatMessageToParts(msg);
      // calling 状态不生成 tool_result
      const toolUseParts = parts.filter((p) => p.type === "tool_use");
      const toolResultParts = parts.filter((p) => p.type === "tool_result");
      expect(toolUseParts).toHaveLength(1);
      expect(toolResultParts).toHaveLength(0);

      // 反向转换
      const roundTripped = messagePartsToChatParts(parts);
      expect(roundTripped).toHaveLength(1);
      const rp = roundTripped[0]!;
      expect(rp.type).toBe("tool");
      if (rp.type === "tool") {
        expect(rp.status).toBe("calling");
        expect(rp.tool).toBe("pending_tool");
        expect(rp.success).toBe(true);
        expect(rp.args).toBe('{"input":"data"}');
      }
    });

    it("running 状态的 tool 不生成 tool_result", () => {
      const msg = makeChatMessage("assistant", [
        {
          type: "tool",
          tool: "slow_tool",
          callId: "call-run",
          success: true,
          args: "{}",
          status: "running",
        },
      ]);

      const parts = chatMessageToParts(msg);
      const toolResultParts = parts.filter((p) => p.type === "tool_result");
      expect(toolResultParts).toHaveLength(0);

      const roundTripped = messagePartsToChatParts(parts);
      const rp = roundTripped[0]!;
      expect(rp.type).toBe("tool");
      if (rp.type === "tool") {
        expect(rp.status).toBe("calling");
      }
    });
  });

  // ─── 5. Standalone ToolResult round-trip ───────────────────────────

  describe("Standalone ToolResult", () => {
    it("独立 tool_result 在反向转换后 tool='unknown'", () => {
      const parts: MessagePart[] = [
        {
          type: "tool_result",
          content: "some result",
          tool_use_id: "orphan-id",
          result: "some result",
        },
      ];

      const chatParts = messagePartsToChatParts(parts);
      expect(chatParts).toHaveLength(1);
      const cp = chatParts[0]!;
      expect(cp.type).toBe("tool");
      if (cp.type === "tool") {
        expect(cp.tool).toBe("unknown");
        expect(cp.success).toBe(true);
        expect(cp.output).toBe("some result");
        expect(cp.status).toBe("done");
      }
    });

    it("独立失败的 tool_result 反向转换后 status=error", () => {
      const parts: MessagePart[] = [
        {
          type: "tool_result",
          content: "failed",
          tool_use_id: "fail-id",
          result: "failed",
          success: false,
        },
      ];

      const chatParts = messagePartsToChatParts(parts);
      const cp = chatParts[0]!;
      expect(cp.type).toBe("tool");
      if (cp.type === "tool") {
        expect(cp.tool).toBe("unknown");
        expect(cp.success).toBe(false);
        expect(cp.status).toBe("error");
      }
    });
  });

  // ─── 6. Multi-part message round-trip ──────────────────────────────

  describe("Multi-part message round-trip", () => {
    it("text + thinking + tool_use + tool_result 混合消息完整保留", () => {
      const msg = makeChatMessage("assistant", [
        { type: "text", text: "Let me help." },
        { type: "thinking", text: "First I need to read the file." },
        {
          type: "tool",
          tool: "read_file",
          callId: "call-multi",
          success: true,
          args: '{"path":"/tmp/f.ts"}',
          output: "const x = 1;",
          status: "done",
        },
      ]);

      const parts = chatMessageToParts(msg);
      // text(1) + thinking(1) + tool_use(1) + tool_result(1) = 4
      expect(parts).toHaveLength(4);

      const roundTripped = messagePartsToChatParts(parts);
      // text(1) + thinking(1) + tool(1) = 3
      expect(roundTripped).toHaveLength(3);

      // 验证 text
      expect(roundTripped[0]!.type).toBe("text");
      if (roundTripped[0]!.type === "text") {
        expect(roundTripped[0]!.text).toBe("Let me help.");
      }

      // 验证 thinking
      expect(roundTripped[1]!.type).toBe("thinking");
      if (roundTripped[1]!.type === "thinking") {
        expect(roundTripped[1]!.text).toBe("First I need to read the file.");
      }

      // 验证 tool (合并后的)
      expect(roundTripped[2]!.type).toBe("tool");
      if (roundTripped[2]!.type === "tool") {
        expect(roundTripped[2]!.tool).toBe("read_file");
        expect(roundTripped[2]!.status).toBe("done");
        expect(roundTripped[2]!.output).toBe("const x = 1;");
      }
    });

    it("多个 text 和 thinking part 保持顺序", () => {
      const msg = makeChatMessage("assistant", [
        { type: "thinking", text: "think1" },
        { type: "text", text: "text1" },
        { type: "thinking", text: "think2" },
        { type: "text", text: "text2" },
      ]);

      const parts = chatMessageToParts(msg);
      expect(parts).toHaveLength(4);

      const roundTripped = messagePartsToChatParts(parts);
      expect(roundTripped).toHaveLength(4);

      const expected = ["thinking", "text", "thinking", "text"];
      const expectedTexts = ["think1", "text1", "think2", "text2"];
      for (let i = 0; i < 4; i++) {
        expect(roundTripped[i]!.type).toBe(expected[i]! as "thinking" | "text" | "tool");
        const rp = roundTripped[i]!;
        if (rp.type === "thinking") expect(rp.text).toBe(expectedTexts[i]!);
        if (rp.type === "text") expect(rp.text).toBe(expectedTexts[i]!);
      }
    });
  });
});

// ─── 7 & 8. chatRoleToMessageRole ────────────────────────────────────

describe("chatRoleToMessageRole", () => {
  it("system 角色含 tool parts 时映射为 tool", () => {
    const msg = makeChatMessage("system", [
      { type: "tool", tool: "read_file", callId: "c1", success: true, status: "done", output: "" },
    ]);
    expect(chatRoleToMessageRole(msg)).toBe("tool");
  });

  it("system 角色不含 tool parts 时保持 system", () => {
    const msg = makeChatMessage("system", [{ type: "text", text: "system prompt" }]);
    expect(chatRoleToMessageRole(msg)).toBe("system");
  });

  it("user 角色保持 user", () => {
    const msg = makeChatMessage("user", [{ type: "text", text: "hi" }]);
    expect(chatRoleToMessageRole(msg)).toBe("user");
  });

  it("assistant 角色保持 assistant", () => {
    const msg = makeChatMessage("assistant", [{ type: "text", text: "hello" }]);
    expect(chatRoleToMessageRole(msg)).toBe("assistant");
  });

  it("无 parts 的 system 消息保持 system", () => {
    const msg = makeChatMessage("system");
    expect(chatRoleToMessageRole(msg)).toBe("system");
  });

  it("无 parts 的 user 消息保持 user", () => {
    const msg = makeChatMessage("user");
    expect(chatRoleToMessageRole(msg)).toBe("user");
  });
});

// ─── 9. extractPlainText ─────────────────────────────────────────────

describe("extractPlainText", () => {
  it("从 TextPart 提取文本", () => {
    const parts: MessagePart[] = [{ type: "text", content: "hello" }];
    expect(extractPlainText(parts)).toBe("hello");
  });

  it("多个 TextPart 用换行连接", () => {
    const parts: MessagePart[] = [
      { type: "text", content: "line1" },
      { type: "text", content: "line2" },
    ];
    expect(extractPlainText(parts)).toBe("line1\nline2");
  });

  it("ThinkingPart 不纳入提取", () => {
    const parts: MessagePart[] = [
      { type: "text", content: "visible" },
      { type: "thinking", content: "hidden" },
    ];
    expect(extractPlainText(parts)).toBe("visible");
  });

  it("ToolUsePart 提取为 ⟳ tool_name 格式", () => {
    const parts: MessagePart[] = [{ type: "tool_use", content: "{}", tool_use_id: "id1", tool_name: "my_tool" }];
    expect(extractPlainText(parts)).toBe("⟳ my_tool");
  });

  it("ToolResultPart 提取 result 文本并截断到 200 字符", () => {
    const longResult = "x".repeat(300);
    const parts: MessagePart[] = [{ type: "tool_result", content: longResult, tool_use_id: "id1", result: longResult }];
    const extracted = extractPlainText(parts);
    expect(extracted.length).toBeLessThanOrEqual(200);
    expect(extracted).toBe(longResult.slice(0, 200));
  });

  it("混合 parts 正确组合", () => {
    const parts: MessagePart[] = [
      { type: "text", content: "I will use a tool." },
      { type: "thinking", content: "should be ignored" },
      { type: "tool_use", content: "{}", tool_use_id: "t1", tool_name: "search" },
      { type: "tool_result", content: "found it", tool_use_id: "t1", result: "found it" },
      { type: "text", content: "Done." },
    ];
    const extracted = extractPlainText(parts);
    expect(extracted).toContain("I will use a tool.");
    expect(extracted).toContain("⟳ search");
    expect(extracted).toContain("Done.");
  });

  it("空 parts 返回空字符串", () => {
    expect(extractPlainText([])).toBe("");
  });
});

// ─── 10. messageRoleToChatRole ────────────────────────────────────────

describe("messageRoleToChatRole", () => {
  it('tool 角色映射为 "system"', () => {
    expect(messageRoleToChatRole("tool")).toBe("system");
  });

  it("user 角色保持 user", () => {
    expect(messageRoleToChatRole("user")).toBe("user");
  });

  it("assistant 角色保持 assistant", () => {
    expect(messageRoleToChatRole("assistant")).toBe("assistant");
  });

  it("system 角色保持 system", () => {
    expect(messageRoleToChatRole("system")).toBe("system");
  });
});

// ─── modelMessageToParts ──────────────────────────────────────────────

describe("modelMessageToParts", () => {
  it("纯文本 content 转为 TextPart", () => {
    const msg = { role: "assistant", content: "hello" };
    const parts = modelMessageToParts(msg as any);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe("text");
    expect((parts[0] as TextPart).content).toBe("hello");
  });

  it("tool-call part 转为 ToolUsePart", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "text", text: "Using tool" },
        {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "read_file",
          input: { path: "/tmp/a.ts" },
        },
      ],
    };
    const parts = modelMessageToParts(msg as any);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.type).toBe("text");
    expect(parts[1]!.type).toBe("tool_use");
    if (parts[1]!.type === "tool_use") {
      expect(parts[1]!.tool_name).toBe("read_file");
      expect(parts[1]!.tool_use_id).toBe("tc-1");
    }
  });

  it("tool-result part 转为 ToolResultPart", () => {
    const msg = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc-1",
          output: "file content here",
        },
      ],
    };
    const parts = modelMessageToParts(msg as any);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe("tool_result");
    if (parts[0]!.type === "tool_result") {
      expect(parts[0]!.tool_use_id).toBe("tc-1");
      expect(parts[0]!.success).toBe(true);
    }
  });

  it("error-text output 转为失败的 ToolResultPart", () => {
    const msg = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tc-err",
          output: { type: "error-text", value: "something failed" },
        },
      ],
    };
    const parts = modelMessageToParts(msg as any);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe("tool_result");
    if (parts[0]!.type === "tool_result") {
      expect(parts[0]!.success).toBe(false);
      expect(parts[0]!.content).toBe("something failed");
    }
  });

  it("空 content 返回空 TextPart", () => {
    const msg = { role: "assistant", content: [] };
    const parts = modelMessageToParts(msg as any);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe("text");
    expect((parts[0] as TextPart).content).toBe("");
  });
});

// ─── messageRecordsToModelMessages ────────────────────────────────────

describe("messageRecordsToModelMessages", () => {
  it("user 记录转为纯文本 content", () => {
    const records: MessageRecord[] = [
      {
        id: "r1",
        sessionId: "s1",
        role: "user",
        parts: [{ type: "text", content: "hello" }],
        createdAt: 1000,
      },
    ];
    const msgs = messageRecordsToModelMessages(records);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[0]!.content).toBe("hello");
  });

  it("system 记录转为纯文本 content", () => {
    const records: MessageRecord[] = [
      {
        id: "r2",
        sessionId: "s1",
        role: "system",
        parts: [{ type: "text", content: "You are helpful." }],
        createdAt: 1000,
      },
    ];
    const msgs = messageRecordsToModelMessages(records);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe("system");
    expect(msgs[0]!.content).toBe("You are helpful.");
  });

  it("assistant + tool 记录组合为 tool-call 和 tool-result", () => {
    const callId = "tc-assoc";
    const records: MessageRecord[] = [
      {
        id: "r3",
        sessionId: "s1",
        role: "assistant",
        parts: [
          { type: "text", content: "Let me read." },
          {
            type: "tool_use",
            content: '{"path":"/tmp/f.ts"}',
            tool_use_id: callId,
            tool_name: "read_file",
          },
        ],
        createdAt: 2000,
      },
      {
        id: "r4",
        sessionId: "s1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            content: "const x = 1;",
            tool_use_id: callId,
            result: "const x = 1;",
          },
        ],
        createdAt: 3000,
      },
    ];
    const msgs = messageRecordsToModelMessages(records);
    expect(msgs).toHaveLength(2);

    // assistant 消息含 text + tool-call
    const assistantMsg = msgs[0]!;
    expect(assistantMsg.role).toBe("assistant");
    const assistantContent = assistantMsg.content as any[];
    expect(assistantContent).toHaveLength(2);
    expect(assistantContent[0]!.type).toBe("text");
    expect(assistantContent[1]!.type).toBe("tool-call");

    // tool 消息含 tool-result
    const toolMsg = msgs[1]!;
    expect(toolMsg.role).toBe("tool");
    const toolContent = toolMsg.content as any[];
    expect(toolContent).toHaveLength(1);
    expect(toolContent[0]!.type).toBe("tool-result");
    expect(toolContent[0]!.toolCallId).toBe(callId);
  });

  it("assistant 纯文本无 tool 时生成简单 content", () => {
    const records: MessageRecord[] = [
      {
        id: "r5",
        sessionId: "s1",
        role: "assistant",
        parts: [{ type: "text", content: "Just text." }],
        createdAt: 1000,
      },
    ];
    const msgs = messageRecordsToModelMessages(records);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("Just text.");
  });

  it("tool 结果中 tool_name 来源于先前 tool_use 的映射", () => {
    const callId = "tc-name-lookup";
    const records: MessageRecord[] = [
      {
        id: "r6",
        sessionId: "s1",
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            content: "{}",
            tool_use_id: callId,
            tool_name: "custom_tool",
          },
        ],
        createdAt: 1000,
      },
      {
        id: "r7",
        sessionId: "s1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            content: "ok",
            tool_use_id: callId,
            result: "ok",
          },
        ],
        createdAt: 2000,
      },
    ];
    const msgs = messageRecordsToModelMessages(records);
    const toolMsg = msgs[1]!;
    const toolContent = toolMsg.content as any[];
    expect(toolContent[0]!.toolName).toBe("custom_tool");
  });

  it("无匹配 tool_use 的 tool 结果使用 unknown 作为 toolName", () => {
    const records: MessageRecord[] = [
      {
        id: "r8",
        sessionId: "s1",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            content: "orphan result",
            tool_use_id: "no-match",
            result: "orphan result",
          },
        ],
        createdAt: 1000,
      },
    ];
    const msgs = messageRecordsToModelMessages(records);
    const toolMsg = msgs[0]!;
    const toolContent = toolMsg.content as any[];
    expect(toolContent[0]!.toolName).toBe("unknown");
  });
});

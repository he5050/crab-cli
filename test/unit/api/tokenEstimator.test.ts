/**
 * Token 估算工具单元测试
 *
 * 测试目标:
 * - estimateTextTokens: 空文本返回 0、纯英文、纯中文、中英文混合
 * - estimateMessageTokens: 字符串 content、数组 content 含 text/image/tool-result/file
 * - estimateMessagesTokens: 多条消息汇总
 * - 特殊字符、emoji、空消息
 */

import { describe, it, expect } from "bun:test";
import { estimateTextTokens, estimateMessageTokens, estimateMessagesTokens } from "@/api/utils/tokenEstimator";
import type { ModelMessage } from "ai";

describe("estimateTextTokens", () => {
  it("空字符串应返回 0", () => {
    expect(estimateTextTokens("")).toBe(0);
  });

  it("nullish 值应返回 0", () => {
    expect(estimateTextTokens(null as any)).toBe(0);
    expect(estimateTextTokens(undefined as any)).toBe(0);
  });

  it("纯英文文本应按约 4 字符/token 估算", () => {
    // 18 个英文字符 -> ceil(18/4) = 5 tokens
    expect(estimateTextTokens("Hello, World! Test")).toBe(5);
  });

  it("纯英文短文本", () => {
    // 3 个字符 -> ceil(3/4) = 1 token
    expect(estimateTextTokens("abc")).toBe(1);
  });

  it("纯中文文本应按约 1.5 字符/token 估算", () => {
    // 3 个中文字符 -> ceil(3/1.5) = 2 tokens
    expect(estimateTextTokens("你好吗")).toBe(2);
  });

  it("纯中文长文本", () => {
    // 6 个中文字符 -> ceil(6/1.5) = 4 tokens
    expect(estimateTextTokens("你好世界今天")).toBe(4);
  });

  it("中英文混合文本应分别计算", () => {
    // "Hello你好" -> 5 英文字符 + 2 中文字符
    // ceil(5/4) + ceil(2/1.5) = 2 + 2 = 4
    expect(estimateTextTokens("Hello你好")).toBe(4);
  });

  it("中英文混合长文本", () => {
    // "Hello World 你好世界" -> 11 英文字符(含空格) + 4 中文字符
    // ceil(11/4) + ceil(4/1.5) = 3 + 3 = 6
    expect(estimateTextTokens("Hello World 你好世界")).toBe(6);
  });

  it("特殊字符应按非中文估算", () => {
    // "@#$%^&*()" -> 9 个非中文字符 -> ceil(9/4) = 3
    expect(estimateTextTokens("@#$%^&*()")).toBe(3);
  });

  it("emoji 应按非中文估算", () => {
    // 每个 emoji 通常占 2 个 UTF-16 编码单元，但 string.length 会计为 2
    // "😀😁" -> length=4, 非 4e00-9fa5 -> ceil(4/4) = 1
    expect(estimateTextTokens("😀😁")).toBeGreaterThanOrEqual(1);
  });

  it("空格和换行应计入其他字符", () => {
    // "   \n\n" -> 5 个字符, 无中文 -> ceil(5/4) = 2
    expect(estimateTextTokens("   \n\n")).toBe(2);
  });
});

describe("estimateMessageTokens", () => {
  it("字符串 content 的消息应正确估算", () => {
    const msg: ModelMessage = { role: "user", content: "Hello你好" };
    // 基础开销 4 + estimateTextTokens("Hello你好") = 4 + 4 = 8
    expect(estimateMessageTokens(msg)).toBe(8);
  });

  it("空字符串 content 的消息应仅含基础开销", () => {
    const msg: ModelMessage = { role: "user", content: "" };
    // 基础开销 4 + estimateTextTokens("") = 4 + 0 = 4
    expect(estimateMessageTokens(msg)).toBe(4);
  });

  it("数组 content 包含 text 类型应正确估算", () => {
    const msg: ModelMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Hello World" }],
    };
    // 基础开销 4 + ceil(11/4) = 4 + 3 = 7
    expect(estimateMessageTokens(msg)).toBe(7);
  });

  it("数组 content 包含 image 类型应估算为 100 tokens", () => {
    const msg: ModelMessage = {
      role: "user",
      content: [{ type: "image", image: "data:image/png;base64,abc" } as any],
    };
    // 基础开销 4 + 100 = 104
    expect(estimateMessageTokens(msg)).toBe(104);
  });

  it("数组 content 包含 tool-result 类型应估算为 50 tokens", () => {
    const msg: ModelMessage = {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call_1", result: "done" } as any],
    };
    // 基础开销 4 + 50 = 54
    expect(estimateMessageTokens(msg)).toBe(54);
  });

  it("数组 content 包含 file 类型应估算为 200 tokens", () => {
    const msg: ModelMessage = {
      role: "user",
      content: [{ type: "file", mimeType: "text/plain", data: "file content" } as any],
    };
    // 基础开销 4 + 200 = 204
    expect(estimateMessageTokens(msg)).toBe(204);
  });

  it("数组 content 包含多种类型应正确汇总", () => {
    const msg: ModelMessage = {
      role: "user",
      content: [
        { type: "text", text: "hi" },
        { type: "image", image: "data:image/png;base64,abc" } as any,
        { type: "tool-result", toolCallId: "call_1", result: "done" } as any,
        { type: "file", mimeType: "text/plain", data: "data" } as any,
      ],
    };
    // 基础开销 4 + ceil(2/4) + 100 + 50 + 200 = 4 + 1 + 100 + 50 + 200 = 355
    expect(estimateMessageTokens(msg)).toBe(355);
  });

  it("未知类型的数组 part 应被忽略（仅计入基础开销）", () => {
    const msg: ModelMessage = {
      role: "user",
      content: [{ type: "unknown-type" } as any],
    };
    // 基础开销 4，未知类型不计
    expect(estimateMessageTokens(msg)).toBe(4);
  });
});

describe("estimateMessagesTokens", () => {
  it("空消息列表应返回 0", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it("多条消息应正确汇总 token 数", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Hello" }, // 4 + ceil(5/4) = 4 + 2 = 6
      { role: "assistant", content: "你好" }, // 4 + ceil(2/1.5) = 4 + 2 = 6
      { role: "user", content: "How are you?" }, // 4 + ceil(12/4) = 4 + 3 = 7
    ];
    expect(estimateMessagesTokens(messages)).toBe(6 + 6 + 7);
  });

  it("单条消息应与 estimateMessageTokens 一致", () => {
    const msg: ModelMessage = { role: "user", content: "test" };
    expect(estimateMessagesTokens([msg])).toBe(estimateMessageTokens(msg));
  });

  it("包含多模态内容的消息列表应正确汇总", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "show image" },
      {
        role: "user",
        content: [{ type: "image", image: "data:image/png;base64,abc" } as any],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "I see an image" }],
      },
    ];
    // msg1: 4 + ceil(10/4) = 4 + 3 = 7
    // msg2: 4 + 100 = 104
    // msg3: 4 + ceil(14/4) = 4 + 4 = 8
    expect(estimateMessagesTokens(messages)).toBe(7 + 104 + 8);
  });
});

describe("边界情况与特殊输入", () => {
  it("空消息（content 为空字符串）应仅含基础开销", () => {
    const msg: ModelMessage = { role: "user", content: "" };
    expect(estimateMessageTokens(msg)).toBe(4);
  });

  it("仅含 emoji 的消息应正确估算", () => {
    const msg: ModelMessage = { role: "user", content: "😀😁😂🤣" };
    // emoji 的 length 各为 2，总计 8 个编码单元
    // 无中文字符 -> ceil(8/4) = 2
    // 基础开销 4 + 2 = 6
    expect(estimateMessageTokens(msg)).toBe(6);
  });

  it("仅含特殊字符的消息应正确估算", () => {
    const msg: ModelMessage = { role: "user", content: "!@#$%^&*()" };
    // 10 个非中文字符 -> ceil(10/4) = 3
    // 基础开销 4 + 3 = 7
    expect(estimateMessageTokens(msg)).toBe(7);
  });

  it("长纯中文文本应合理估算", () => {
    // 100 个中文字符 -> ceil(100/1.5) = 67
    const text = "中".repeat(100);
    expect(estimateTextTokens(text)).toBe(Math.ceil(100 / 1.5));
  });

  it("长纯英文文本应合理估算", () => {
    // 100 个英文字符 -> ceil(100/4) = 25
    const text = "a".repeat(100);
    expect(estimateTextTokens(text)).toBe(25);
  });

  it("大量消息的性能应合理", () => {
    const messages: ModelMessage[] = Array.from({ length: 1000 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));
    // 每条: 4 + ceil(("message N".length)/4)，N 长度不定但都 > 0
    const total = estimateMessagesTokens(messages);
    expect(total).toBeGreaterThan(1000); // 每条至少 5 tokens
    expect(total).toBeLessThan(20000); // 合理上限
  });
});

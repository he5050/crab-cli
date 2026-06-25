/**
 * Thinking-extractor 白盒测试 — 思维链提取、标签清理。
 */
import { describe, expect, test } from "bun:test";
import {
  cleanThinkingContent,
  extractReasoningAsThinking,
  extractThinkingContent,
} from "@/conversation/message/thinkingExtractor";
import type { ReasoningData, ThinkingData } from "@/conversation/message/thinkingExtractor";

describe("cleanThinkingContent", () => {
  test("剥离 <thinking>...</thinking>", () => {
    expect(cleanThinkingContent("<thinking>deep</thinking>")).toBe("deep");
  });

  test("剥离 <think/> 开闭标签", () => {
    // 正则只匹配 <think/>,</think/> 格式(不含自闭合 <think/>)
    expect(cleanThinkingContent("hello <think/> world")).toBe("hello <think/> world");
  });

  test("普通文本不变", () => {
    expect(cleanThinkingContent("normal text")).toBe("normal text");
  });

  test("嵌套 <thinking> 标签清理(尾部空白被正则吃掉)", () => {
    expect(cleanThinkingContent("<thinking>a</thinking> b")).toBe("ab");
  });

  test("空白清理", () => {
    expect(cleanThinkingContent("  hello  ").trim()).toBe("hello");
  });

  test("只匹配 think 和 thinking 标签", () => {
    expect(cleanThinkingContent("<other>text</other>")).toBe("<other>text</other>");
  });
});

describe("extractThinkingContent", () => {
  test("Anthropic Extended Thinking 优先", () => {
    const thinking: ThinkingData = { thinking: "my thoughts", type: "thinking" };
    const reasoning: ReasoningData = { summary: [{ text: "summary", type: "summary_text" }] };
    expect(extractThinkingContent(thinking, reasoning, "reasoning")).toBe("my thoughts");
  });

  test("Responses API reasoning summary", () => {
    const reasoning: ReasoningData = {
      summary: [
        { text: "step 1", type: "summary_text" },
        { text: "step 2", type: "summary_text" },
      ],
    };
    expect(extractThinkingContent(undefined, reasoning)).toBe("step 1\nstep 2");
  });

  test("DeepSeek reasoning content", () => {
    expect(extractThinkingContent(undefined, undefined, "reasoning here")).toBe("reasoning here");
  });

  test("无参数返回 undefined", () => {
    expect(extractThinkingContent()).toBeUndefined();
  });

  test("空 thinking 字段回退", () => {
    const thinking: ThinkingData = { thinking: "", type: "thinking" };
    expect(extractThinkingContent(thinking, undefined, "fallback")).toBe("fallback");
  });

  test("空 reasoning summary 回退", () => {
    const reasoning: ReasoningData = { summary: [] };
    expect(extractThinkingContent(undefined, reasoning, "fallback")).toBe("fallback");
  });
});

describe("extractReasoningAsThinking", () => {
  test("拼接多个部分", () => {
    expect(extractReasoningAsThinking(["step 1", "step 2"])).toBe("step 1step 2");
  });

  test("空数组返回 undefined", () => {
    expect(extractReasoningAsThinking([])).toBeUndefined();
  });

  test("纯空白返回 undefined", () => {
    expect(extractReasoningAsThinking(["  ", "\t"])).toBeUndefined();
  });

  test("单部分", () => {
    expect(extractReasoningAsThinking(["reasoning text"])).toBe("reasoning text");
  });

  test("含标签清理", () => {
    expect(extractReasoningAsThinking(["<thinking>deep</thinking>"])).toBe("deep");
  });
});

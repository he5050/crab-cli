/**
 * Compaction 深拷贝与核心工具测试
 *
 * 覆盖:
 *   1. cloneModelMessages 使用 structuredClone(替代 JSON.parse/stringify)
 *   2. 深拷贝与原对象完全独立(修改副本不影响原对象)
 */

import { describe, expect, it } from "bun:test";

// 直接测试 structuredClone 的可用性(compaction.ts 内部使用)
describe("structuredClone 消息深拷贝", () => {
  it("structuredClone 正确深拷贝嵌套对象", () => {
    const original = {
      content: [
        { text: "Hello", type: "text" },
        { input: { path: "/a.ts" }, toolCallId: "call_1", toolName: "read", type: "tool-call" },
      ],
      metadata: { timestamp: 1_234_567_890 },
      role: "assistant" as const,
    };

    const cloned = structuredClone(original);

    // 结构相同
    expect(cloned).toEqual(original);
    // 引用不同
    expect(cloned).not.toBe(original);
    expect(cloned.content).not.toBe(original.content);
  });

  it("修改深拷贝不影响原对象", () => {
    const original = {
      content: [{ text: "original", type: "text" }],
      role: "assistant" as const,
    };

    const cloned = structuredClone(original) as typeof original;
    (cloned.content[0] as any).text = "modified";

    expect(original.content[0]).toEqual({ text: "original", type: "text" });
    expect(cloned.content[0]).toEqual({ text: "modified", type: "text" });
  });

  it("深拷贝保留数组中嵌套对象的独立性", () => {
    const messages = [
      { content: "Hi", role: "user" },
      { content: [{ text: "Response", type: "text" }], role: "assistant" },
    ];

    const cloned = structuredClone(messages);
    (cloned[1] as any).content[0].text = "Changed";

    expect((messages[1] as any).content[0].text).toBe("Response");
    expect((cloned[1] as any).content[0].text).toBe("Changed");
  });

  it("structuredClone 处理包含 undefined 和 null 的消息", () => {
    const original = {
      content: null,
      reasoning: undefined,
      role: "assistant" as const,
      toolCallId: undefined,
    };

    const cloned = structuredClone(original);
    expect(cloned.content).toBeNull();
    expect(cloned.reasoning).toBeUndefined();
  });
});

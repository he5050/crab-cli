/**
 * MCP toolConverter 单元测试。
 *
 * 测试目标:验证 src/mcp/toolConverter.ts 中 JSON Schema → Zod 转换对
 * oneOf / anyOf / 嵌套复合类型的支持。
 *
 * 测试策略:通过 mcpToolToToolDefinition 拿到 parameters(Zod schema)，
 * 再用 .parse() / .safeParse() 验证 union 语义、空数组回退、嵌套等。
 *
 * 用例清单:
 *   1. 基本 anyOf(string | number)→ z.union
 *   2. 基本 oneOf(string | number)→ z.union(无 discriminator 时降级)
 *   3. oneOf + 共享 discriminator 字段 → z.discriminatedUnion(互斥校验)
 *   4. 嵌套 oneOf(object 内嵌 oneOf)→ 递归构造
 *   5. 空 oneOf 数组 → 回退 z.any()
 *   6. 空 anyOf 数组 → 回退 z.any()
 *   7. 既有 enum / 普通类型不被破坏(回归)
 *   8. tryDiscriminatedUnion 抛错时降级 z.union(钉住 try/catch 降级路径)
 */

import { describe, expect, test } from "bun:test";
import type { McpClient } from "@/mcp/client/mcpClient";
import { mcpToolToToolDefinition } from "@/mcp/tool/toolConverter";

/**
 * 构造一个仅满足 toolConverter 调用面(callTool)的最小 McpClient 替身。
 * 不启动实际 MCP 连接；toolConverter 只在 execute 闭包中调用 client.callTool，
 * schema 转换不触发网络。
 */
function fakeClient(): McpClient {
  return {
    callTool: async () => ({ content: [{ text: "", type: "text" }] }),
  } as unknown as McpClient;
}

describe("mcpToolToToolDefinition — JSON Schema → Zod 转换", () => {
  test("基本 anyOf(string | number)生成 z.union，string 与 number 都能通过", () => {
    const tool = mcpToolToToolDefinition(
      "svc",
      {
        description: "echo value",
        inputSchema: {
          properties: {
            value: { anyOf: [{ type: "string" }, { type: "number" }] },
          },
          required: ["value"],
          type: "object",
        },
        name: "echo",
      },
      fakeClient(),
    );

    expect(tool.parameters.parse({ value: "hello" }).value).toBe("hello");
    expect(tool.parameters.parse({ value: 42 }).value).toBe(42);
    expect(tool.parameters.safeParse({ value: true }).success).toBe(false);
  });

  test("基本 oneOf 无 discriminator 时降级为 z.union", () => {
    const tool = mcpToolToToolDefinition(
      "svc",
      {
        inputSchema: {
          properties: {
            value: { oneOf: [{ type: "string" }, { type: "number" }] },
          },
          required: ["value"],
          type: "object",
        },
        name: "echo",
      },
      fakeClient(),
    );

    // 无 discriminator 的 oneOf 同样接受任一分支；与 anyOf 在 Zod 层面无差。
    expect(tool.parameters.safeParse({ value: "x" }).success).toBe(true);
    expect(tool.parameters.safeParse({ value: 1 }).success).toBe(true);
    expect(tool.parameters.safeParse({ value: [] }).success).toBe(false);
  });

  test("oneOf + 共享 discriminator 字段生成 z.discriminatedUnion，跨分支值被拒", () => {
    const tool = mcpToolToToolDefinition(
      "svc",
      {
        inputSchema: {
          properties: {
            payload: {
              oneOf: [
                {
                  properties: {
                    kind: { enum: ["text"] },
                    text: { type: "string" },
                  },
                  required: ["kind", "text"],
                  type: "object",
                },
                {
                  properties: {
                    kind: { enum: ["number"] },
                    num: { type: "number" },
                  },
                  required: ["kind", "num"],
                  type: "object",
                },
              ],
            },
          },
          required: ["payload"],
          type: "object",
        },
        name: "select",
      },
      fakeClient(),
    );

    // 匹配分支 1
    const textPayload = tool.parameters.parse({ payload: { kind: "text", text: "hi" } }) as {
      payload: { kind: string; text: string };
    };
    expect(textPayload.payload.kind).toBe("text");
    // 匹配分支 2
    const numberPayload = tool.parameters.parse({ payload: { kind: "number", num: 7 } }) as {
      payload: { kind: string; num: number };
    };
    expect(numberPayload.payload.num).toBe(7);
    // Discriminator 值不属于任何分支 → 拒
    expect(tool.parameters.safeParse({ payload: { kind: "unknown" } }).success).toBe(false);
  });

  test("嵌套 oneOf(object 内嵌 oneOf)递归构造", () => {
    const tool = mcpToolToToolDefinition(
      "svc",
      {
        inputSchema: {
          properties: {
            inner: {
              properties: {
                shape: { oneOf: [{ type: "string" }, { type: "boolean" }] },
              },
              required: ["shape"],
              type: "object",
            },
          },
          required: ["inner"],
          type: "object",
        },
        name: "wrap",
      },
      fakeClient(),
    );

    const stringShape = tool.parameters.parse({ inner: { shape: "circle" } }) as {
      inner: { shape: string };
    };
    expect(stringShape.inner.shape).toBe("circle");
    const booleanShape = tool.parameters.parse({ inner: { shape: true } }) as {
      inner: { shape: boolean };
    };
    expect(booleanShape.inner.shape).toBe(true);
    expect(tool.parameters.safeParse({ inner: { shape: 123 } }).success).toBe(false);
  });

  test("空 oneOf 数组回退到 z.any()(fail-open)", () => {
    const tool = mcpToolToToolDefinition(
      "svc",
      {
        inputSchema: {
          properties: {
            value: { oneOf: [] },
          },
          required: ["value"],
          type: "object",
        },
        name: "open",
      },
      fakeClient(),
    );

    // 任意值都通过(z.any 语义)
    expect(tool.parameters.safeParse({ value: 1 }).success).toBe(true);
    expect(tool.parameters.safeParse({ value: "x" }).success).toBe(true);
    expect(tool.parameters.safeParse({ value: { complex: true } }).success).toBe(true);
  });

  test("空 anyOf 数组回退到 z.any()(fail-open)", () => {
    const tool = mcpToolToToolDefinition(
      "svc",
      {
        inputSchema: {
          properties: {
            value: { anyOf: [] },
          },
          required: ["value"],
          type: "object",
        },
        name: "open",
      },
      fakeClient(),
    );

    expect(tool.parameters.safeParse({ value: null }).success).toBe(true);
  });

  test("回归:enum / 普通类型路径未被破坏", () => {
    const tool = mcpToolToToolDefinition(
      "svc",
      {
        inputSchema: {
          properties: {
            color: { enum: ["red", "green", "blue"] },
            count: { maximum: 5, minimum: 1, type: "integer" },
            tag: { maxLength: 10, minLength: 1, type: "string" },
          },
          required: ["color", "count"],
          type: "object",
        },
        name: "legacy",
      },
      fakeClient(),
    );

    expect(tool.parameters.parse({ color: "red", count: 3 }).count).toBe(3);
    expect(tool.parameters.safeParse({ color: "purple", count: 3 }).success).toBe(false);
    expect(tool.parameters.safeParse({ color: "red", count: 0 }).success).toBe(false);
  });

  test("oneOf 第二个分支 discriminator 字段非 enum 时降级为 z.union 而非抛错(钉住 try/catch 降级路径)", () => {
    // 设计意图:构造一个 oneOf schema，强制 tryDiscriminatedUnion 走 try/catch 降级路径。
    // - 第一个 object 分支的 kind 是 enum ["a"]，被识别为 discriminator 候选；
    // - 第二个 object 分支的 kind 是 plain string(无 enum)，不是 ZodLiteral/ZodEnum，
    //   Z.discriminatedUnion 在校验该分支时会抛错。
    // 期望:try/catch 捕获后返回 null，jsonSchemaBranchesToZodUnion 降级为 z.union，
    // 而不是把异常向上抛给 mcpToolToToolDefinition。
    // 反向校验:若有人把 `try { ... } catch { return null }` 改成 `throw`,
    // 本测试将在 mcpToolToToolDefinition 调用时直接抛错(测试失败)。
    const tool = mcpToolToToolDefinition(
      "svc",
      {
        inputSchema: {
          properties: {
            payload: {
              oneOf: [
                {
                  properties: {
                    kind: { enum: ["a"], type: "string" },
                    value: { type: "number" },
                  },
                  required: ["kind", "value"],
                  type: "object",
                },
                {
                  properties: {
                    // 关键:plain string,使 z.discriminatedUnion 抛错并被 catch
                    kind: { type: "string" },
                    value: { type: "string" },
                  },
                  required: ["kind", "value"],
                  type: "object",
                },
              ],
            },
          },
          required: ["payload"],
          type: "object",
        },
        name: "fallback",
      },
      fakeClient(),
    );

    // 关键断言:构造调用未抛错(若 catch 改 throw，前面 mcpToolToToolDefinition 已失败)；
    // 且两个分支的值都能通过，证明降级到 z.union 后任一分支匹配即放行。
    expect(tool.parameters.safeParse({ payload: { kind: "a", value: 1 } }).success).toBe(true);
    expect(tool.parameters.safeParse({ payload: { kind: "anything", value: "hello" } }).success).toBe(true);
    // 既不匹配 number 也不匹配 string 的 value → 两个分支均不放行 → 拒绝
    expect(tool.parameters.safeParse({ payload: { kind: "a", value: true } }).success).toBe(false);
  });
});

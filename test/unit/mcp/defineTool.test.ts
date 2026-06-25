/**
 * 工具定义测试。
 *
 * 测试用例:
 *   - 工具 Schema 定义
 *   - 参数验证
 *   - 返回值定义
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type ToolDefinition, defineTool } from "@/tool/types";

describe("defineTool()", () => {
  test("创建 a 有效工具定义", () => {
    const tool = defineTool({
      description: "Read a file from disk",
      execute: async (args) => ({ content: `contents of ${args.path}` }),
      name: "read_file",
      parameters: z.object({
        path: z.string().describe("File path"),
      }),
      permission: "fs.read",
    });

    expect(tool.name).toBe("read_file");
    expect(tool.description).toBe("Read a file from disk");
    expect(tool.permission).toBe("fs.read");
    expect(tool.parameters).toBeDefined();
  });

  test("参数校验通过带有效输入", async () => {
    const tool = defineTool({
      description: "Add two numbers",
      execute: async (args) => args.a + args.b,
      name: "add_numbers",
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
      permission: "math",
    });

    const parsed = tool.parameters.parse({ a: 1, b: 2 });
    const result = await tool.execute(parsed);
    expect(result).toBe(3);
  });

  test("参数校验失败带无效输入", () => {
    const tool = defineTool({
      description: "Greet someone",
      execute: async (args) => `Hello, ${args.name}!`,
      name: "greet",
      parameters: z.object({
        name: z.string(),
      }),
      permission: "social",
    });

    expect(() => tool.parameters.parse({ name: 123 })).toThrow();
    expect(() => tool.parameters.parse({})).toThrow();
  });

  test("执行返回正确结果", async () => {
    const tool = defineTool({
      description: "Echo input",
      execute: async (args) => args.msg,
      name: "echo",
      parameters: z.object({ msg: z.string() }),
      permission: "test",
    });

    const result = await tool.execute({ msg: "hello" });
    expect(result).toBe("hello");
  });

  test("execute catches exceptions", async () => {
    const tool = defineTool({
      description: "Always fails",
      execute: async () => {
        throw new Error("intentional failure");
      },
      name: "fail_tool",
      parameters: z.object({}),
      permission: "test",
    });

    expect(tool.execute({})).rejects.toThrow("intentional failure");
  });

  test("工具定义保留全部字段", () => {
    const schema = z.object({
      encoding: z.string().optional(),
      path: z.string(),
    });

    const tool = defineTool({
      description: "Custom tool",
      execute: async () => null,
      name: "custom",
      parameters: schema,
      permission: "custom.perm",
    });

    expect(tool.name).toBe("custom");
    expect(tool.description).toBe("Custom tool");
    expect(tool.permission).toBe("custom.perm");
    expect(tool.parameters).toBe(schema);
  });
});

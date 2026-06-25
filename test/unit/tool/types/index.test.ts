/**
 * src/tool/types 纯函数单元测试
 *
 * 测试范围:
 *   - defineTool: 工厂恒等函数
 *   - ToolTimeoutError: 超时错误类
 *   - ToolDefinition / ToolContext 接口类型约束
 *
 * 策略: 零外部依赖，纯类型/函数验证。
 */
import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { defineTool, ToolTimeoutError } from "@/tool/types";

// ═══════════════════════════════════════════════════════════════════
// defineTool (identity factory)
// ═══════════════════════════════════════════════════════════════════
describe("defineTool", () => {
  it("应返回传入的同一个对象引用", () => {
    const tool = {
      name: "test_tool",
      description: "测试工具",
      parameters: z.object({ input: z.string() }),
      permission: "test",
      execute: async () => "ok",
    };
    const result = defineTool(tool);
    expect(result).toBe(tool);
  });

  it("应保留所有属性不变", () => {
    const execute = async () => 42;
    const tool = {
      name: "my_tool",
      description: "描述",
      parameters: z.object({}),
      permission: "custom",
      execute,
      timeoutMs: 5000,
    };
    const result = defineTool(tool);
    expect(result.name).toBe("my_tool");
    expect(result.description).toBe("描述");
    expect(result.permission).toBe("custom");
    expect(result.execute).toBe(execute);
    expect(result.timeoutMs).toBe(5000);
  });

  it("应支持 Zod 参数验证 schema", () => {
    const tool = defineTool({
      name: "validated",
      description: "参数验证",
      parameters: z.object({
        required: z.string(),
        optional: z.number().optional(),
      }),
      permission: "v",
      execute: async (args) => args,
    });

    // 参数类型应通过 Zod 解析
    const parsed = tool.parameters.safeParse({ required: "hello" });
    expect(parsed.success).toBe(true);
    const unparsed = tool.parameters.safeParse({});
    expect(unparsed.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ToolTimeoutError
// ═══════════════════════════════════════════════════════════════════
describe("ToolTimeoutError", () => {
  it("应正确设置所有属性", () => {
    const err = new ToolTimeoutError("bash", 30000);
    expect(err.name).toBe("ToolTimeoutError");
    expect(err.code).toBe("TOOL_TIMEOUT");
    expect(err.toolName).toBe("bash");
    expect(err.timeoutMs).toBe(30000);
    expect(err.message).toBe('Tool "bash" timed out after 30000ms');
  });

  it("应支持自定义消息", () => {
    const err = new ToolTimeoutError("webfetch", 10000, "自定义超时消息");
    expect(err.message).toBe("自定义超时消息");
    expect(err.toolName).toBe("webfetch");
    expect(err.timeoutMs).toBe(10000);
  });

  it("应为 Error 实例", () => {
    const err = new ToolTimeoutError("test", 1000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ToolTimeoutError);
  });
});

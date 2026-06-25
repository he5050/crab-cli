/**
 * 工具 Schema 测试。
 *
 * 测试用例:
 *   - ToolParameter 验证（含递归嵌套）
 *   - ToolDefinition 验证
 *   - ToolCallInput 验证（引用 ids.ts ToolCallID）
 *   - ToolResult 验证（引用 ids.ts ToolCallID）
 *   - 边界用例与异常场景
 */
import { describe, expect, test } from "bun:test";
import { ToolCallInput, ToolDefinition, ToolParameter, ToolResult } from "@/schema/tool";

describe("ToolParameter", () => {
  test("字符串类型验证通过", () => {
    const param = { description: "文件路径", type: "string" };
    expect(ToolParameter.safeParse(param).success).toBe(true);
  });

  test("数字类型验证通过", () => {
    const param = { description: "行号", type: "number" };
    expect(ToolParameter.safeParse(param).success).toBe(true);
  });

  test("布尔类型验证通过", () => {
    const param = { description: "是否递归", type: "boolean" };
    expect(ToolParameter.safeParse(param).success).toBe(true);
  });

  test("对象类型验证通过", () => {
    const param = { description: "选项对象", type: "object" };
    expect(ToolParameter.safeParse(param).success).toBe(true);
  });

  test("数组类型验证通过", () => {
    const param = { description: "标签列表", type: "array" };
    expect(ToolParameter.safeParse(param).success).toBe(true);
  });

  test("null 类型验证通过", () => {
    const param = { description: "空值", type: "null" };
    expect(ToolParameter.safeParse(param).success).toBe(true);
  });

  test("拒绝无效类型", () => {
    const param = { type: "file" };
    expect(ToolParameter.safeParse(param).success).toBe(false);
    expect(ToolParameter.safeParse({ type: "integer" }).success).toBe(false);
    expect(ToolParameter.safeParse({ type: "" }).success).toBe(false);
  });

  test("含枚举值", () => {
    const param = { description: "编码格式", enum: ["utf-8", "gbk", "ascii"], type: "string" };
    expect(ToolParameter.safeParse(param).success).toBe(true);
  });

  test("含必填字段列表", () => {
    const param = { description: "地址", required: ["city", "street"], type: "object" };
    expect(ToolParameter.safeParse(param).success).toBe(true);
  });

  test("递归嵌套参数（对象含 properties）", () => {
    const param = {
      description: "配置选项",
      properties: {
        host: { description: "主机名", type: "string" },
        port: { description: "端口号", type: "number" },
      },
      required: ["host"],
      type: "object",
    };
    const result = ToolParameter.safeParse(param);
    expect(result.success).toBe(true);
  });

  test("深层递归嵌套参数", () => {
    const param = {
      description: "服务器配置",
      properties: {
        database: {
          description: "数据库配置",
          properties: {
            host: { description: "数据库主机", type: "string" },
            port: { description: "数据库端口", type: "number" },
          },
          required: ["host"],
          type: "object",
        },
        server: {
          description: "服务器配置",
          properties: {
            name: { description: "服务器名", type: "string" },
          },
          type: "object",
        },
      },
      type: "object",
    };
    const result = ToolParameter.safeParse(param);
    expect(result.success).toBe(true);
  });

  test("拒绝缺少 type 字段", () => {
    expect(ToolParameter.safeParse({ description: "无类型" }).success).toBe(false);
  });
});

describe("ToolDefinition", () => {
  test("完整工具定义验证通过", () => {
    const tool = {
      description: "读取文件内容",
      name: "read_file",
      parameters: {
        path: { description: "文件路径", type: "string" },
        encoding: { description: "编码格式", enum: ["utf-8", "gbk"], type: "string" },
      },
    };
    expect(ToolDefinition.safeParse(tool).success).toBe(true);
  });

  test("无参数的工具定义", () => {
    const tool = { description: "获取当前时间", name: "get_time", parameters: {} };
    expect(ToolDefinition.safeParse(tool).success).toBe(true);
  });

  test("拒绝缺少 description", () => {
    expect(ToolDefinition.safeParse({ name: "test", parameters: {} }).success).toBe(false);
  });

  test("拒绝缺少 name", () => {
    expect(ToolDefinition.safeParse({ description: "测试", parameters: {} }).success).toBe(false);
  });

  test("拒绝缺少 parameters", () => {
    expect(ToolDefinition.safeParse({ description: "测试", name: "test" }).success).toBe(false);
  });
});

describe("ToolCallInput", () => {
  test("合法工具调用", () => {
    const call = {
      input: { command: "ls -la" },
      toolName: "bash",
      tool_use_id: "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    };
    expect(ToolCallInput.safeParse(call).success).toBe(true);
  });

  test("input 可以是任意类型", () => {
    expect(
      ToolCallInput.safeParse({ input: "string", toolName: "bash", tool_use_id: "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV" })
        .success,
    ).toBe(true);
    expect(
      ToolCallInput.safeParse({ input: [1, 2, 3], toolName: "bash", tool_use_id: "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV" })
        .success,
    ).toBe(true);
    expect(
      ToolCallInput.safeParse({ input: null, toolName: "bash", tool_use_id: "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV" })
        .success,
    ).toBe(true);
  });

  test("拒绝非 ToolCallID 格式的 tool_use_id", () => {
    expect(ToolCallInput.safeParse({ input: {}, toolName: "bash", tool_use_id: "invalid" }).success).toBe(false);
    expect(
      ToolCallInput.safeParse({ input: {}, toolName: "bash", tool_use_id: "msg_01ARZ3NDEKTSV4RRFFQ69G5FAV" }).success,
    ).toBe(false);
  });

  test("拒绝缺少必填字段", () => {
    expect(ToolCallInput.safeParse({ input: {}, toolName: "bash" }).success).toBe(false);
    expect(ToolCallInput.safeParse({ input: {}, tool_use_id: "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV" }).success).toBe(false);
  });
});

describe("ToolResult", () => {
  test("成功结果验证", () => {
    const result = {
      content: "文件内容",
      is_error: false,
      tool_use_id: "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    };
    expect(ToolResult.safeParse(result).success).toBe(true);
  });

  test("错误结果验证", () => {
    const result = {
      content: "命令执行失败",
      is_error: true,
      tool_use_id: "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    };
    expect(ToolResult.safeParse(result).success).toBe(true);
  });

  test("is_error 默认为 false", () => {
    const result = ToolResult.parse({ content: "成功", tool_use_id: "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(result.is_error).toBe(false);
  });

  test("拒绝非 ToolCallID 格式的 tool_use_id", () => {
    expect(ToolResult.safeParse({ content: "ok", tool_use_id: "invalid" }).success).toBe(false);
  });

  test("拒绝缺少必填字段", () => {
    expect(ToolResult.safeParse({ content: "ok" }).success).toBe(false);
    expect(ToolResult.safeParse({ tool_use_id: "tool_01ARZ3NDEKTSV4RRFFQ69G5FAV" }).success).toBe(false);
  });
});

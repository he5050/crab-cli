/**
 * 工具 Schema
 *
 * 职责:
 *   - 定义工具定义、调用和结果的验证结构
 *   - 支持 JSON Schema 兼容的工具参数定义
 *   - 提供工具调用输入和结果的类型安全
 *
 * 模块功能:
 *   - 定义工具参数 Schema(ToolParameter):JSON Schema 兼容的参数定义
 *   - 定义工具定义 Schema(ToolDefinition):name、description、parameters
 *   - 定义工具调用输入 Schema(ToolCallInput):toolName、input、tool_use_id
 *   - 定义工具结果 Schema(ToolResult):tool_use_id、content、is_error
 *
 * 使用场景:
 *   - 验证 MCP 工具定义
 *   - 验证工具调用请求参数
 *   - 验证工具执行结果
 *   - 构建工具调用消息
 *
 * 边界:
 *   1. 仅定义 schema，不涉及工具执行逻辑
 *   2. 工具执行由外部模块实现
 *   3. 使用 Zod 进行运行时类型验证
 *   4. 支持 JSON Schema 兼容的参数结构
 *
 * 流程:
 *   1. 定义工具参数结构(类型、描述、枚举、属性)
 *   2. 定义工具定义结构(名称、描述、参数)
 *   3. 定义工具调用输入结构(工具名、输入、ID)
 *   4. 定义工具结果结构(ID、内容、错误标记)
 */
import { z } from "zod";
import { ToolCallID } from "@/schema/ids";

/** 工具参数 Schema — 通用 JSON Schema 兼容 */
export const ToolParameter: z.ZodType<{
  type: "string" | "number" | "boolean" | "array" | "object" | "null";
  description?: string;
  enum?: unknown[];
  properties?: Record<string, any>;
  required?: string[];
}> = z.object({
  description: z.string().optional(),
  enum: z.array(z.any()).optional(),
  properties: z
    .record(
      z.string(),
      z.lazy(() => ToolParameter),
    )
    .optional(),
  required: z.array(z.string()).optional(),
  type: z.enum(["string", "number", "boolean", "array", "object", "null"]),
});
export type ToolParameter = z.infer<typeof ToolParameter>;

/** 工具定义 Schema */
export const ToolDefinition = z
  .object({
    description: z.string(),
    name: z.string(),
    parameters: z.record(z.string(), ToolParameter),
  })
  .strict();
export type ToolDefinition = z.infer<typeof ToolDefinition>;

/** 工具调用 Schema */
export const ToolCallInput = z
  .object({
    input: z.unknown(),
    toolName: z.string(),
    tool_use_id: ToolCallID,
  })
  .strict();
export type ToolCallInput = z.infer<typeof ToolCallInput>;

/** 工具结果 Schema */
export const ToolResult = z
  .object({
    content: z.string(),
    is_error: z.boolean().default(false),
    tool_use_id: ToolCallID,
  })
  .strict();
export type ToolResult = z.infer<typeof ToolResult>;

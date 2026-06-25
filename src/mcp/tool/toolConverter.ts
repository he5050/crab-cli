/**
 * MCP 工具转换器 — 将 MCP 工具定义转换为内部格式。
 *
 * 职责:
 *   - 封装 MCP 工具到内部 ToolDefinition 的转换逻辑
 *   - 将 JSON Schema 转换为 Zod 类型定义
 *   - 生成带命名空间前缀的工具名称(避免冲突)
 *
 * 模块功能:
 *   - mcpToolToToolDefinition:将 MCP 工具定义转换为内部 ToolDefinition 格式
 *   - jsonSchemaToZodType:将 JSON Schema 类型转换为 Zod 类型
 *   - jsonSchemaToZodObject:将 JSON Schema 对象转换为 Zod 对象
 *   - jsonSchemaBranchesToZodUnion:将 oneOf/anyOf 分支数组转换为 z.union / z.discriminatedUnion
 *
 * 使用场景:
 *   - MCP Client 发现工具后需要转换为内部格式时
 *   - 需要将 MCP 的 JSON Schema 参数定义转换为 Zod 校验类型时
 *
 * 边界:
 *   1. 纯转换函数，无状态管理
 *   2. 工具名称格式为 `${serverName}_${toolName}`
 *   3. oneOf 优先尝试 z.discriminatedUnion(按首个 object 分支的 discriminator 字段)，失败则降级为 z.union
 *   4. 任意 oneOf/anyOf 数组为空时回退到 z.any()(fail-open)，调用方需自行兜底
 *   5. 无效的正则表达式模式会被忽略
 *   6. 不解析 $ref/allOf/definitions(保持本地工具 schema 简洁，避免远程拉取)
 *
 * 流程:
 *   1. 接收 MCP 工具定义(包含 name、description、inputSchema)
 *   2. 将 inputSchema 从 JSON Schema 转换为 Zod 类型
 *   3. 生成带服务器前缀的工具名称
 *   4. 返回内部 ToolDefinition 格式
 */

import { z } from "zod";
import { createLogger } from "@/core/logging/logger";
import type { ToolDefinition } from "@/tool/types";
import type { McpClient } from "../client/mcpClient";
import { getMcpErrorMessage } from "../core/errors";

const log = createLogger("mcp:tool-converter");
import { classifyMcpToolRisk, getMcpToolPermissionNamespace } from "./riskClassification";

interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchemaObject;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: JsonSchemaObject[];
  anyOf?: JsonSchemaObject[];
}

/**
 * 在 oneOf/anyOf 全部为 object 分支、且共享同一 discriminator 字段(值字面量不重复)时，
 * 构造 z.discriminatedUnion 以获得更严格的语义(值匹配唯一分支即合法)。
 *
 * 返回 null 表示当前 branches 集合不满足 discriminatedUnion 条件，应使用 z.union 降级。
 */
function tryDiscriminatedUnion(branches: z.ZodTypeAny[], discriminator: string): z.ZodTypeAny | null {
  if (branches.length < 2) {
    return null;
  }
  for (const branch of branches) {
    if (!(branch instanceof z.ZodObject)) {
      return null;
    }
  }
  try {
    // Zod 在所有分支共享同一 discriminator 且每个分支该字段为 z.literal 时接受。
    return z.discriminatedUnion(discriminator, branches as [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]]);
  } catch (error) {
    log.debug("MCP schema discriminatedUnion conversion failed, falling back to union", {
      discriminator,
      error: getMcpErrorMessage(error),
    });
    return null;
  }
}

function getDiscriminatorCandidate(branch: JsonSchemaObject): [string, unknown] | null {
  if (branch.type !== "object") {
    return null;
  }
  const props = branch.properties ?? {};
  for (const [fieldName, fieldSchema] of Object.entries(props)) {
    if (fieldSchema && Array.isArray(fieldSchema.enum) && fieldSchema.enum.length === 1) {
      return [fieldName, fieldSchema.enum[0]];
    }
  }
  return null;
}

function canUseDiscriminator(branches: JsonSchemaObject[], discriminator: string): boolean {
  const seen = new Set<unknown>();
  for (const branch of branches) {
    if (branch.type !== "object") {
      return false;
    }
    const fieldSchema = branch.properties?.[discriminator];
    if (!fieldSchema || !Array.isArray(fieldSchema.enum) || fieldSchema.enum.length !== 1) {
      return false;
    }
    const value = fieldSchema.enum[0];
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
  }
  return true;
}

/**
 * 将 oneOf/anyOf 分支数组转换为 Zod 联合类型。
 *
 * - 空数组回退到 z.any()，与现有 default 分支语义保持一致(fail-open)。
 * - 全部为 object 且共享同一 discriminator 字面量时，尝试 z.discriminatedUnion。
 * - 其他情况使用 z.union(任一分支匹配即通过)，覆盖 oneOf 在 Zod 中无原生对应的语义缺口。
 */
function jsonSchemaBranchesToZodUnion(
  branches: JsonSchemaObject[] | undefined,
  preferDiscriminator: boolean,
): z.ZodTypeAny {
  if (!branches || branches.length === 0) {
    return z.any();
  }

  const converted = branches.map((branch) => jsonSchemaToZodType(branch));

  if (converted.length === 1) {
    return converted[0]!;
  }

  if (preferDiscriminator) {
    // OneOf:尝试找到共享 discriminator(首个 object 分支的 enum 字面量字段)以收紧语义。
    for (const branch of branches) {
      if (!branch || typeof branch !== "object") {
        continue;
      }
      const candidate = getDiscriminatorCandidate(branch);
      if (candidate) {
        const [fieldName] = candidate;
        if (!canUseDiscriminator(branches, fieldName)) {
          break;
        }
        const discriminated = tryDiscriminatedUnion(converted, fieldName);
        if (discriminated) {
          return discriminated;
        }
        break;
      }
      // 仅以首个 object 分支的 enum 字段作为候选；找到后即停止(不跨分支探测，避免误命中)。
      break;
    }
  }

  // AnyOf 语义:任一分支匹配即通过；oneOf 无 discriminator 时同样降级。
  return z.union(converted as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function jsonSchemaToZodType(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.any();
  }

  const jsonSchema = schema as JsonSchemaObject;

  // 复合类型优先于 type 字段:JSON Schema 允许 oneOf/anyOf 与 type 共存，
  // 但 MCP 工具实际形态通常是顶层 oneOf/anyOf + 隐含 type。优先处理复合以避免丢失。
  if (Array.isArray(jsonSchema.oneOf) && jsonSchema.oneOf.length > 0) {
    return jsonSchemaBranchesToZodUnion(jsonSchema.oneOf, true);
  }
  if (Array.isArray(jsonSchema.anyOf) && jsonSchema.anyOf.length > 0) {
    return jsonSchemaBranchesToZodUnion(jsonSchema.anyOf, false);
  }

  if (Array.isArray(jsonSchema.enum) && jsonSchema.enum.length > 0) {
    const literals = jsonSchema.enum.map((value: any) => z.literal(value));
    return literals.length === 1
      ? literals[0]!
      : z.union(literals as [z.ZodLiteral<any>, z.ZodLiteral<any>, ...z.ZodLiteral<any>[]]);
  }

  switch (jsonSchema.type) {
    case "string": {
      let stringSchema = z.string();
      if (typeof jsonSchema.minLength === "number") {
        stringSchema = stringSchema.min(jsonSchema.minLength);
      }
      if (typeof jsonSchema.maxLength === "number") {
        stringSchema = stringSchema.max(jsonSchema.maxLength);
      }
      if (jsonSchema.pattern) {
        try {
          stringSchema = stringSchema.regex(new RegExp(jsonSchema.pattern));
        } catch (error) {
          log.debug("MCP schema pattern is invalid, keeping base string validation", {
            error: getMcpErrorMessage(error),
            pattern: jsonSchema.pattern,
          });
        }
      }
      return stringSchema;
    }
    case "number": {
      let numberSchema = z.number();
      if (typeof jsonSchema.minimum === "number") {
        numberSchema = numberSchema.min(jsonSchema.minimum);
      }
      if (typeof jsonSchema.maximum === "number") {
        numberSchema = numberSchema.max(jsonSchema.maximum);
      }
      return numberSchema;
    }
    case "integer": {
      let integerSchema = z.number().int();
      if (typeof jsonSchema.minimum === "number") {
        integerSchema = integerSchema.min(jsonSchema.minimum);
      }
      if (typeof jsonSchema.maximum === "number") {
        integerSchema = integerSchema.max(jsonSchema.maximum);
      }
      return integerSchema;
    }
    case "boolean": {
      return z.boolean();
    }
    case "array": {
      return z.array(jsonSchemaToZodType(jsonSchema.items));
    }
    case "object": {
      return jsonSchemaToZodObject(jsonSchema);
    }
    default: {
      return z.any();
    }
  }
}

function jsonSchemaToZodObject(schema: JsonSchemaObject): z.ZodObject<any> {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, value] of Object.entries(properties)) {
    const propertySchema = jsonSchemaToZodType(value);
    shape[key] = required.has(key) ? propertySchema : propertySchema.optional();
  }

  let objectSchema = z.object(shape);

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    objectSchema = objectSchema.catchall(jsonSchemaToZodType(schema.additionalProperties));
  } else if (schema.additionalProperties === true) {
    objectSchema = objectSchema.catchall(z.any());
  }

  return objectSchema;
}

/**
 * 将 MCP 工具定义转换为内部 ToolDefinition 格式。
 * MCP 工具用 `${serverName}_${toolName}` 作为 name 以避免冲突。
 *
 * @param serverName - MCP 服务器名称
 * @param tool - MCP 工具定义
 * @param client - MCP 客户端实例(用于执行工具调用)
 * @returns 内部 ToolDefinition
 */
export function mcpToolToToolDefinition(
  serverName: string,
  tool: { name: string; description?: string; inputSchema?: unknown },
  client: McpClient,
): ToolDefinition<any> {
  const fullName = `${serverName}_${tool.name}`;
  const description = tool.description ?? `MCP tool: ${tool.name}`;

  // MCP 返回的 inputSchema 是 JSON Schema，尽量保留其参数结构与基础约束。
  const parameters = jsonSchemaToZodObject(
    tool.inputSchema && typeof tool.inputSchema === "object" ? (tool.inputSchema as JsonSchemaObject) : {},
  );

  // 高风险工具(exec/shell/delete 等)走 "mcp.sensitive.*" 命名空间，
  // 命中 permissionsConfig 中 `mcp.sensitive.* → deny` 的默认规则；
  // 中/低风险走普通 `mcp.*` 命名空间，命中默认 ask 规则。
  const permission = getMcpToolPermissionNamespace(classifyMcpToolRisk(tool.name), serverName, tool.name);

  return {
    description,
    execute: async (args: Record<string, unknown>) => client.callTool(tool.name, args),
    name: fullName,
    parameters,
    permission,
  };
}

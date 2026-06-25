/**
 * 工具调用辅助函数 — 参数归一化、结果格式化、JSON 解析。
 *
 * 从 types/handler.ts 提取，归属 message 子域（工具调用参数/结果的消息层处理）。
 */
import type { JSONValue, ToolResultPart } from "ai";

type ToolResultOutput = ToolResultPart["output"];

export function toToolResultOutput(output: unknown, isError: boolean): ToolResultOutput {
  if (isError) {
    const msg = typeof output === "string" ? output : JSON.stringify(output);
    return { type: "error-text", value: msg };
  }
  if (typeof output === "string") {
    return { type: "text", value: output };
  }
  return { type: "text", value: JSON.stringify(output as JSONValue) };
}

export function tryParseToolArgsJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function normalizeToolCallArgs(args: unknown): unknown {
  let current = args;
  // 限制 3 层嵌套解析:实测 AI SDK 最多产生 2 层 { arguments: { arguments: ... } } 包装，
  // 3 层已是安全上限，避免恶意或畸形输入导致无限循环。
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current === "string") {
      const parsed = tryParseToolArgsJson(current);
      if (parsed === current) {
        break;
      }
      current = parsed;
      continue;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      break;
    }
    const record = current as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "arguments") {
      current = record.arguments;
      continue;
    }
    break;
  }
  return current;
}

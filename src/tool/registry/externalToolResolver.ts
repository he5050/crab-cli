/**
 * 外部工具名称解析。
 *
 * 将用户显式指定的外部工具名解析为可调用工具名。这里只做纯解析:
 * - 唯一匹配:调用方可加入当前会话 allowedTools
 * - 多匹配:调用方返回候选事实，由模型继续缩小查询或重新发现
 * - 未匹配:调用方应走 tool-search 或返回明确失败
 */
import { getBuiltinGroupName } from "./toolRegistry";
import { getUsageBoost } from "@/tool/usageMemory";
import { normalizeToolRef } from "./toolRefUtils";

/** 外部工具解析结果：唯一匹配、多候选或未找到 */
export type ExternalToolResolution =
  | { status: "unique"; toolName: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "not_found"; query: string };

/** 从用户输入中解析所有显式外部工具引用（支持 /tool:、mcp:// 等格式） */
export function resolveExplicitExternalToolReference(
  input: string,
  tools: Readonly<Record<string, unknown>>,
): ExternalToolResolution[] {
  const refs = new Set<string>();
  const patterns = [
    /\/(?:tool|mcp):([a-z0-9._:-]+)/gi,
    /(?:tool|mcp):\/\/([a-z0-9._:-]+)/gi,
    /\buse\s+([a-z0-9._:-]+)\s+(?:tool|mcp)\b/gi,
    /\b用\s*([a-z0-9._:-]+)\s*(?:tool|工具|mcp)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const ref = match[1]?.trim();
      if (ref) {
        refs.add(ref);
      }
    }
  }
  return [...refs].map((ref) => resolveExternalToolName(ref, tools));
}

/** 将外部工具查询解析为唯一匹配、多候选或未找到 */
export function resolveExternalToolName(
  query: string,
  tools: Readonly<Record<string, unknown>>,
): ExternalToolResolution {
  const normalizedQuery = normalizeToolRef(query);
  if (!normalizedQuery) {
    return { query, status: "not_found" };
  }

  const externalNames = Object.keys(tools)
    .filter((name) => !getBuiltinGroupName(name))
    .toSorted();

  const exact = externalNames.filter((name) => normalizeToolRef(name) === normalizedQuery);
  if (exact.length === 1) {
    return { status: "unique", toolName: exact[0]! };
  }
  if (exact.length > 1) {
    return { candidates: exact, status: "ambiguous" };
  }

  const suffix = externalNames.filter((name) => {
    const normalizedName = normalizeToolRef(name);
    return normalizedName.endsWith(`_${normalizedQuery}`);
  });
  if (suffix.length === 1) {
    return { status: "unique", toolName: suffix[0]! };
  }
  if (suffix.length > 1) {
    return { candidates: suffix, status: "ambiguous" };
  }

  const contains = externalNames
    .filter((name) => normalizeToolRef(name).includes(normalizedQuery))
    .toSorted(
      (a, b) => getUsageBoost("external_tool", b, query).score - getUsageBoost("external_tool", a, query).score,
    );
  if (contains.length === 1) {
    return { status: "unique", toolName: contains[0]! };
  }
  if (contains.length > 1) {
    return { candidates: contains, status: "ambiguous" };
  }

  return { query, status: "not_found" };
}

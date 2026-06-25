/**
 * 工具模糊搜索 — 按名称和描述匹配已注册工具。
 */
import { getRegisteredTools } from "../registry/toolRegistry";
import type { ToolSearchInfo } from "../types";

/**
 * 模糊搜索工具
 * 支持按名称和描述匹配
 */
/** searchTools 的实现 */
export function searchTools(query: string, tools?: Readonly<Record<string, ToolSearchInfo>>): ToolSearchInfo[] {
  const toolMap = tools ?? getRegisteredTools();
  const lowerQuery = query.toLowerCase();
  const results: { tool: ToolSearchInfo; score: number }[] = [];

  for (const key in toolMap) {
    const tool = toolMap[key];
    if (!tool) {
      continue;
    }

    const nameLower = tool.name.toLowerCase();
    const descLower = tool.description.toLowerCase();

    // 完全匹配名称
    if (nameLower === lowerQuery) {
      results.push({ score: 100, tool });
      continue;
    }

    // 名称前缀匹配
    if (nameLower.startsWith(lowerQuery)) {
      results.push({ score: 80, tool });
      continue;
    }

    // 名称包含
    if (nameLower.includes(lowerQuery)) {
      results.push({ score: 60, tool });
      continue;
    }

    // 描述包含
    if (descLower.includes(lowerQuery)) {
      results.push({ score: 40, tool });
      continue;
    }

    // 逐字符模糊匹配
    if (fuzzyMatch(lowerQuery, nameLower)) {
      results.push({ score: 20, tool });
      continue;
    }
  }

  // 按分数降序排列
  results.sort((a, b) => b.score - a.score);
  return results.map((r) => r.tool);
}

/** 简单逐字符模糊匹配 */
function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      qi++;
    }
  }
  return qi === query.length;
}

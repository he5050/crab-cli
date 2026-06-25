/**
 * 工具发现工具 — 搜索和发现可用工具。
 *
 * 职责:
 *   - 搜索可用工具
 *   - 按分组筛选工具
 *   - 列出所有已注册工具
 *   - 显示工具详细信息
 *
 * 模块功能:
 *   - toolSearchTool: 工具搜索工具定义
 *   - 按名称/描述搜索
 *   - 按分组筛选
 *   - 显示完整参数 schema
 *
 * 使用场景:
 *   - AI 需要发现可用工具
 *   - 了解某个功能对应的工具
 *   - 延迟加载工具 schema
 *   - 工具数量很多时按需搜索
 *
 * 边界:
 *   1. 权限:tool_search
 *   2. 支持按名称、描述、分组搜索
 *   3. 可列出所有已注册工具
 *   4. 支持显示完整参数 schema
 *   5. 用于延迟加载/发现工具
 *
 * 流程:
 *   1. 接收搜索参数
 *   2. 获取已注册工具列表
 *   3. 根据查询条件筛选
 *   4. 返回匹配的工具信息
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import {
  getBuiltinToolGroups,
  getRegisteredTools,
  isBuiltinTool,
  isMcpToolNameDisabled,
} from "@/tool/registry/toolRegistry";
import { searchTools } from "@/tool/executor/toolExecutor";
import { createLogger } from "@/core/logging/logger";
import { type UsageBoost, getUsageBoost, getUsageCandidates } from "@/tool/usageMemory";

const log = createLogger("tool:tool_search");

/** 工具搜索工具：搜索和发现可用工具 */
export const toolSearchTool = defineTool({
  description:
    "搜索和发现可用的工具。" +
    "当需要了解系统提供了哪些工具、某个功能对应哪个工具时使用。" +
    "支持按名称、描述、分组搜索。" +
    "返回工具名称、描述、权限和参数概要。",
  execute: async ({ query, listAll, group, verbose }) => {
    try {
      const tools = getRegisteredTools();
      const groups = getBuiltinToolGroups();

      if (listAll) {
        // 列出所有工具
        const toolList = Object.values(tools).map((t) => ({
          builtin: isBuiltinTool(t.name),
          description: t.description.slice(0, 100),
          group: groups.find((g) => g.tools.includes(t.name))?.name ?? "custom",
          name: t.name,
          permission: t.permission,
        }));

        return {
          action: "list_all",
          groups: groups.map((g) => ({ name: g.name, tools: g.tools })),
          success: true,
          tools: toolList,
          total: toolList.length,
        };
      }

      if (group) {
        // 按分组筛选
        const targetGroup = groups.find((g) => g.name === group);
        if (!targetGroup) {
          const groupNames = groups.map((g) => g.name);
          return { error: `分组不存在: ${group}。可用分组: ${groupNames.join(", ")}`, success: false };
        }

        const groupTools = targetGroup.tools.map((name) => {
          const t = tools[name];
          return t
            ? {
                description: t.description.slice(0, 100),
                name: t.name,
                permission: t.permission,
                ...(verbose && { parameters: summarizeSchema(t.parameters) }),
              }
            : { description: "未注册", name };
        });

        return {
          action: "search_by_group",
          group: targetGroup.name,
          success: true,
          tools: groupTools,
          total: groupTools.length,
        };
      }

      if (query) {
        // 搜索工具
        const results = withUsageMemoryCandidates(searchTools(query), query, tools).toSorted(
          (a, b) => b.usageBoost.score - a.usageBoost.score,
        );
        const searchResults = results.map((t) => ({
          builtin: isBuiltinTool(t.tool.name),
          description: t.tool.description.slice(0, 100),
          name: t.tool.name,
          permission: t.tool.permission,
          ...(t.usageBoost.score > 0 && { usageBoost: t.usageBoost.score, usageReasons: t.usageBoost.reasons }),
          ...(verbose && { parameters: summarizeSchema(t.tool.parameters) }),
        }));

        return {
          action: "search",
          query,
          success: true,
          tools: searchResults,
          total: searchResults.length,
        };
      }

      // 默认:返回分组摘要
      return {
        action: "summary",
        groups: groups.map((g) => ({
          name: g.name,
          toolCount: g.tools.length,
          tools: g.tools,
        })),
        message: "使用 query 参数搜索工具，或 listAll=true 列出所有工具",
        success: true,
        totalGroups: groups.length,
        totalTools: Object.keys(tools).length,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`工具搜索失败`, { error: msg });
      return { error: msg, success: false };
    }
  },
  name: "tool-search",
  parameters: z.object({
    /** 按分组筛选 */
    group: z.string().optional().describe("按工具分组筛选(如 filesystem, terminal, search, websearch)"),
    /** 列出所有工具 */
    listAll: z.boolean().optional().describe("列出所有已注册的工具(默认 false)"),
    /** 搜索查询(工具名或描述关键词) */
    query: z.string().optional().describe("搜索查询(工具名或描述关键词)"),
    /** 是否显示完整参数 schema */
    verbose: z.boolean().optional().describe("是否显示完整参数 schema(默认 false，只显示摘要)"),
  }),
  permission: "tool_search",
  builtin: true,
});

function withUsageMemoryCandidates(
  baseResults: ReturnType<typeof searchTools>,
  query: string,
  tools: Readonly<Record<string, ReturnType<typeof getRegisteredTools>[string]>>,
): { tool: ReturnType<typeof searchTools>[number]; usageBoost: UsageBoost }[] {
  const byName = new Map<string, { tool: ReturnType<typeof searchTools>[number]; usageBoost: UsageBoost }>();
  for (const tool of baseResults) {
    const usageBoost = isBuiltinTool(tool.name)
      ? { reasons: [], score: 0 }
      : getUsageBoost("external_tool", tool.name, query);
    byName.set(tool.name, { tool, usageBoost });
  }

  for (const candidate of getUsageCandidates("external_tool", query)) {
    if (byName.has(candidate.name)) {
      continue;
    }
    const tool = tools[candidate.name];
    if (!tool) {
      continue;
    }
    if (isBuiltinTool(tool.name) || isMcpToolNameDisabled(tool.name)) {
      continue;
    }
    byName.set(tool.name, { tool, usageBoost: candidate.boost });
  }

  return [...byName.values()];
}

/** 提取 schema 的参数名列表 */
function summarizeSchema(schema: any): Record<string, string> {
  try {
    const shape = schema?.shape ?? schema?._def?.shape?.value;
    if (!shape) {
      return {};
    }
    const summary: Record<string, string> = {};
    for (const [key, val] of Object.entries(shape)) {
      const zodType = val as any;
      const typeName = zodType?._def?.typeName ?? "unknown";
      const isOptional = typeName.includes("Optional") || zodType?.isOptional?.();
      summary[key] = `${typeName.replace("Zod", "").toLowerCase()}${isOptional ? "?" : ""}`;
    }
    return summary;
  } catch {
    return {};
  }
}

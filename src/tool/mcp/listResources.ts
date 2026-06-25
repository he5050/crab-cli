/**
 * MCP 资源列表工具 — 列出所有 MCP 服务器提供的资源。
 *
 * 职责:
 *   - 遍历已连接的 MCP 服务器
 *   - 调用 client.listResources() 获取资源列表
 *   - 支持按服务器名称过滤
 *   - 返回格式化的资源列表
 *
 * 使用场景:
 *   - AI 需要了解可用的 MCP 资源
 *   - 浏览 MCP 服务器提供的文件、数据等
 *
 * 边界:
 *   1. 仅列出已连接服务器的资源
 *   2. 单个服务器失败不影响其他服务器
 *   3. 权限:mcp.read
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:mcp-list-resources");

/** MCP 资源列表工具 */
export const listMcpResourcesTool = defineTool({
  name: "mcp_list_resources",
  description:
    "列出所有已连接 MCP 服务器提供的资源。" +
    "可指定服务器名称仅列出该服务器的资源。" +
    "资源包括文件、数据、配置等由 MCP 服务器暴露的内容。",
  parameters: z.object({
    server: z.string().optional().describe("指定 MCP 服务器名称，不指定则列出所有已连接服务器的资源"),
  }),
  permission: "mcp.read",
  builtin: true,
  execute: async (args) => {
    log.info("列出 MCP 资源", { server: args.server });

    // 延迟导入 runtime，避免循环依赖
    const { getMcpRuntimeResources } = await import("@/mcp/manager/runtime");

    try {
      const allResources = await getMcpRuntimeResources();

      // 按服务器名称过滤
      const filtered = args.server ? allResources.filter((r) => r.server === args.server) : allResources;

      if (filtered.length === 0) {
        const scope = args.server ? `服务器 "${args.server}"` : "已连接的服务器";
        return `${scope} 没有可用的资源。`;
      }

      // 按服务器分组格式化输出
      const byServer = new Map<string, typeof filtered>();
      for (const resource of filtered) {
        const list = byServer.get(resource.server) ?? [];
        list.push(resource);
        byServer.set(resource.server, list);
      }

      const lines: string[] = ["MCP 资源列表:", ""];

      for (const [serverName, resources] of byServer) {
        lines.push(`【${serverName}】(${resources.length} 个资源):`);
        for (const resource of resources) {
          const desc = resource.description ? ` — ${resource.description}` : "";
          const mime = resource.mimeType ? ` [${resource.mimeType}]` : "";
          lines.push(`  • ${resource.name} (${resource.uri})${mime}${desc}`);
        }
        lines.push("");
      }

      return lines.join("\n");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`列出 MCP 资源失败: ${msg}`);
      return `列出 MCP 资源失败: ${msg}`;
    }
  },
});

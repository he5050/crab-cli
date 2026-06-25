/**
 * MCP 资源读取工具 — 读取指定 MCP 服务器上的资源内容。
 *
 * 职责:
 *   - 通过 URI 读取 MCP 服务器上的资源
 *   - 调用 client.readResource(uri) 获取资源内容
 *   - 返回资源内容
 *
 * 使用场景:
 *   - AI 需要读取 MCP 服务器上的文件、数据
 *   - 获取 MCP 资源的详细内容
 *
 * 边界:
 *   1. 需要指定服务器名称和资源 URI
 *   2. 服务器必须已连接
 *   3. 权限:mcp.read
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:mcp-read-resource");

/** MCP 资源读取工具 */
export const readMcpResourceTool = defineTool({
  name: "mcp_read_resource",
  description:
    "读取指定 MCP 服务器上的资源内容。" +
    "需要提供服务器名称和资源 URI。" +
    "资源 URI 可通过 mcp_list_resources 工具获取。",
  parameters: z.object({
    server: z.string().describe("MCP 服务器名称"),
    uri: z.string().describe("资源 URI"),
  }),
  permission: "mcp.read",
  builtin: true,
  execute: async (args) => {
    log.info("读取 MCP 资源", { server: args.server, uri: args.uri });

    // 延迟导入 runtime，避免循环依赖
    const { readMcpRuntimeResource } = await import("@/mcp/manager/runtime");

    try {
      const result = await readMcpRuntimeResource(args.server, args.uri);

      // MCP readResource 返回 { contents: [...] } 结构
      if (result && typeof result === "object" && "contents" in result) {
        const contents = (result as { contents: unknown[] }).contents;
        if (Array.isArray(contents) && contents.length > 0) {
          const parts: string[] = [];
          for (const content of contents) {
            if (content && typeof content === "object") {
              const c = content as Record<string, unknown>;
              const text = typeof c.text === "string" ? c.text : JSON.stringify(c, null, 2);
              const uri = typeof c.uri === "string" ? c.uri : args.uri;
              const mimeType = typeof c.mimeType === "string" ? c.mimeType : undefined;
              parts.push(`URI: ${uri}${mimeType ? ` [${mimeType}]` : ""}\n\n${text}`);
            } else if (typeof content === "string") {
              parts.push(content);
            }
          }
          return parts.join("\n\n---\n\n");
        }
      }

      // 兜底:直接返回序列化结果
      return typeof result === "string" ? result : JSON.stringify(result, null, 2);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`读取 MCP 资源失败: ${msg}`);
      return `读取 MCP 资源失败: ${msg}`;
    }
  },
});

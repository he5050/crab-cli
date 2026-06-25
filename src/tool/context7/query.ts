/**
 * Context7 query-docs 工具 — 使用库 ID 获取库的精准文档片段
 *
 * 职责:
 *   - 定义 query-docs 工具的参数模式
 *   - 执行库文档查询操作
 *   - 返回结构化的文档片段结果
 *
 * 模块功能:
 *   - context7QueryDocsTool:query-docs 工具定义(Zod schema + execute 函数)
 *
 * 使用场景:
 *   - 根据库 ID(如 npm:react)获取官方文档
 *   - 获取与用户问题相关的文档片段
 *   - 支持指定版本号获取特定版本的文档
 *
 * 边界:
 * 1. libraryId 必须是 Context7 兼容格式(npm:xxx, github:xxx 等)
 * 2. 返回的文档片段包含标题、内容和原文链接
 * 3. 需要 web.fetch 权限才能执行
 *
 * 流程:
 * 1. 验证并解析工具参数(libraryId, query, version)
 * 2. 调用 client.queryLibraryDocs 获取文档
 * 3. 格式化返回结果(status, fragments, libraryId, query)
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { queryLibraryDocs } from "@/tool/context7/client";
import { createLogger } from "@/core/logging/logger";
import type { Context7DocsResult } from "@/tool/context7/types";

const log = createLogger("context7:query");

const QueryDocsSchema = z.object({
  libraryId: z
    .string()
    .describe('精确的 Context7 兼容库 ID，例如: "npm:react", "github:facebook/react", "/mongodb/docs"'),
  query: z.string().describe('问题或任务，用于获取相关文档，例如: "useEffect hook example", "how to configure router"'),
  version: z.string().optional().describe("库的版本号(可选，默认使用最新版本)"),
});

/** Context7 query-docs 工具 — 使用库 ID 获取精准文档片段 */
export const context7QueryDocsTool = defineTool({
  description:
    "使用 Context7 兼容的库 ID 获取库的精准文档片段。返回结构化的文档内容(标题、代码片段、原文链接)，用于基于最新官方文档回答技术问题。",
  execute: async (args, context): Promise<Context7DocsResult> => {
    try {
      context?.metadata?.("正在查询文档...", {
        libraryId: args.libraryId,
        query: args.query,
      });

      const result = await queryLibraryDocs(args.libraryId, args.query, args.version);

      context?.metadata?.("文档查询完成", {
        fragmentCount: result.fragments.length,
        libraryId: result.libraryId,
      });

      return {
        fragments: result.fragments,
        libraryId: result.libraryId,
        query: result.query,
        status: "ok",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("查询文档失败:", { error: errorMsg });
      return {
        error: errorMsg,
        status: "error",
      };
    }
  },
  name: "context7-query-docs",
  parameters: QueryDocsSchema,
  permission: "web.fetch",
  builtin: true,
});

/**
 * Context7 resolve-library-id 工具 — 将通用库名称解析为 Context7 兼容的库 ID
 *
 * 职责:
 *   - 定义 resolve-library-id 工具的参数模式
 *   - 执行库名称到库 ID 的解析操作
 *   - 返回解析后的库 ID 和可选的库列表
 *
 * 模块功能:
 *   - context7ResolveLibraryIdTool:resolve-library-id 工具定义(Zod schema + execute 函数)
 *
 * 使用场景:
 *   - 将通用库名称(如 react, vue)解析为精确的 Context7 ID
 *   - 在查询文档前获取准确的 libraryId
 *   - 获取库的版本信息和元数据
 *
 * 边界:
 * 1. libraryName 可以是任意库名称或关键词
 * 2. 可选参数 query 用于按相关性排序结果
 * 3. 需要 web.fetch 权限才能执行
 *
 * 流程:
 * 1. 验证并解析工具参数(libraryName, query, version)
 * 2. 调用 client.resolveLibraryId 解析库 ID
 * 3. 格式化返回结果(status, libraryId, libraries)
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { resolveLibraryId } from "@/tool/context7/client";
import { createLogger } from "@/core/logging/logger";
import type { Context7ResolveResult } from "@/tool/context7/types";

const log = createLogger("context7:resolve");

const ResolveLibraryIdSchema = z.object({
  libraryName: z.string().describe('库名称或关键词，例如: "react", "vue", "lodash"'),
  query: z.string().optional().describe("用户的问题或任务(用于按相关性排序结果)"),
  version: z.string().optional().describe("库的版本号(可选，默认使用最新版本)"),
});

/** Context7 resolve-library-id 工具 — 将通用库名称解析为 Context7 兼容的库 ID */
export const context7ResolveLibraryIdTool = defineTool({
  description:
    "将通用库名称解析为 Context7 兼容的库 ID。用于在查询文档前获取准确的 libraryId(如 npm:react 或 github:facebook/react)。",
  execute: async (args, context): Promise<Context7ResolveResult> => {
    try {
      context?.metadata?.("正在解析库 ID...", {
        libraryName: args.libraryName,
        version: args.version,
      });

      const result = await resolveLibraryId(args.libraryName, args.query, args.version);

      context?.metadata?.("库 ID 解析完成", {
        libraryCount: result.libraries?.length || 0,
        libraryId: result.libraryId,
      });

      return {
        libraries: result.libraries,
        libraryId: result.libraryId,
        status: "ok",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("解析库 ID 失败:", { error: errorMsg });
      return {
        error: errorMsg,
        status: "error",
      };
    }
  },
  name: "context7-resolve-library-id",
  parameters: ResolveLibraryIdSchema,
  permission: "web.fetch",
  builtin: true,
});

/**
 * DeepWiki read_wiki_structure 工具模块
 *
 * 职责:
 *   - 获取指定 GitHub 仓库的文档目录结构
 *   - 返回层级化的文档目录列表
 *   - 支持仓库名规范化
 *
 * 模块功能:
 *   - deepwikiReadStructureTool: 文档结构查询工具
 *   - 调用 DeepWiki MCP API 获取结构
 *   - 返回标准化的结构数据
 *
 * 使用场景:
 *   - 获取仓库文档的目录结构
 *   - 构建文档导航
 *   - 了解文档组织方式
 *
 * 边界:
 *   1. 仅支持 GitHub 仓库
 *   2. 仓库名格式: owner/repo 或完整 URL
 *   3. 依赖 DeepWiki MCP API
 *   4. 需要网络连接
 *   5. 返回结构可能为空(如果仓库无文档)
 *
 * 流程:
 *   1. 接收仓库名参数
 *   2. 调用 readWikiStructure 获取结构
 *   3. 返回层级化目录列表
 *   4. 错误时返回错误信息
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { readWikiStructure } from "@/tool/deepwiki/client";
import { createLogger } from "@/core/logging/logger";
import type { DeepWikiStructureResult } from "@/tool/deepwiki/types";

const log = createLogger("deepwiki:structure");

const ReadWikiStructureSchema = z.object({
  repoName: z
    .string()
    .describe('GitHub 仓库全名，格式: "owner/repo-name" 或完整 URL "https://github.com/owner/repo-name"'),
});

/** DeepWiki 文档结构查询工具 — 获取仓库文档的层级化目录列表 */
export const deepwikiReadStructureTool = defineTool({
  description:
    "获取指定 GitHub 仓库在 DeepWiki 上的文档目录结构(TOC)。返回文档的层级化目录列表，可用于后续读取具体文档内容。",
  execute: async (args, context): Promise<DeepWikiStructureResult> => {
    try {
      context?.metadata?.("正在获取文档结构...", { repoName: args.repoName });

      const structure = await readWikiStructure(args.repoName);

      context?.metadata?.("文档结构获取完成", {
        items: structure.length,
        repoName: args.repoName,
      });

      return {
        status: "ok",
        structure,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("获取文档结构失败:", { error: errorMsg });
      return {
        error: errorMsg,
        status: "error",
      };
    }
  },
  name: "deepwiki-read-structure",
  parameters: ReadWikiStructureSchema,
  permission: "web.fetch",
  builtin: true,
});

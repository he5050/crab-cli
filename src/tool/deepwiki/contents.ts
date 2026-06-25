/**
 * DeepWiki read_wiki_contents 工具模块
 *
 * 职责:
 *   - 读取仓库中指定路径的完整文档内容
 *   - 返回 Markdown 格式的文档内容
 *   - 支持路径验证和规范化
 *
 * 模块功能:
 *   - deepwikiReadContentsTool: 文档内容读取工具
 *   - 调用 DeepWiki MCP API 获取内容
 *   - 返回标准化的内容数据
 *
 * 使用场景:
 *   - 读取特定文档的完整内容
 *   - 获取 Markdown 格式的文档
 *   - 配合 structure 工具使用
 *
 * 边界:
 *   1. 需要先使用 deepwiki-read-structure 获取有效路径
 *   2. 仅支持 GitHub 仓库
 *   3. 仓库名格式: owner/repo 或完整 URL
 *   4. 依赖 DeepWiki MCP API
 *   5. 需要网络连接
 *
 * 流程:
 *   1. 接收仓库名和路径参数
 *   2. 调用 readWikiContents 获取内容
 *   3. 返回 Markdown 内容
 *   4. 错误时返回错误信息
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { readWikiContents } from "@/tool/deepwiki/client";
import { createLogger } from "@/core/logging/logger";
import type { DeepWikiContentsResult } from "@/tool/deepwiki/types";

const log = createLogger("deepwiki:contents");

const ReadWikiContentsSchema = z.object({
  path: z.string().describe('文档路径，从 deepwiki-read-structure 获取(如 "docs/getting-started")'),
  repoName: z
    .string()
    .describe('GitHub 仓库全名，格式: "owner/repo-name" 或完整 URL "https://github.com/owner/repo-name"'),
});

/** DeepWiki 文档内容读取工具 — 读取指定路径的完整 Markdown 文档 */
export const deepwikiReadContentsTool = defineTool({
  description:
    "读取指定 GitHub 仓库在 DeepWiki 上特定路径的文档内容。返回结构化 Markdown 内容。需要先使用 deepwiki-read-structure 获取文档路径。",
  execute: async (args, context): Promise<DeepWikiContentsResult> => {
    try {
      context?.metadata?.("正在读取文档内容...", {
        path: args.path,
        repoName: args.repoName,
      });

      const result = await readWikiContents(args.repoName, args.path);

      context?.metadata?.("文档内容读取完成", {
        contentLength: result.content.length,
        path: result.path,
        repoName: result.repoName,
      });

      return {
        content: result.content,
        path: result.path,
        repoName: result.repoName,
        status: "ok",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("读取文档内容失败:", { error: errorMsg });
      return {
        error: errorMsg,
        status: "error",
      };
    }
  },
  name: "deepwiki-read-contents",
  parameters: ReadWikiContentsSchema,
  permission: "web.fetch",
  builtin: true,
});

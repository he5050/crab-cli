/**
 * DeepWiki Fetch 工具模块
 *
 * 职责:
 *   - 从 deepwiki.com 获取仓库文档并转换为 Markdown
 *   - 解析和规范化 DeepWiki URL
 *   - 通过 GitHub API 解析仓库名
 *
 * 模块功能:
 *   - normalizeUrl: 解析和规范化 URL(支持多种格式)
 *   - resolveRepo: 通过 GitHub API 解析仓库名
 *   - deepwikiFetchTool: DeepWiki 文档获取工具
 *
 * 使用场景:
 *   - 获取 GitHub 仓库的文档
 *   - 将 HTML 文档转换为 Markdown
 *   - 批量获取仓库文档
 *
 * 边界:
 *   1. 仅支持 deepwiki.com 域名
 *   2. 支持 URL 格式: https://deepwiki.com/owner/repo 或 owner/repo 或 repo 名称
 *   3. 爬取深度限制 0-1
 *   4. 依赖 GitHub API 解析单关键词
 *   5. 需要网络连接
 *
 * 流程:
 *   1. 解析和规范化输入 URL
 *   2. 验证域名限制
 *   3. 爬取文档页面
 *   4. 转换 HTML 为 Markdown
 *   5. 返回结构化文档内容
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { crawl } from "@/tool/deepwiki/crawler";
import { htmlToMarkdown } from "@/tool/deepwiki/htmlToMarkdown";
import { createLogger } from "@/core/logging/logger";
import type { DeepWikiFetchResult, DeepWikiPage } from "@/tool/deepwiki/types";
import { normalizeUrl } from "@/tool/deepwiki/utils";

const log = createLogger("deepwiki:fetch");

const FetchRequestSchema = z.object({
  maxDepth: z.number().int().min(0).max(1).default(0).describe("爬取深度 (0-1, 默认 0)"),
  mode: z.enum(["aggregate", "pages"]).default("pages").describe("输出模式: aggregate 合并为单个文档, pages 分页输出"),
  url: z.string().describe("DeepWiki URL，支持格式: https://deepwiki.com/owner/repo 或 owner/repo 或 repo 名称"),
  verbose: z.boolean().default(false).describe("是否输出详细日志"),
});

/** DeepWiki 文档获取工具 — 从 deepwiki.com 爬取并转换文档为 Markdown */
export const deepwikiFetchTool = defineTool({
  description:
    "从 deepwiki.com 获取 GitHub 仓库的文档并转换为 Markdown。支持通过仓库名(如 facebook/react)或完整 URL 访问。",
  execute: async (args, context): Promise<DeepWikiFetchResult> => {
    try {
      context?.metadata?.("正在解析 DeepWiki URL...", { url: args.url });

      const normalizedUrl = await normalizeUrl(args.url);
      if (!normalizedUrl) {
        return {
          error: `无效的 URL 格式: ${args.url}`,
          pages: [],
          status: "error",
        };
      }

      const root = new URL(normalizedUrl);

      // 验证域名
      if (root.hostname !== "deepwiki.com") {
        return {
          error: "只允许 deepwiki.com 域名",
          pages: [],
          status: "error",
        };
      }

      context?.metadata?.("正在爬取文档...", { url: normalizedUrl });

      const crawlResult = await crawl({
        maxDepth: args.maxDepth,
        root,
        verbose: args.verbose,
      });

      if (Object.keys(crawlResult.html).length === 0) {
        return {
          error: "未能获取任何页面内容",
          pages: [],
          status: "error",
        };
      }

      context?.metadata?.("正在转换 Markdown...", {
        pages: Object.keys(crawlResult.html).length,
      });

      // 转换每个页面
      const pages: DeepWikiPage[] = await Promise.all(
        Object.entries(crawlResult.html).map(async ([path, html]) => ({
          markdown: await htmlToMarkdown(html, { mode: args.mode }),
          path,
        })),
      );

      context?.metadata?.("文档获取完成", { totalPages: pages.length });

      return {
        pages,
        status: "ok",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("DeepWiki fetch 失败:", { error: errorMsg });
      return {
        error: errorMsg,
        pages: [],
        status: "error",
      };
    }
  },
  name: "deepwiki-fetch",
  parameters: FetchRequestSchema,
  permission: "web.fetch",
  builtin: true,
});

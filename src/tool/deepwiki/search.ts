/**
 * DeepWiki Search 工具模块
 *
 * 职责:
 *   - 在 deepwiki.com 文档中搜索关键词
 *   - 返回匹配的文本片段
 *   - 支持关键词高亮和上下文提取
 *
 * 模块功能:
 *   - normalizeUrl: 解析和规范化 URL
 *   - resolveRepo: 通过 GitHub API 解析仓库名
 *   - deepwikiSearchTool: 文档搜索工具
 *
 * 使用场景:
 *   - 在文档中查找特定内容
 *   - 快速定位相关信息
 *   - 全文搜索文档
 *
 * 边界:
 *   1. 仅支持 deepwiki.com 域名
 *   2. 支持 URL 格式: https://deepwiki.com/owner/repo 或 owner/repo 或 repo 名称
 *   3. 爬取深度限制 0-1
 *   4. 最大返回匹配数限制 100
 *   5. 需要网络连接
 *
 * 流程:
 *   1. 解析和规范化输入 URL
 *   2. 验证域名限制
 *   3. 爬取文档页面
 *   4. 转换 HTML 为 Markdown
 *   5. 搜索关键词并提取上下文
 *   6. 返回匹配结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { crawl } from "@/tool/deepwiki/crawler";
import { htmlToMarkdown } from "@/tool/deepwiki/htmlToMarkdown";
import { createLogger } from "@/core/logging/logger";
import type { DeepWikiSearchMatch, DeepWikiSearchResult } from "@/tool/deepwiki/types";
import { normalizeUrl } from "@/tool/deepwiki/utils";

const log = createLogger("deepwiki:search");

const SearchRequestSchema = z.object({
  maxDepth: z.number().int().min(0).max(1).default(0).describe("爬取深度 (0-1, 默认 0)"),
  maxMatches: z.number().int().positive().max(100).default(10).describe("最大返回匹配数 (默认 10)"),
  mode: z.enum(["aggregate", "pages"]).default("pages").describe("输出模式"),
  query: z.string().min(1).describe("搜索关键词(不区分大小写)"),
  url: z.string().describe("DeepWiki URL，支持格式: https://deepwiki.com/owner/repo 或 owner/repo 或 repo 名称"),
  verbose: z.boolean().default(false).describe("是否输出详细日志"),
});

/** DeepWiki 文档搜索工具 — 在 deepwiki.com 文档中搜索关键词并返回匹配片段 */
export const deepwikiSearchTool = defineTool({
  description: "在 deepwiki.com 的文档中搜索关键词，返回匹配的文本片段。支持通过仓库名或完整 URL 访问。",
  execute: async (args, context): Promise<DeepWikiSearchResult> => {
    try {
      context?.metadata?.("正在解析 DeepWiki URL...", { url: args.url });

      const normalizedUrl = await normalizeUrl(args.url);
      if (!normalizedUrl) {
        return {
          error: `无效的 URL 格式: ${args.url}`,
          matches: [],
          query: args.query,
          status: "error",
          totalSearchedPages: 0,
        };
      }

      const root = new URL(normalizedUrl);

      if (root.hostname !== "deepwiki.com") {
        return {
          error: "只允许 deepwiki.com 域名",
          matches: [],
          query: args.query,
          status: "error",
          totalSearchedPages: 0,
        };
      }

      context?.metadata?.("正在爬取文档...", { url: normalizedUrl });

      const crawlResult = await crawl({
        maxDepth: args.maxDepth,
        root,
        verbose: args.verbose,
      });

      const totalSearchedPages = Object.keys(crawlResult.html).length;

      if (totalSearchedPages === 0) {
        return {
          error: "未能获取任何页面内容",
          matches: [],
          query: args.query,
          status: "error",
          totalSearchedPages: 0,
        };
      }

      context?.metadata?.("正在搜索关键词...", {
        pages: totalSearchedPages,
        query: args.query,
      });

      // 构建搜索正则(转义特殊字符)
      const safeQuery = args.query.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
      const regex = new RegExp(safeQuery, "i");

      const matches: DeepWikiSearchMatch[] = [];

      // 遍历所有页面进行搜索
      for (const [path, html] of Object.entries(crawlResult.html)) {
        if (matches.length >= args.maxMatches) {
          break;
        }

        const markdown = await htmlToMarkdown(html, { mode: args.mode });

        // 在 Markdown 中搜索匹配
        let match: RegExpExecArray | null;
        while ((match = regex.exec(markdown)) !== null) {
          const start = Math.max(0, match.index - 80);
          const end = Math.min(markdown.length, match.index + match[0].length + 80);
          const rawSnippet = markdown.slice(start, end);
          // 高亮匹配的关键词
          const snippet = rawSnippet.replace(regex, (s) => `**${s}**`);

          matches.push({ path, snippet, title: path, url: "" });

          if (matches.length >= args.maxMatches) {
            break;
          }
        }
      }

      context?.metadata?.("搜索完成", {
        matches: matches.length,
        pages: totalSearchedPages,
      });

      return {
        matches,
        query: args.query,
        status: "ok",
        totalSearchedPages,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("DeepWiki search 失败:", { error: errorMsg });
      return {
        error: errorMsg,
        matches: [],
        query: args.query,
        status: "error",
        totalSearchedPages: 0,
      };
    }
  },
  name: "deepwiki-search",
  parameters: SearchRequestSchema,
  permission: "web.fetch",
  builtin: true,
});

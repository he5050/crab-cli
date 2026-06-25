/**
 * DeepWiki 爬虫实现模块
 *
 * 职责:
 *   - 从 DeepWiki 网站爬取文档页面
 *   - 提取页面中的链接
 *   - 管理爬取深度和去重
 *
 * 模块功能:
 *   - crawl: 主爬取函数
 *   - extractLinks: 从 HTML 提取链接
 *   - fetchPage: 获取页面内容
 *
 * 使用场景:
 *   - 批量获取 DeepWiki 文档
 *   - 构建文档索引
 *   - 离线文档生成
 *
 * 边界:
 *   1. 仅爬取 deepwiki.com 域名
 *   2. 支持最大爬取深度限制
 *   3. 自动去重处理
 *   4. 使用标准 User-Agent
 *   5. 需要网络连接
 *
 * 流程:
 *   1. 初始化爬取队列
 *   2. 循环获取页面
 *   3. 提取页面链接
 *   4. 添加到爬取队列(未访问且深度未超限)
 *   5. 返回所有爬取的页面内容
 */
import { createLogger } from "@/core/logging/logger";
import type { CrawlResult } from "@/tool/deepwiki/types";

const log = createLogger("deepwiki:crawler");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface CrawlOptions {
  root: URL;
  maxDepth: number;
  emit?: (event: { type: string; url: string; depth: number }) => void;
  verbose?: boolean;
}

/**
 * 从 DeepWiki 页面提取链接
 */
function extractLinks(html: string, baseUrl: URL): string[] {
  const links: string[] = [];
  const linkRegex = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    try {
      const href = match[1];
      if (!href) {
        continue;
      }
      // 只处理相对链接或同域链接
      if (href.startsWith("http")) {
        const url = new URL(href);
        if (url.hostname === baseUrl.hostname) {
          links.push(href);
        }
      } else if (href.startsWith("/")) {
        links.push(`${baseUrl.origin}${href}`);
      } else if (!href.startsWith("#") && !href.startsWith("javascript:")) {
        links.push(new URL(href, baseUrl).href);
      }
    } catch (error) {
      log.debug(`忽略无效 URL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return [...new Set(links)];
}

/**
 * 获取页面内容
 */
async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.5",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      log.warn(`获取页面失败: ${url} - ${response.status}`);
      return null;
    }

    return await response.text();
  } catch (error) {
    log.warn(`获取页面错误: ${url} - ${error}`);
    return null;
  }
}

/**
 * 爬取 DeepWiki 页面
 */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const { root, maxDepth, emit, verbose } = options;
  const html: Record<string, string> = {};
  const urls: string[] = [];
  const visited = new Set<string>();
  const toVisit: { url: string; depth: number }[] = [{ depth: 0, url: root.href }];

  if (verbose) {
    log.info(`开始爬取: ${root.href}, maxDepth=${maxDepth}`);
  }

  while (toVisit.length > 0) {
    const { url, depth } = toVisit.shift()!;

    if (visited.has(url)) {
      continue;
    }
    if (depth > maxDepth) {
      continue;
    }

    visited.add(url);
    urls.push(url);

    emit?.({ depth, type: "fetch", url });

    const content = await fetchPage(url);
    if (content) {
      html[url] = content;

      if (depth < maxDepth) {
        const links = extractLinks(content, root);
        for (const link of links) {
          if (!visited.has(link)) {
            toVisit.push({ depth: depth + 1, url: link });
          }
        }
      }
    }
  }

  if (verbose) {
    log.info(`爬取完成: 共 ${Object.keys(html).length} 个页面`);
  }

  return { html, urls };
}

import { createInternalError } from "@/core/errors/appError";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("deepwiki:utils");

/**
 * 解析和规范化 URL
 * 支持格式:
 * - https://deepwiki.com/owner/repo
 * - owner/repo
 * - repo (单关键词，尝试解析)
 */
export async function normalizeUrl(input: string): Promise<string | null> {
  const url = input.trim();

  if (/^https?:\/\//.test(url)) {
    return url;
  }

  if (/^[^/]+\/[^/]+$/.test(url)) {
    return `https://deepwiki.com/${url}`;
  }

  if (/^[^/]+$/.test(url)) {
    try {
      const repo = await resolveRepo(url);
      return `https://deepwiki.com/${repo}`;
    } catch (error) {
      log.debug(`解析仓库失败: ${error instanceof Error ? error.message : String(error)}`);
      return `https://deepwiki.com/${url}`;
    }
  }

  return null;
}

/**
 * 通过 GitHub API 解析仓库名
 */
export async function resolveRepo(keyword: string): Promise<string> {
  try {
    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(keyword)}&sort=stars&order=desc&per_page=1`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "crab-cli-deepwiki",
        },
      },
    );

    if (!response.ok) {
      throw createInternalError("INTERNAL_ERROR", `GitHub API 错误: ${response.status}`);
    }

    const data = (await response.json()) as {
      items: { full_name: string }[];
    };

    if (data.items && data.items.length > 0) {
      return data.items[0]!.full_name;
    }

    throw createInternalError("INTERNAL_ERROR", "未找到匹配的仓库");
  } catch (error) {
    log.warn(`解析仓库失败: ${keyword}`, { error: String(error) });
    throw error;
  }
}

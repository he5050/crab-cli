import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 简单 .gitignore 规则匹配器。
 * 支持基础模式:目录名、文件名、通配符(*)。
 * 不支持取反(!)、双星号(**)、字符范围([abc])。
 */
/** GitignoreMatcher */
export class GitignoreMatcher {
  private patterns: { raw: string; dirOnly: boolean }[] = [];

  /** 从文件加载 .gitignore 规则 */
  loadFromFile(gitignorePath: string): void {
    if (!existsSync(gitignorePath)) {
      return;
    }
    try {
      const content = readFileSync(gitignorePath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        this.patterns.push({
          dirOnly: trimmed.endsWith("/"),
          raw: trimmed,
        });
      }
    } catch {
      // Ignore read errors
    }
  }

  /** 检查相对路径是否被 .gitignore 排除 */
  isIgnored(relPath: string, isDir: boolean): boolean {
    for (const { raw, dirOnly } of this.patterns) {
      if (dirOnly && !isDir) {
        continue;
      }

      const pattern = raw.replace(/\/$/, "");
      // 精确匹配
      if (relPath === pattern) {
        return true;
      }
      // 匹配路径的任意部分
      if (relPath.includes(`/${pattern}/`) || relPath.endsWith(`/${pattern}`)) {
        return true;
      }
      // 通配符匹配
      if (pattern.includes("*")) {
        const regex = new RegExp(`^${pattern.replace(/\*/g, "[^/]*")}$`);
        const basename = relPath.split("/").pop() ?? "";
        if (regex.test(basename) || regex.test(relPath)) {
          return true;
        }
      }
    }
    return false;
  }
}

/** 递归向上查找并加载所有 .gitignore 规则 */
export function loadGitignoreRules(rootDir: string): GitignoreMatcher {
  const matcher = new GitignoreMatcher();
  // 加载根目录 .gitignore
  const rootGitignore = join(rootDir, ".gitignore");
  matcher.loadFromFile(rootGitignore);
  return matcher;
}

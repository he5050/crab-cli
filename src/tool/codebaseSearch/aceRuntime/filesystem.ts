/**
 * ACE Code Search 文件系统工具 — 文件过滤和缓存管理
 *
 * 职责:
 *   - 判断目录和文件是否应被排除
 *   - 加载 .gitignore 和 .crabignore 排除模式
 *   - 提供带 LRU 缓存的文件读取
 *   - 检测 Git 仓库
 *
 * 模块功能:
 *   - DEFAULT_EXCLUDES: 默认排除目录列表
 *   - shouldExcludeDirectory: 判断目录是否应被排除
 *   - shouldExcludeFile: 判断文件是否应被排除
 *   - loadExclusionPatterns: 加载 .gitignore 和 .crabignore 排除模式
 *   - readFileWithCache: 带 LRU 缓存的文件读取
 *   - isGitRepository: 检查目录是否是 Git 仓库
 *   - ContentCacheCallbacks: 内容缓存回调接口定义
 *
 * 使用场景:
 *   - 代码索引时的文件过滤
 *   - 排除模式管理和配置
 *   - 重复文件读取的性能优化
 *   - 仓库类型检测
 *
 * 边界:
 * 1. 隐藏文件默认排除，白名单配置文件除外
 * 2. 支持 glob 模式的自定义排除(* 匹配)
 * 3. crab-cli 使用 .crabignore
 * 4. 缓存基于文件修改时间，变化时自动失效
 *
 * 流程:
 * 1. 加载 .gitignore 和 .crabignore 排除模式
 * 2. 检查目录是否在排除列表中
 * 3. 检查文件是否在排除列表中(支持隐藏文件白名单)
 * 4. 使用 LRU 缓存读取文件内容
 * 5. 检测 .git 目录判断是否为 Git 仓库
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";

const log = createLogger("tool:ace-filesystem");

/** 默认排除目录列表（node_modules、.git 等） */
export const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "target",
  ".next",
  ".nuxt",
  "coverage",
  "out",
  ".cache",
  "vendor",
];

/**
 * 判断目录是否应被排除。
 * 结合默认排除列表、隐藏目录、和自定义模式。
 */
/** shouldExcludeDirectory 的实现 */
export function shouldExcludeDirectory(
  dirName: string,
  fullPath: string,
  basePath: string,
  customExcludes: string[],
  regexCache: Map<string, RegExp>,
): boolean {
  // 默认排除
  if (DEFAULT_EXCLUDES.includes(dirName)) {
    return true;
  }

  // 隐藏目录
  if (dirName.startsWith(".")) {
    return true;
  }

  // 自定义排除模式
  const relativePath = path.relative(basePath, fullPath);
  for (const pattern of customExcludes) {
    if (pattern.includes("*")) {
      let regex = regexCache.get(pattern);
      if (!regex) {
        const regexPattern = pattern.replace(/\./g, String.raw`\.`).replace(/\*/g, ".*");
        regex = new RegExp(`^${regexPattern}$`);
        regexCache.set(pattern, regex);
      }
      if (regex.test(relativePath) || regex.test(dirName)) {
        return true;
      }
    } else {
      if (relativePath === pattern || dirName === pattern || relativePath.startsWith(`${pattern}/`)) {
        return true;
      }
    }
  }

  return false;
}

/** 允许的隐藏配置文件 */
const ALLOWED_HIDDEN_FILES = [
  ".env",
  ".gitignore",
  ".eslintrc",
  ".prettierrc",
  ".babelrc",
  ".editorconfig",
  ".npmrc",
  ".yarnrc",
];

/**
 * 判断文件是否应被排除。
 * 支持隐藏文件白名单、自定义排除模式。
 */
/** shouldExcludeFile 的实现 */
export function shouldExcludeFile(
  fileName: string,
  fullPath: string,
  basePath: string,
  customExcludes: string[],
  regexCache: Map<string, RegExp>,
): boolean {
  // 隐藏文件(白名单除外)
  if (fileName.startsWith(".")) {
    const isAllowedConfig = ALLOWED_HIDDEN_FILES.some(
      (allowed) =>
        fileName === allowed ||
        fileName.startsWith(`${allowed}.`) ||
        fileName.endsWith("rc.js") ||
        fileName.endsWith("rc.json") ||
        fileName.endsWith("rc.yaml") ||
        fileName.endsWith("rc.yml"),
    );
    if (!isAllowedConfig) {
      return true;
    }
  }

  // 自定义排除模式
  const relativePath = path.relative(basePath, fullPath);
  for (const pattern of customExcludes) {
    if (pattern.endsWith("/")) {
      continue;
    }

    if (pattern.includes("*")) {
      let regex = regexCache.get(pattern);
      if (!regex) {
        const regexPattern = pattern.replace(/\./g, String.raw`\.`).replace(/\*/g, ".*");
        regex = new RegExp(`^${regexPattern}$`);
        regexCache.set(pattern, regex);
      }
      if (regex.test(relativePath) || regex.test(fileName)) {
        return true;
      }
    } else {
      if (relativePath === pattern || fileName === pattern) {
        return true;
      }
      if (relativePath.startsWith(`${pattern}/`)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 从 .gitignore 和 .crabignore 加载自定义排除模式。
 */
export async function loadExclusionPatterns(basePath: string): Promise<string[]> {
  const patterns: string[] = [];

  // 加载 .gitignore
  const gitignorePath = path.join(basePath, ".gitignore");
  try {
    const content = await fs.readFile(gitignorePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const pattern = trimmed.replace(/^\//, "").replace(/\/$/, "");
        if (pattern) {
          patterns.push(pattern);
        }
      }
    }
  } catch (error) {
    log.debug("无法读取 .gitignore，跳过该排除文件", {
      error: getCodebaseSearchErrorMessage(error),
      file: gitignorePath,
    });
  }

  // 加载 .crabignore
  const crabignorePath = path.join(basePath, ".crabignore");
  try {
    const content = await fs.readFile(crabignorePath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const pattern = trimmed.replace(/^\//, "").replace(/\/$/, "");
        if (pattern) {
          patterns.push(pattern);
        }
      }
    }
  } catch (error) {
    log.debug("无法读取 .crabignore，跳过该排除文件", {
      error: getCodebaseSearchErrorMessage(error),
      file: crabignorePath,
    });
  }

  return patterns;
}

/** 文件内容缓存的生命周期回调接口 */
export interface ContentCacheCallbacks {
  onAdd?: (filePath: string, content: string, mtime: number) => void;
  onEvict?: (filePath: string) => void;
}

/**
 * 带 LRU 缓存的文件读取。
 * 减少重复文件系统访问。
 */
export async function readFileWithCache(
  filePath: string,
  fileContentCache: Map<string, { content: string; mtime: number }>,
  maxCacheSize: number = 50,
  callbacks?: ContentCacheCallbacks,
): Promise<string> {
  const stats = await fs.stat(filePath);
  const mtime = stats.mtimeMs;

  // 检查缓存
  const cached = fileContentCache.get(filePath);
  if (cached && cached.mtime === mtime) {
    return cached.content;
  }

  // 读取文件
  const content = await fs.readFile(filePath, "utf8");

  // 超限时淘汰最旧条目
  if (fileContentCache.size >= maxCacheSize) {
    const firstKey = fileContentCache.keys().next().value;
    if (firstKey) {
      callbacks?.onEvict?.(firstKey);
      fileContentCache.delete(firstKey);
    }
  }

  // 缓存
  fileContentCache.set(filePath, { content, mtime });
  callbacks?.onAdd?.(filePath, content, mtime);

  return content;
}

/**
 * 检查目录是否是 Git 仓库。
 */
export async function isGitRepository(directory: string = process.cwd()): Promise<boolean> {
  try {
    const gitDir = path.join(directory, ".git");
    const stats = await fs.stat(gitDir);
    return stats.isDirectory();
  } catch (error) {
    log.debug("Git 仓库检测失败，按非 Git 仓库处理", {
      directory,
      error: getCodebaseSearchErrorMessage(error),
    });
    return false;
  }
}

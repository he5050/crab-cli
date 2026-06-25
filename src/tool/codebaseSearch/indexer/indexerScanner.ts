/**
 * indexerScanner — 文件扫描与增量过滤
 *
 * 从 codebaseIndexer.ts 提取:
 *   - buildExcludeSets: 构建排除目录/扩展名集合
 *   - scanFiles: 递归扫描项目目录获取可索引文件列表
 *   - filterChangedFiles: 增量过滤，仅返回新增或已变更的文件
 */
import { createLogger } from "@/core/logging/logger";
import { detectLanguage } from "@/lsp/language/language";
import type { VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";
import type { AppConfigSchema } from "@/schema/config";
import type { GitignoreMatcher } from "@/tool/codebaseSearch/indexer/gitignoreMatcher";
import {
  DEFAULT_MAX_FILE_SIZE,
  DOCUMENT_EXTENSIONS,
  isIndexableLanguage,
  computeFileHash,
} from "@/tool/codebaseSearch/indexer/indexerChunker";
import { relative, extname, join } from "node:path";
import { statSync, readdirSync, existsSync } from "node:fs";
import { loadCheckpoint } from "@/tool/codebaseSearch/indexer/indexerCheckpoint";

const log = createLogger("search:indexer");

/** 默认排除的目录 */
const DEFAULT_EXCLUDES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  "vendor",
  "__pycache__",
  ".tox",
  "target",
  ".turbo",
  ".vercel",
  ".env",
  "bun.lock",
  "package-lock.json",
  "yarn.lock",
]);

/** 默认排除的文件模式 */
const DEFAULT_EXCLUDE_EXTENSIONS = new Set([".lock", ".map", ".min.js", ".min.css", ".bundle.js", ".chunk.js"]);

/** 构建排除集合 */
export function buildExcludeSets(
  configExcludeDirs?: string[],
  configExcludeExtensions?: string[],
): { excludeDirs: Set<string>; excludeExtensions: Set<string> } {
  return {
    excludeDirs: new Set([...DEFAULT_EXCLUDES, ...(configExcludeDirs ?? [])]),
    excludeExtensions: new Set([...DEFAULT_EXCLUDE_EXTENSIONS, ...(configExcludeExtensions ?? [])]),
  };
}

/**
 * 扫描项目目录，返回所有可索引文件的绝对路径列表。
 */
/** scanFiles 的实现 */
export function scanFiles(
  rootDir: string,
  excludeDirs: Set<string>,
  excludeExtensions: Set<string>,
  gitignoreMatcher: GitignoreMatcher,
  appConfig?: AppConfigSchema,
): string[] {
  const files: string[] = [];
  walkDir(rootDir, rootDir, files, excludeDirs, excludeExtensions, gitignoreMatcher, appConfig);
  return files;
}

/**
 * 递归遍历目录，收集可索引文件。
 */
function walkDir(
  rootDir: string,
  dir: string,
  result: string[],
  excludeDirs: Set<string>,
  excludeExtensions: Set<string>,
  gitignoreMatcher: GitignoreMatcher,
  appConfig?: AppConfigSchema,
): void {
  if (!existsSync(dir)) {
    return;
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) {
          continue;
        }
        if (entry.name.startsWith(".") && entry.name !== ".crab") {
          continue;
        }
        if (gitignoreMatcher.isIgnored(relPath, true)) {
          continue;
        }
        walkDir(rootDir, fullPath, result, excludeDirs, excludeExtensions, gitignoreMatcher, appConfig);
      } else if (entry.isFile()) {
        if (gitignoreMatcher.isIgnored(relPath, false)) {
          continue;
        }
        if (shouldIncludeFile(fullPath, excludeExtensions, appConfig)) {
          result.push(fullPath);
        }
      }
    }
  } catch {
    // 权限错误等
  }
}

/**
 * 判断单个文件是否应被索引。
 */
/** shouldIncludeFile 的实现 */
export function shouldIncludeFile(
  filePath: string,
  excludeExtensions: Set<string>,
  appConfig?: AppConfigSchema,
): boolean {
  const ext = extname(filePath).toLowerCase();

  if (excludeExtensions.has(ext)) {
    return false;
  }

  const maxSize = appConfig?.codebase?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  try {
    const stat = statSync(filePath);
    if (stat.size > maxSize) {
      return false;
    }
    if (stat.size === 0) {
      return false;
    }
  } catch {
    return false;
  }

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    const includeDocuments = appConfig?.codebase?.includeDocuments ?? false;
    const documentTypes = appConfig?.codebase?.documentTypes ?? [];

    if (!includeDocuments) {
      return false;
    }

    const docType = ext.slice(1);
    return documentTypes.includes(docType as "pdf" | "docx" | "xlsx" | "pptx");
  }

  const lang = detectLanguage(filePath);
  return isIndexableLanguage(lang);
}

/**
 * 增量过滤:仅返回新增或已变更的文件。
 */
/** filterChangedFiles 的实现 */
export function filterChangedFiles(rootDir: string, files: string[], db: VectorDb): string[] {
  const checkpoint = loadCheckpoint(rootDir, db);
  const processedSet = checkpoint?.status === "in_progress" ? new Set(checkpoint.processedFileList) : null;

  return files.filter((file) => {
    try {
      const stat = statSync(file);

      if (processedSet) {
        try {
          const existing = db.getFileStats(file);
          if (
            processedSet.has(file) &&
            existing &&
            stat.mtimeMs <= existing.latestMtime &&
            !hasHashChanged(file, existing.fileHash)
          ) {
            log.debug(`checkpoint 跳过已处理文件: ${relative(rootDir, file)}`);
            return false;
          }
        } catch {
          /* Mtime 变了，重新处理 */
        }
      }

      const existing = db.getFileStats(file);
      if (!existing) {
        return true;
      }
      if (stat.mtimeMs > existing.latestMtime) {
        return true;
      }
      return hasHashChanged(file, existing.fileHash);
    } catch {
      return false;
    }
  });
}

function hasHashChanged(filePath: string, existingHash: string | null): boolean {
  if (!existingHash) {
    return false;
  }
  const currentHash = computeFileHash(filePath);
  return currentHash !== null && currentHash !== existingHash;
}

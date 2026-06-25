/**
 * ACE symbol index builder.
 *
 * Keeps filesystem walking, incremental mtime checks, symbol parsing, and
 * deleted-file cleanup out of ACECodeSearchService.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";
import { BATCH_SIZE, MAX_INDEXED_FILES, MAX_SYMBOLS_PER_FILE } from "./constants";
import { detectLanguage } from "./language";
import { parseFileSymbols } from "./symbol";
import { type ContentCacheCallbacks, readFileWithCache, shouldExcludeDirectory } from "./filesystem";
import type { CodeSymbol } from "./types";

const log = createLogger("tool:ace-index-builder");

/** 符号索引构建的输入参数和依赖 */
export interface BuildSymbolIndexInput {
  basePath: string;
  indexCache: Map<string, CodeSymbol[]>;
  allIndexedFiles: Set<string>;
  fileModTimes: Map<string, number>;
  fileContentCache: Map<string, { content: string; mtime: number }>;
  customExcludes: string[];
  regexCache: Map<string, RegExp>;
  contentCacheCallbacks: ContentCacheCallbacks;
  markIndexTruncated: (message: string) => void;
  removeFromContentCache: (filePath: string) => void;
  clearContentCache: () => void;
}

/** 增量构建符号索引，基于文件修改时间仅重新解析变化的文件 */
export async function buildSymbolIndex(input: BuildSymbolIndexInput): Promise<void> {
  const filesToProcess: string[] = [];

  const searchInDirectory = async (dirPath: string): Promise<void> => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (shouldExcludeDirectory(entry.name, fullPath, input.basePath, input.customExcludes, input.regexCache)) {
            continue;
          }
          await searchInDirectory(fullPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const language = detectLanguage(fullPath);
        if (!language) {
          continue;
        }

        const isAlreadyIndexed = input.allIndexedFiles.has(fullPath);
        if (!isAlreadyIndexed && input.allIndexedFiles.size >= MAX_INDEXED_FILES) {
          input.markIndexTruncated(
            `ACE symbol index reached ${MAX_INDEXED_FILES} file limit; skipping remaining files`,
          );
          continue;
        }

        try {
          const stats = await fs.stat(fullPath);
          const currentMtime = stats.mtimeMs;
          const cachedMtime = input.fileModTimes.get(fullPath);

          if (cachedMtime === undefined || currentMtime > cachedMtime) {
            filesToProcess.push(fullPath);
            input.fileModTimes.set(fullPath, currentMtime);
          }

          input.allIndexedFiles.add(fullPath);
        } catch (error) {
          log.debug("ACE index stat failed, skipping file", {
            error: getCodebaseSearchErrorMessage(error),
            file: fullPath,
          });
        }
      }
    } catch (error) {
      log.debug("ACE index directory inaccessible, skipping directory", {
        dir: dirPath,
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  };

  await searchInDirectory(input.basePath);

  const batches: string[][] = [];
  for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
    batches.push(filesToProcess.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (fullPath) => {
        try {
          const content = await readFileWithCache(fullPath, input.fileContentCache, 50, input.contentCacheCallbacks);
          const symbols = await parseFileSymbols(fullPath, content, input.basePath, {
            includeContext: false,
            includeSignature: false,
            maxSymbols: MAX_SYMBOLS_PER_FILE,
          });

          if (symbols.length >= MAX_SYMBOLS_PER_FILE) {
            input.markIndexTruncated(`ACE capped file at ${MAX_SYMBOLS_PER_FILE} symbols`);
          }

          if (symbols.length > 0) {
            input.indexCache.set(fullPath, symbols);
          } else {
            input.indexCache.delete(fullPath);
          }
        } catch (error) {
          log.debug("ACE index file parse failed, evicting cached file", {
            error: getCodebaseSearchErrorMessage(error),
            file: fullPath,
          });
          input.indexCache.delete(fullPath);
          input.fileModTimes.delete(fullPath);
          input.removeFromContentCache(fullPath);
        }
      }),
    );
  }

  for (const cachedPath of input.indexCache.keys()) {
    try {
      await fs.access(cachedPath);
    } catch (error) {
      log.debug("ACE indexed file disappeared, evicting cached file", {
        error: getCodebaseSearchErrorMessage(error),
        file: cachedPath,
      });
      input.indexCache.delete(cachedPath);
      input.fileModTimes.delete(cachedPath);
      input.allIndexedFiles.delete(cachedPath);
      input.removeFromContentCache(cachedPath);
    }
  }

  input.clearContentCache();
}

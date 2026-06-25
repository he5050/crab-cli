/**
 * ACE symbol reference search.
 *
 * Scans source files for word-boundary symbol matches and classifies each match
 * as import, definition, type, or usage.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";
import { detectLanguage } from "./language";
import { getContext } from "./symbol";
import { type ContentCacheCallbacks, readFileWithCache, shouldExcludeDirectory, shouldExcludeFile } from "./filesystem";
import type { CodeReference } from "./types";

const log = createLogger("tool:ace-reference-search");

/** 符号引用搜索的输入参数 */
export interface FindSymbolReferencesInput {
  basePath: string;
  symbolName: string;
  maxResults?: number;
  customExcludes: string[];
  regexCache: Map<string, RegExp>;
  fileContentCache: Map<string, { content: string; mtime: number }>;
  contentCacheCallbacks: ContentCacheCallbacks;
}

/** 在代码库中搜索指定符号的所有引用，按 import/definition/type/usage 分类 */
export async function findSymbolReferences(input: FindSymbolReferencesInput): Promise<CodeReference[]> {
  const maxResults = input.maxResults ?? 100;
  const references: CodeReference[] = [];
  const escapedSymbol = input.symbolName.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  let shouldStop = false;

  const searchInDirectory = async (dirPath: string): Promise<void> => {
    if (shouldStop || references.length >= maxResults) {
      shouldStop = true;
      return;
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (shouldStop || references.length >= maxResults) {
          shouldStop = true;
          return;
        }

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
        if (shouldExcludeFile(entry.name, fullPath, input.basePath, input.customExcludes, input.regexCache)) {
          continue;
        }

        const language = detectLanguage(fullPath);
        if (!language) {
          continue;
        }

        try {
          const content = await readFileWithCache(fullPath, input.fileContentCache, 50, input.contentCacheCallbacks);
          const lines = content.split("\n");
          const regex = new RegExp(`\\b${escapedSymbol}\\b`, "g");

          for (let i = 0; i < lines.length; i++) {
            if (references.length >= maxResults) {
              shouldStop = true;
              return;
            }

            const line = lines[i];
            if (!line) {
              continue;
            }

            regex.lastIndex = 0;
            let match;

            while ((match = regex.exec(line)) !== null) {
              if (references.length >= maxResults) {
                shouldStop = true;
                return;
              }

              references.push({
                column: match.index + 1,
                context: getContext(lines, i, 1),
                filePath: path.relative(input.basePath, fullPath),
                line: i + 1,
                referenceType: classifyReference(line, input.symbolName, escapedSymbol),
                symbol: input.symbolName,
              });
            }
          }
        } catch (error) {
          log.debug("ACE reference file unreadable, skipping file", {
            error: getCodebaseSearchErrorMessage(error),
            file: fullPath,
          });
        }
      }
    } catch (error) {
      log.debug("ACE reference directory inaccessible, skipping directory", {
        dir: dirPath,
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  };

  await searchInDirectory(input.basePath);
  return references;
}

function classifyReference(line: string, symbolName: string, escapedSymbol: string): CodeReference["referenceType"] {
  if (line.includes("import") && line.includes(symbolName)) {
    return "import";
  }
  if (new RegExp(`(?:function|class|const|let|var)\\s+${escapedSymbol}`).test(line)) {
    return "definition";
  }
  if (line.includes(":") && line.includes(symbolName)) {
    return "type";
  }
  return "usage";
}

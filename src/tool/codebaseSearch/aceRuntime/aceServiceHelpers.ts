import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createInternalError } from "@/core/errors/appError";

import { MAX_FILE_OUTLINE_SYMBOLS } from "./constants";
import type { CodeSymbol, SymbolType } from "./types";
import { parseFileSymbols } from "./symbol";
import { constrainFileOutlinePayload, sortOutlineSymbols } from "./outline";

const DEFINITION_SYMBOL_TYPES = new Set<CodeSymbol["type"]>(["function", "class", "variable"]);

/** 在符号索引中查找符号定义，优先在上下文文件中搜索 */
export function findDefinitionInSymbolIndex(
  indexCache: Map<string, CodeSymbol[]>,
  symbolName: string,
  contextFullPath?: string,
): CodeSymbol | null {
  if (contextFullPath) {
    const fileSymbols = indexCache.get(contextFullPath);
    const contextSymbol = fileSymbols?.find(
      (symbol) => symbol.name === symbolName && DEFINITION_SYMBOL_TYPES.has(symbol.type),
    );
    if (contextSymbol) {
      return contextSymbol;
    }
  }

  for (const fileSymbols of indexCache.values()) {
    const symbol = fileSymbols.find(
      (candidate) => candidate.name === symbolName && DEFINITION_SYMBOL_TYPES.has(candidate.type),
    );
    if (symbol) {
      return symbol;
    }
  }

  return null;
}

/** 获取指定文件的代码大纲（符号列表），支持按类型过滤 */
export async function getAceFileOutline(input: {
  basePath: string;
  filePath: string;
  options?: {
    maxResults?: number;
    includeContext?: boolean;
    symbolTypes?: SymbolType[];
  };
}): Promise<CodeSymbol[]> {
  const { basePath, filePath, options } = input;

  try {
    const effectivePath = path.resolve(basePath, filePath);
    const content = await fs.readFile(effectivePath, "utf8");

    const maxResults =
      options?.maxResults && options.maxResults > 0
        ? Math.min(options.maxResults, MAX_FILE_OUTLINE_SYMBOLS)
        : MAX_FILE_OUTLINE_SYMBOLS;
    const includeContext = options?.includeContext !== false;

    let symbols = await parseFileSymbols(effectivePath, content, basePath, {
      includeContext,
      includeSignature: includeContext,
      maxSymbols: maxResults,
    });

    if (options?.symbolTypes && options.symbolTypes.length > 0) {
      symbols = symbols.filter((symbol) => options.symbolTypes!.includes(symbol.type));
    }

    symbols = sortOutlineSymbols(symbols).slice(0, maxResults);
    return constrainFileOutlinePayload(symbols, includeContext);
  } catch (error) {
    throw createInternalError(
      "INTERNAL_ERROR",
      `获取文件大纲失败 ${filePath}: ${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
}

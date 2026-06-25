/**
 * ACE file outline helpers.
 *
 * Keeps outline sorting and payload limiting outside ACECodeSearchService.
 */

import type { CodeSymbol, SymbolType } from "./types";
import { MAX_FILE_OUTLINE_PAYLOAD_CHARS } from "./constants";

const IMPORTANT_OUTLINE_TYPES = new Set<string>(["function", "class", "interface", "method"]);

/** 按重要性排序大纲符号（function/class/interface/method 优先） */
export function sortOutlineSymbols(symbols: CodeSymbol[]): CodeSymbol[] {
  return [...symbols].toSorted((a, b) => {
    const aImportant = IMPORTANT_OUTLINE_TYPES.has(a.type);
    const bImportant = IMPORTANT_OUTLINE_TYPES.has(b.type);
    if (aImportant && !bImportant) {
      return -1;
    }
    if (!aImportant && bImportant) {
      return 1;
    }
    return 0;
  });
}

/** 估算文件大纲序列化后的字节数 */
export function estimateFileOutlinePayloadChars(symbols: CodeSymbol[]): number {
  return JSON.stringify(symbols).length;
}

/** 限制文件大纲载荷大小，超限时逐步裁剪 context 和 signature */
export function constrainFileOutlinePayload(symbols: CodeSymbol[], includeContext: boolean): CodeSymbol[] {
  if (estimateFileOutlinePayloadChars(symbols) <= MAX_FILE_OUTLINE_PAYLOAD_CHARS) {
    return symbols;
  }

  let constrained = includeContext ? symbols.map((symbol) => ({ ...symbol, context: undefined })) : symbols;

  if (estimateFileOutlinePayloadChars(constrained) <= MAX_FILE_OUTLINE_PAYLOAD_CHARS) {
    return constrained;
  }

  constrained = constrained.map((symbol) => ({
    ...symbol,
    signature: undefined,
  }));

  return constrained;
}

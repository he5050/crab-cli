import { createLogger } from "@/core/logging/logger";
import { detectLanguage } from "@/lsp/language/language";
import type { LanguageInfo } from "@/lsp/language/language";
import type { CodeChunk } from "@/tool/codebaseSearch/indexer/vectorDb";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const log = createLogger("search:indexer");

/** 最大文件大小(字节)，超过此大小跳过 */
export const DEFAULT_MAX_FILE_SIZE = 100_000; // 100KB

/** Office/PDF 文档扩展名 */
export const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".pptx"]);

/** 每个分块的最大行数 */
const MAX_CHUNK_LINES = 80;

/** 分块重叠行数 */
const CHUNK_OVERLAP_LINES = 10;

/** 文档索引单块最大字符数，避免超长段落形成过大的 embedding 输入 */
const MAX_DOCUMENT_CHUNK_CHARS = 3000;

const INDEXABLE_LANGUAGE_IDS = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "python",
  "go",
  "rust",
  "java",
  "kotlin",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "swift",
  "lua",
  "zig",
  "shellscript",
]);

/** 判断语言是否属于可索引的源代码语言 @param lang 语言检测结果 @returns 是否可索引 */
export function isIndexableLanguage(lang: LanguageInfo | null): lang is LanguageInfo {
  return lang !== null && INDEXABLE_LANGUAGE_IDS.has(lang.languageId);
}

/**
 * 将文件内容分块。
 *
 * 策略:
 *   1. 代码文件按空行分段，超限时按行截断
 *   2. 相邻代码分块有 CHUNK_OVERLAP_LINES 行重叠
 *   3. Office/PDF 文档按段落和字符数切分
 */
export async function chunkIndexableFile(filePath: string): Promise<CodeChunk[]> {
  const ext = extname(filePath).toLowerCase();

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    return chunkDocument(filePath);
  }

  const lang = detectLanguage(filePath);
  if (!isIndexableLanguage(lang)) {
    return [];
  }

  let content: string;
  let mtime: number;

  try {
    const stat = statSync(filePath);
    content = readFileSync(filePath, "utf8");
    mtime = stat.mtimeMs;
  } catch {
    return [];
  }

  const lines = content.split("\n");
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    return [];
  }

  const chunks: CodeChunk[] = [];
  const segments = segmentByBlankLines(lines);

  let chunkStartLine = 1;
  let currentChunk: string[] = [];

  for (const segment of segments) {
    if (currentChunk.length + segment.lines.length > MAX_CHUNK_LINES && currentChunk.length > 0) {
      // 当前 chunk 已满，保存
      chunks.push(createChunk(filePath, chunkStartLine, currentChunk, lang, mtime));

      // 下一 chunk 带重叠
      const overlapLines = currentChunk.slice(-CHUNK_OVERLAP_LINES);
      chunkStartLine += currentChunk.length - CHUNK_OVERLAP_LINES;
      currentChunk = [...overlapLines, ...segment.lines];
    } else if (segment.lines.length > MAX_CHUNK_LINES) {
      // 单个段落超过限制，先保存当前 chunk
      if (currentChunk.length > 0) {
        chunks.push(createChunk(filePath, chunkStartLine, currentChunk, lang, mtime));
        chunkStartLine += currentChunk.length;
        currentChunk = [];
      }
      // 将段落按行数截断
      for (let i = 0; i < segment.lines.length; i += MAX_CHUNK_LINES) {
        const slice = segment.lines.slice(i, i + MAX_CHUNK_LINES)!;
        chunks.push(createChunk(filePath, chunkStartLine + i, slice, lang, mtime));
      }
      chunkStartLine += segment.lines.length;
    } else {
      currentChunk.push(...segment.lines);
    }
  }

  // 最后一个 chunk
  if (currentChunk.length > 0) {
    chunks.push(createChunk(filePath, chunkStartLine, currentChunk, lang, mtime));
  }

  return chunks;
}

async function chunkDocument(filePath: string): Promise<CodeChunk[]> {
  const { readOfficeDocument } = await import("@/tool/filesystem/utils/officeParser");

  try {
    const content = await readOfficeDocument(filePath);
    if (!content?.text) {
      return [];
    }

    const stat = statSync(filePath);
    const mtime = stat.mtimeMs;
    const fileHash = computeFileHash(filePath) ?? undefined;

    // 按双换行符分割段落
    const paragraphs = content.text.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const chunks: CodeChunk[] = [];

    let startLine = 1;
    for (const paragraph of paragraphs) {
      const lines = paragraph.split("\n");
      if (lines.length === 0) {
        continue;
      }

      for (const segment of splitDocumentParagraph(paragraph)) {
        const segmentStartLine = startLine + segment.startLineOffset;
        const segmentEndLine = startLine + segment.endLineOffset;
        chunks.push({
          content: segment.content,
          endLine: segmentEndLine,
          fileHash,
          fileMtime: mtime,
          filePath,
          id: `${filePath}:${segmentStartLine}:${segmentEndLine}:doc-${chunks.length + 1}`,
          languageId: content.fileType, // "word" / "excel" / "powerpoint" / "pdf"
          startLine: segmentStartLine,
        });
      }

      startLine += lines.length + 1; // +1 for blank line separator
    }

    return chunks;
  } catch (error) {
    log.warn(`文档分块失败: ${filePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function splitDocumentParagraph(paragraph: string): {
  content: string;
  startLineOffset: number;
  endLineOffset: number;
}[] {
  const chunks: { content: string; startLineOffset: number; endLineOffset: number }[] = [];
  const lines = paragraph.split("\n");
  let currentLines: string[] = [];
  let currentLength = 0;
  let currentStartOffset = 0;
  let currentEndOffset = 0;

  const flush = () => {
    if (currentLines.length === 0) {
      return;
    }
    chunks.push({
      content: currentLines.join("\n"),
      endLineOffset: currentEndOffset,
      startLineOffset: currentStartOffset,
    });
    currentLines = [];
    currentLength = 0;
  };

  lines.forEach((line, lineOffset) => {
    const parts = splitLongDocumentLine(line);

    for (const part of parts) {
      const separatorLength = currentLines.length > 0 ? 1 : 0;
      if (currentLines.length > 0 && currentLength + separatorLength + part.length > MAX_DOCUMENT_CHUNK_CHARS) {
        flush();
      }

      if (currentLines.length === 0) {
        currentStartOffset = lineOffset;
      }

      currentLines.push(part);
      currentLength += separatorLength + part.length;
      currentEndOffset = lineOffset;

      if (currentLength >= MAX_DOCUMENT_CHUNK_CHARS) {
        flush();
      }
    }
  });

  flush();
  return chunks;
}

function splitLongDocumentLine(line: string): string[] {
  if (line.length <= MAX_DOCUMENT_CHUNK_CHARS) {
    return [line];
  }

  const parts: string[] = [];
  for (let index = 0; index < line.length; index += MAX_DOCUMENT_CHUNK_CHARS) {
    parts.push(line.slice(index, index + MAX_DOCUMENT_CHUNK_CHARS));
  }
  return parts;
}

function createChunk(
  filePath: string,
  startLine: number,
  lines: string[],
  lang: LanguageInfo,
  mtime: number,
): CodeChunk {
  const fileHash = computeFileHash(filePath);
  return {
    content: lines.join("\n"),
    endLine: startLine + lines.length - 1,
    fileHash: fileHash ?? undefined,
    fileMtime: mtime,
    filePath,
    id: `${filePath}:${startLine}:${startLine + lines.length - 1}`,
    languageId: lang.languageId,
    startLine,
  };
}

/** 计算文件的 SHA256 哈希值 */
export function computeFileHash(filePath: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

function segmentByBlankLines(lines: string[]): { lines: string[] }[] {
  const segments: { lines: string[] }[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.trim() === "" && current.length > 0) {
      segments.push({ lines: current });
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    segments.push({ lines: current });
  }

  return segments;
}

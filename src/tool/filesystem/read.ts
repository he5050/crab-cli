/**
 * 文件读取工具 — 支持文本/图片/二进制元数据/目录列表/分段读取。
 *
 * 职责:
 *   - 读取文件内容(文本/图片/二进制)
 *   - 支持多文件批量读取
 *   - 支持目录列表
 *   - 支持 Office/PDF 内容解析
 *   - 每行附带内容哈希用于编辑锚定
 *
 * 模块功能:
 *   - fsReadTool: 文件读取工具定义
 *   - detectLineEnding: 检测文件行尾风格
 *   - convertLineEndings: 转换行尾风格
 *   - normalizeLineEndings: 规范化行尾为 LF
 *
 * 使用场景:
 *   - AI 需要读取文件内容
 *   - 批量读取多个文件
 *   - 解析 Office/PDF 文档
 *   - 获取目录列表
 *
 * 边界:
 *   1. 权限:fs.read
 *   2. 支持文本、图片、二进制元数据读取
 *   3. 多文件批量读取支持 string[] 和 {path,offset,limit}[]
 *   4. 内容哈希 (hashline) 用于编辑锚定
 *   5. 自动行尾规范化
 *   6. Office/PDF 解析依赖外部库
 *
 * 流程:
 *   1. 接收文件路径参数
 *   2. 检测文件类型
 *   3. 根据类型读取内容
 *   4. 生成内容哈希
 *   5. 返回读取结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { truncateToolOutput } from "@/tool/result/truncate";
import { formatBytes } from "@/core/utilities/textUtils";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getNotesForFile } from "@/tool/notebook/index";
import { validatePathWithinCwd } from "@/tool/filesystem/utils";
import { computeLineHash } from "@/tool/filesystem/utils/hashline";
import {
  IMAGE_EXTENSIONS,
  BINARY_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  readImage,
  readBinaryMeta,
  listDirectory,
} from "./readHelpers";
import { parseDocumentContent } from "./documentParsers";

const log = createLogger("tool:fs_read");

/** 默认最大读取行数 */
const DEFAULT_MAX_LINES = 2000;

// ── 参数 Schema ──────────────────────────────────────────────

/** 单个文件读取请求 */
const fileReadItem = z.object({
  limit: z.number().optional().describe("最大读取行数"),
  offset: z.number().optional().describe("起始行号(从 0 开始)"),
  path: z.string().describe("文件路径"),
});

/** 文件读取工具 — 支持单文件/批量/图片/目录/Office 解析 */
export const fsReadTool = defineTool({
  description:
    "读取文件内容。支持:(1) 单文件读取 (2) 多文件批量读取(传入 path 数组)" +
    "(3) 图片文件(返回 base64)(4) 二进制文件(返回元数据)" +
    "(5) 目录列表(返回子项)(6) Office/PDF 内容解析。" +
    "每行输出附带内容哈希 (hashline)，可用于编辑锚定。",
  execute: async (args) => {
    const filePath = normalizeReadPath(args.path, args.offset, args.limit);
    if (isInvalidPathResult(filePath)) {
      return filePath;
    }

    // 路径遍历防护(CWE-22) — 统一使用 validatePathWithinCwd
    if (typeof filePath === "string") {
      const err = validatePathWithinCwd(filePath);
      if (err) {
        return { error: err, path: filePath };
      }
    } else if (Array.isArray(filePath)) {
      for (const item of filePath) {
        if (typeof item === "string") {
          const err = validatePathWithinCwd(item);
          if (err) {
            return { error: err, path: item };
          }
        } else if (item && typeof item === "object" && "path" in item) {
          const p = item.path;
          if (p) {
            const err = validatePathWithinCwd(p);
            if (err) {
              return { error: err, path: p };
            }
          }
        }
      }
    }

    // G5: 多文件批量读取
    if (Array.isArray(filePath)) {
      return readMultipleFiles(filePath);
    }

    return readSingleFile(filePath, args.offset, args.limit);
  },
  name: "filesystem-read",
  parameters: z.object({
    /** 最大读取行数 */
    limit: z.number().optional().describe("最大读取行数，默认 2000"),
    /** 起始行号(从 0 开始)，仅对文本文件有效 */
    offset: z.number().optional().describe("起始行号(从 0 开始)，用于分段读取大文件"),
    /** 文件或目录路径(支持单个路径或路径数组) */
    path: z
      .union([
        z.string().describe("文件或目录的绝对路径或相对路径"),
        z.array(z.string()).describe("多个文件路径的数组"),
        z.array(fileReadItem).describe("多个文件读取请求(含 offset/limit)"),
      ])
      .describe("文件路径、路径数组或读取请求数组"),
  }),
  permission: "fs.read",
  builtin: true,
});

function normalizeReadPath(
  pathParam: string | string[] | { path: string; limit?: number; offset?: number }[],
  _offset?: number,
  _limit?: number,
):
  | string
  | (string | { path?: string; filePath?: string; file_path?: string; offset?: number; limit?: number })[]
  | Record<string, unknown> {
  if (pathParam === undefined || pathParam === null) {
    return invalidPathResult("缺少必填参数 path");
  }
  if (typeof pathParam === "string") {
    if (pathParam === "") {
      return invalidPathResult("缺少必填参数 path");
    }
    return pathParam;
  }
  return pathParam;
}

function invalidPathResult(message: string, filePath?: unknown): Record<string, unknown> {
  const pathLabel = typeof filePath === "string" && filePath ? filePath : "<missing>";
  log.warn(`读取失败: ${pathLabel}`, { error: message });
  return { error: message, path: pathLabel };
}

function isInvalidPathResult(value: unknown): value is Record<string, unknown> {
  return value !== null && Boolean(value) && !Array.isArray(value) && typeof value === "object" && "error" in value;
}

// ── 单文件读取 ────────────────────────────────────────────────

function readSingleFile(filePath: string, offset?: number, limit?: number): Record<string, unknown> {
  if (typeof filePath !== "string" || !filePath) {
    return invalidPathResult("path 必须是非空字符串", filePath);
  }

  try {
    const fullPath = path.resolve(filePath);
    const stat = fs.statSync(fullPath);

    // 目录 → 列出内容
    if (stat.isDirectory()) {
      return listDirectory(fullPath);
    }

    const ext = path.extname(fullPath).toLowerCase();

    if (IMAGE_EXTENSIONS.has(ext)) {
      return readImage(fullPath, stat);
    }

    // G17: Office/PDF 内容解析
    if (DOCUMENT_EXTENSIONS.has(ext)) {
      return readDocument(fullPath, stat, ext);
    }

    if (BINARY_EXTENSIONS.has(ext)) {
      return readBinaryMeta(fullPath, stat, ext);
    }

    // 文本文件
    return readTextFile(fullPath, offset, limit);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`读取失败: ${filePath}`, { error: msg });
    return { error: msg, path: filePath };
  }
}

// ── G5: 多文件批量读取 ────────────────────────────────────────

function readMultipleFiles(
  paths: (string | { path?: string; filePath?: string; file_path?: string; offset?: number; limit?: number })[],
): Record<string, unknown> {
  const results: Record<string, unknown>[] = [];

  for (const item of paths) {
    if (typeof item === "string") {
      results.push(readSingleFile(item));
    } else {
      const itemPath = item.path ?? item.filePath ?? item.file_path;
      results.push(readSingleFile(itemPath ?? "<missing>", item.offset, item.limit));
    }
  }

  return {
    failCount: results.filter((r) => Boolean(r.error)).length,
    results,
    successCount: results.filter((r) => !r.error).length,
    totalFiles: results.length,
    type: "batch",
  };
}

// ── 文本文件读取(带 G6 hashline + G15 行尾规范化)──────────────

function readTextFile(filePath: string, offset?: number, limit?: number): Record<string, unknown> {
  let content = fs.readFileSync(filePath, "utf8");

  // G15: 行尾规范化 — 统一 \r\n 和 \r 为 \n
  content = normalizeLineEndings(content);

  const lines = content.split("\n");
  const totalLines = lines.length;

  const startLine = offset ?? 0;
  const maxLines = limit ?? DEFAULT_MAX_LINES;
  const endLine = Math.min(startLine + maxLines, totalLines);
  const sliced = lines.slice(startLine, endLine);

  // G6: hashline — 每行附带短 hash
  const numbered = sliced
    .map((line, i) => {
      const lineNum = startLine + i + 1;
      const hash = computeLineHash(line);
      return `${lineNum}:${hash}\t${line}`;
    })
    .join("\n");

  // 截断检查
  const truncResult = truncateToolOutput(numbered);
  const result: Record<string, unknown> = {
    content: truncResult.content,
    endLine,
    path: filePath,
    startLine: startLine + 1,
    totalLines,
  };

  if (truncResult.truncated) {
    result.truncated = true;
    result.fullOutputPath = truncResult.outputPath;
  }

  const notes = getNotesForFile(filePath, process.cwd());
  if (notes.length > 0) {
    result.knowledge = notes.map((n) => `[${n.title}] ${n.content}`).join("\n---\n");
  }

  return result;
}

// ── G15: 行尾规范化 ───────────────────────────────────────────

/** 将 \r\n 和 \r 统一为 \n */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** 检测文件的主要行尾风格 */
export function detectLineEnding(text: string): "\n" | "\r\n" | "\r" {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;

  if (crlf >= lf && crlf >= cr) {
    return "\r\n";
  }
  if (cr >= lf) {
    return "\r";
  }
  return "\n";
}

/** 将文本转换为指定的行尾风格 */
export function convertLineEndings(text: string, target: "\n" | "\r\n" | "\r"): string {
  const normalized = normalizeLineEndings(text);
  if (target === "\r\n") {
    return normalized.replace(/\n/g, "\r\n");
  }
  if (target === "\r") {
    return normalized.replace(/\n/g, "\r");
  }
  return normalized;
}

// ── G17: Office/PDF 内容解析 ──────────────────────────────────

function readDocument(filePath: string, stat: fs.Stats, ext: string): Record<string, unknown> {
  const base = {
    extension: ext,
    modified: stat.mtime.toISOString(),
    path: filePath,
    size: formatBytes(stat.size),
    sizeBytes: stat.size,
    type: "document",
  };

  // 尝试解析文件内容
  try {
    const content = parseDocumentContent(filePath, ext);
    if (content) {
      return { ...base, content, parsed: true };
    }
  } catch (error) {
    log.debug(`文档解析失败，回退到元数据: ${filePath}`, { error: String(error) });
  }

  // 解析失败时返回元数据
  return {
    ...base,
    message: `文档文件 (${ext})，解析未成功。大小: ${formatBytes(stat.size)}`,
    parsed: false,
  };
}

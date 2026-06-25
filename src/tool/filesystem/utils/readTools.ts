/**
 * 读取工具核心逻辑 — 文件读取执行引擎。
 *
 * 职责:
 *   - 执行文件读取核心逻辑
 *   - 支持多种文件类型
 *   - 提供读取上下文
 *   - 统一读取结果格式
 *
 * 模块功能:
 *   - executeGetFileContentCore: 统一文件读取核心
 *   - 文本文件读取
 *   - 图片文件读取
 *   - Office 文档读取
 *   - 目录列表读取
 *
 * 使用场景:
 *   - 文件读取工具复用
 *   - 批量读取操作
 *   - 单元测试
 *   - 多类型文件处理
 *
 * 边界:
 *   1. 支持文本/图片/文档/目录
 *   2. 提供读取上下文
 *   3. 统一结果格式
 *   4. 路径验证
 *   5. 错误处理
 *
 * 流程:
 *   1. 接收文件路径和上下文
 *   2. 验证路径
 *   3. 检测文件类型
 *   4. 执行对应读取逻辑
 *   5. 返回统一格式结果
 */

import { promises as fs } from "node:fs";
import { isAbsolute } from "node:path";
import { createInternalError } from "@/core/errors/appError";
import { actionImage, iconError, iconFile, iconFolder } from "@/core/icons/icon";

/** 读取上下文(由工具定义注入) */
export interface GetFileContentContext {
  basePath: string;
  resolvePath: (filePath: string, contextPath?: string) => string;
  validatePath: (fullPath: string) => Promise<void>;
  listFiles: (dirPath?: string) => Promise<string[]>;
  isImageFile: (filePath: string) => boolean;
  readImageAsBase64: (fullPath: string) => Promise<{ type: "image"; data: string; mimeType: string } | null>;
  isOfficeFile: (filePath: string) => boolean;
  readOfficeDocument: (fullPath: string) => Promise<{
    type: "document";
    text: string;
    fileType: string;
    metadata?: Record<string, unknown>;
  } | null>;
}

/** 单文件读取结果 */
export interface SingleFileReadResult {
  content: string | { type: string; text?: string; data?: string; mimeType?: string }[];
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  isImage?: boolean;
  isDocument?: boolean;
  mimeType?: string;
  fileType?: string;
}

/** 多文件读取结果 */
export interface MultipleFilesReadResult {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  files: {
    path: string;
    startLine?: number;
    endLine?: number;
    totalLines?: number;
    isImage?: boolean;
    isDocument?: boolean;
    fileType?: string;
    mimeType?: string;
  }[];
  totalFiles: number;
}

/** 文件大小限制 */
const FILE_SIZE_LIMIT = 256 * 1024 * 1024;

/**
 * 统一的文件读取核心。
 *
 * 支持:
 *   - 单文件读取(文本/图片/文档/目录)
 *   - 多文件批量读取(路径数组或配置对象数组)
 *   - 大文件流式分段读取
 *   - hashline 格式化输出
 */
export async function executeGetFileContentCore(
  ctx: GetFileContentContext,
  filePath: string | string[] | { path: string; startLine?: number; endLine?: number }[],
  startLine?: number,
  endLine?: number,
): Promise<SingleFileReadResult | MultipleFilesReadResult> {
  // 多文件批量读取
  if (Array.isArray(filePath)) {
    return readMultipleFiles(ctx, filePath, startLine, endLine);
  }

  return readSingleFile(ctx, filePath, startLine, endLine);
}

// ────────────────────────────────────────────────────────────────
// 多文件批量读取
// ────────────────────────────────────────────────────────────────

async function readMultipleFiles(
  ctx: GetFileContentContext,
  filePaths: (string | { path: string; startLine?: number; endLine?: number })[],
  defaultStartLine?: number,
  defaultEndLine?: number,
): Promise<MultipleFilesReadResult> {
  const filesData: MultipleFilesReadResult["files"] = [];
  const multimodalContent: MultipleFilesReadResult["content"] = [];
  let lastAbsolutePath: string | undefined;

  for (const fileItem of filePaths) {
    try {
      let file: string;
      let fileStartLine: number | undefined;
      let fileEndLine: number | undefined;

      if (typeof fileItem === "string") {
        file = fileItem;
        fileStartLine = defaultStartLine;
        fileEndLine = defaultEndLine;
      } else {
        file = fileItem.path;
        fileStartLine = fileItem.startLine ?? defaultStartLine;
        fileEndLine = fileItem.endLine ?? defaultEndLine;
      }

      const fullPath = ctx.resolvePath(file, lastAbsolutePath);

      if (isAbsolute(file)) {
        lastAbsolutePath = fullPath;
      }

      if (!isAbsolute(file)) {
        await ctx.validatePath(fullPath);
      }

      const stats = await fs.stat(fullPath);

      // 目录 → 列出内容
      if (stats.isDirectory()) {
        const dirFiles = await ctx.listFiles(file);
        const fileList = dirFiles.join("\n");
        multimodalContent.push({
          text: `${iconFolder} Directory: ${file}\n${fileList}`,
          type: "text",
        });
        filesData.push({
          endLine: dirFiles.length,
          path: file,
          startLine: 1,
          totalLines: dirFiles.length,
        });
        continue;
      }

      // 图片
      if (ctx.isImageFile(fullPath)) {
        const imageContent = await ctx.readImageAsBase64(fullPath);
        if (imageContent) {
          multimodalContent.push({
            text: `${actionImage} Image: ${file} (${imageContent.mimeType})`,
            type: "text",
          });
          multimodalContent.push(imageContent);
          filesData.push({
            isImage: true,
            mimeType: imageContent.mimeType,
            path: file,
          });
          continue;
        }
      }

      // Office 文档
      if (ctx.isOfficeFile(fullPath)) {
        const docContent = await ctx.readOfficeDocument(fullPath);
        if (docContent) {
          multimodalContent.push({
            text: `${iconFile} ${docContent.fileType.toUpperCase()} Document: ${file}`,
            type: "text",
          });
          multimodalContent.push({
            text: docContent.text,
            type: "text",
          });
          filesData.push({
            fileType: docContent.fileType,
            isDocument: true,
            path: file,
          });
          continue;
        }
      }

      // 文本文件
      const result = await readTextFileContent(fullPath, file, fileStartLine, fileEndLine, stats.size);
      multimodalContent.push({ text: result.content, type: "text" });
      filesData.push({
        endLine: result.endLine,
        path: file,
        startLine: result.startLine,
        totalLines: result.totalLines,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      const inputPath = typeof fileItem === "string" ? fileItem : fileItem.path;
      multimodalContent.push({
        text: `${iconError} ${inputPath}\n   Error: ${errorMsg}`,
        type: "text",
      });
    }
  }

  return {
    content: multimodalContent,
    files: filesData,
    totalFiles: filePaths.length,
  };
}

// ────────────────────────────────────────────────────────────────
// 单文件读取
// ────────────────────────────────────────────────────────────────

async function readSingleFile(
  ctx: GetFileContentContext,
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<SingleFileReadResult> {
  const fullPath = ctx.resolvePath(filePath);
  if (!isAbsolute(filePath)) {
    await ctx.validatePath(fullPath);
  }

  const stats = await fs.stat(fullPath);

  // 目录
  if (stats.isDirectory()) {
    const files = await ctx.listFiles(filePath);
    const fileList = files.join("\n");
    const lines = fileList.split("\n");
    return {
      content: `Directory: ${filePath}\n\n${fileList}`,
      endLine: lines.length,
      startLine: 1,
      totalLines: lines.length,
    };
  }

  // 图片
  if (ctx.isImageFile(fullPath)) {
    const imageContent = await ctx.readImageAsBase64(fullPath);
    if (imageContent) {
      return {
        content: [{ text: `${actionImage} Image: ${filePath} (${imageContent.mimeType})`, type: "text" }, imageContent],
        isImage: true,
        mimeType: imageContent.mimeType,
      };
    }
  }

  // Office 文档
  if (ctx.isOfficeFile(fullPath)) {
    const docContent = await ctx.readOfficeDocument(fullPath);
    if (docContent) {
      return {
        content: [
          { text: `${iconFile} ${docContent.fileType.toUpperCase()} Document: ${filePath}`, type: "text" },
          { text: docContent.text, type: "text" },
        ],
        fileType: docContent.fileType,
        isDocument: true,
      };
    }
  }

  // 文本文件
  const result = await readTextFileContent(fullPath, filePath, startLine, endLine, stats.size);
  return {
    content: result.content,
    endLine: result.endLine,
    startLine: result.startLine,
    totalLines: result.totalLines,
  };
}

// ────────────────────────────────────────────────────────────────
// 文本文件读取(内部)
// ────────────────────────────────────────────────────────────────

async function readTextFileContent(
  fullPath: string,
  displayPath: string,
  startLine?: number,
  endLine?: number,
  fileSizeBytes?: number,
): Promise<{ content: string; startLine: number; endLine: number; totalLines: number }> {
  // 动态导入 encoding utils 以使用流式读取
  const { readFileWithEncoding, readFileLinesStreaming } = await import("@/tool/filesystem/utils/encoding");
  const { formatLineWithHash } = await import("@/tool/filesystem/utils/hashline");

  let content: string | undefined;
  let lines: string[];
  let totalLines: number;
  const size = fileSizeBytes ?? (await fs.stat(fullPath)).size;

  if (size > FILE_SIZE_LIMIT) {
    const actualStart = startLine ?? 1;
    const actualEnd = endLine ?? 500;
    if (actualStart < 1) {
      throw createInternalError("INTERNAL_ERROR", `Start line must be greater than 0 for ${displayPath}`);
    }
    const streamed = await readFileLinesStreaming(fullPath, actualStart, actualEnd);
    lines = streamed.lines;
    totalLines = streamed.totalLines;
  } else {
    content = await readFileWithEncoding(fullPath);
    lines = content.split("\n");
    totalLines = lines.length;
  }

  const actualStartLine = startLine ?? 1;
  const actualEndLine = size > FILE_SIZE_LIMIT ? (endLine ?? 500) : (endLine ?? totalLines);

  if (actualStartLine < 1) {
    throw createInternalError("INTERNAL_ERROR", `Start line must be greater than 0 for ${displayPath}`);
  }
  if (actualEndLine < actualStartLine) {
    throw createInternalError(
      "INTERNAL_ERROR",
      `End line must be greater than or equal to start line for ${displayPath}`,
    );
  }

  const start = Math.min(actualStartLine, totalLines);
  const end = Math.min(totalLines, actualEndLine);
  const selectedLines = size > FILE_SIZE_LIMIT ? lines : lines.slice(start - 1, end);

  // Hashline 格式化
  const numberedLines = selectedLines.map((line, index) => formatLineWithHash(start + index, line));

  const sizeWarning = size > FILE_SIZE_LIMIT ? ` [Large file: ${Math.round(size / 1024 / 1024)}MB]` : "";

  const fileContent = `${iconFile} ${displayPath} (lines ${start}-${end}/${totalLines})${sizeWarning}\n${numberedLines.join("\n")}`;

  return {
    content: fileContent,
    endLine: end,
    startLine: start,
    totalLines,
  };
}

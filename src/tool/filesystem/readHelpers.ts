/**
 * 文件读取辅助 — 图片、二进制元数据、目录列表的读取函数。
 */
import { formatBytes } from "@/core/utilities/textUtils";
import fs from "node:fs";
import path from "node:path";

/** 图片扩展名 */
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg"]);

/** 二进制文件扩展名 */
export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".sqlite",
  ".db",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

/** Office/PDF 扩展名 */
export const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt"]);

/** 读取图片文件(返回 base64) */
export function readImage(filePath: string, stat: fs.Stats): Record<string, unknown> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = extToMimeType(ext);
  const data = fs.readFileSync(filePath);
  const base64 = data.toString("base64");

  return {
    data: base64,
    mimeType,
    path: filePath,
    size: stat.size,
    type: "image",
  };
}

/** 读取二进制文件元数据 */
export function readBinaryMeta(filePath: string, stat: fs.Stats, ext: string): Record<string, unknown> {
  return {
    extension: ext,
    message: `二进制文件 (${ext})，无法直接读取内容。大小: ${formatBytes(stat.size)}`,
    modified: stat.mtime.toISOString(),
    path: filePath,
    size: formatBytes(stat.size),
    sizeBytes: stat.size,
    type: "binary",
  };
}

/** 列出目录内容 */
export function listDirectory(dirPath: string): Record<string, unknown> {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const items = entries.map((entry) => {
    const childPath = path.join(dirPath, entry.name);
    try {
      const childStat = fs.statSync(childPath);
      return {
        name: entry.name,
        size: entry.isDirectory() ? undefined : formatBytes(childStat.size),
        type: entry.isDirectory() ? "directory" : "file",
      };
    } catch {
      return { name: entry.name, type: "unknown" };
    }
  });

  const directories = items.filter((i) => i.type === "directory");
  const files = items.filter((i) => i.type === "file");

  return {
    entries: [...directories, ...files],
    path: dirPath,
    totalDirectories: directories.length,
    totalFiles: files.length,
    type: "directory",
  };
}

function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

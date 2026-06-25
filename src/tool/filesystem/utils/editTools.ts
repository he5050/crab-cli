/**
 * 编辑工具核心逻辑 — 搜索替换和 hashline 编辑的聚合入口。
 *
 * 拆分为:
 *   - editBySearch.ts: 搜索替换编辑 (executeEditBySearchSingle)
 *   - editByHashline.ts: hashline 锚点编辑 (executeHashlineEditSingle)
 *
 * 本文件保留:
 *   - 共享类型定义 (EditToolContext, HashlineOperation)
 *   - 共享工具函数 (tryPrettierFormat)
 *   - re-export 公共 API
 */

import path from "node:path";
import { writeFileWithEncoding } from "@/tool/filesystem/utils/encoding";

// ── 共享类型 ──────────────────────────────────────────────────────

/** 编辑工具上下文(由工具定义注入) */
export interface EditToolContext {
  basePath: string;
  sessionId?: string;
  resolvePath: (filePath: string, contextPath?: string) => string;
  validatePath: (fullPath: string) => Promise<void>;
  prettierSupportedExtensions?: string[];
}

/** Hashline 操作类型 */
export interface HashlineOperation {
  type: "replace" | "insert_after" | "delete";
  startAnchor: string;
  endAnchor?: string;
  content?: string;
}

// ── 共享工具函数 ──────────────────────────────────────────────────

/** Prettier 格式化结果 */
interface PrettierFormatResult {
  content: string;
  lines: string[];
  totalLines: number;
  formatted: boolean;
}

/** 尝试使用 Prettier 格式化文件内容，失败时返回原始内容 */
export async function tryPrettierFormat(
  fullPath: string,
  content: string,
  ctx: EditToolContext,
): Promise<PrettierFormatResult> {
  const ext = path.extname(fullPath).toLowerCase();
  const shouldFormat = ctx.prettierSupportedExtensions?.includes(ext) ?? false;
  if (!shouldFormat) {
    const lines = content.split("\n");
    return { content, formatted: false, lines, totalLines: lines.length };
  }
  try {
    // @ts-expect-error — prettier 是可选依赖
    const prettier = await import("prettier");
    const prettierConfig = await prettier.resolveConfig(fullPath);
    const formatted = await prettier.format(content, {
      filepath: fullPath,
      ...prettierConfig,
    });
    await writeFileWithEncoding(fullPath, formatted);
    const lines = formatted.split("\n");
    return { content: formatted, formatted: true, lines, totalLines: lines.length };
  } catch {
    const lines = content.split("\n");
    return { content, formatted: false, lines, totalLines: lines.length };
  }
}

// ── re-export 公共 API ─────────────────────────────────────────────

export { executeEditBySearchSingle } from "./editBySearch";
export type { EditBySearchSingleResult } from "./editBySearch";
export { executeHashlineEditSingle } from "./editByHashline";
export type { EditByHashlineSingleResult } from "./editByHashline";

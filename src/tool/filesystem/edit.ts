/**
 * 文件编辑工具 — 搜索替换的工具层封装。
 *
 * 职责:
 *   - 提供 filesystem-edit 工具定义
 *   - 处理文件锁和权限
 *   - 参数验证和转换
 *   - 调用 editTools 核心引擎
 *
 * 架构:
 *   - Tool Layer (本文件): 权限、锁、参数转换
 *   - Engine Layer (editTools): 核心编辑逻辑
 *
 * 使用场景:
 *   - AI 调用 filesystem-edit 工具修改文件
 *   - 需要文件锁保护的编辑操作
 *
 * 边界:
 *   1. 权限:fs.edit
 *   2. 使用文件锁进行并发保护
 *   3. 委托核心逻辑给 editTools
 *
 * 流程:
 *   1. 接收文件路径和编辑参数
 *   2. 获取文件锁
 *   3. 调用 editTools.executeEditBySearchSingle
 *   4. 释放文件锁
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { acquireFileLock } from "@/tool/filesystem/fileLock";
import { executeEditBySearchSingle } from "@/tool/filesystem/utils/editTools";
import type { EditToolContext } from "@/tool/filesystem/utils/editTools";
import { convertLineEndings, detectLineEnding } from "@/tool/filesystem/read";
import { computeLineHash } from "@/tool/filesystem/utils/hashline";
import { countMatches } from "@/tool/shared";
import { buildFallbackSnapshotNotice, recordFileMutation } from "@/tool/rollback";
import { backupFileBeforeMutation } from "@/tool/filesystem/utils/backup";

const log = createLogger("tool:fs_edit");

/** 文件编辑工具，支持搜索替换、模糊匹配和 hashline 锚点验证 */
export const fsEditTool = defineTool({
  description:
    "编辑文件:通过搜索旧文本并替换为新文本来修改文件内容。" +
    "支持单处和多处替换。精确匹配失败时自动尝试模糊匹配(空白差异容忍)。" +
    "会显示修改前后的 diff。" +
    "如果需要创建新文件或完全覆盖文件内容，请使用 filesystem-write。",
  execute: async ({ path: filePath, oldText, newText, replaceAll, occurrence, lineHashes, startLine }, context) => {
    try {
      const fullPath = path.resolve(filePath);

      if (!fs.existsSync(fullPath)) {
        return { error: `文件不存在: ${fullPath}`, path: fullPath, success: false };
      }

      // 获取文件锁
      const release = await acquireFileLock(fullPath);

      try {
        const original = fs.readFileSync(fullPath, "utf8");
        const anchorErrors = validateLineHashes(original, oldText, lineHashes, startLine);
        if (anchorErrors.length > 0) {
          return {
            anchorErrors,
            error: `文件内容已被修改，编辑锚点失效:${anchorErrors.join("; ")}。请重新读取文件后再编辑。`,
            path: fullPath,
            success: false,
          };
        }

        const exactMatches = countMatches(original, oldText);
        if (exactMatches > 0) {
          const exact = applyExactReplacement(original, oldText, newText, replaceAll, occurrence, exactMatches);
          if (!exact.success) {
            return { ...exact, path: fullPath };
          }

          const lineEnding = detectLineEnding(original);
          const finalContent = lineEnding === "\n" ? exact.content : convertLineEndings(exact.content, lineEnding);

          backupFileBeforeMutation(fullPath);
          fs.writeFileSync(fullPath, finalContent, "utf8");

          let rollbackId: string | undefined;
          let fallbackSnapshotNotice: string | undefined;
          if (original !== finalContent) {
            rollbackId = recordFileMutation({
              after: finalContent,
              before: original,
              filePath: fullPath,
              projectDir: process.cwd(),
              reason: "filesystem-edit",
              sessionId: context?.sessionId,
            }).id;
            fallbackSnapshotNotice = buildFallbackSnapshotNotice(process.cwd());
          }

          log.info(`文件已编辑: ${fullPath} (${exact.replacements} 处替换)`);
          return {
            diff: generateDiff(original, finalContent, fullPath),
            lineCountAfter: finalContent.split("\n").length,
            lineCountBefore: original.split("\n").length,
            path: fullPath,
            replacements: exact.replacements,
            success: true,
            totalMatches: exactMatches,
            ...(rollbackId && { rollbackId }),
            ...(fallbackSnapshotNotice && { fallbackSnapshotNotice }),
          };
        }

        // 创建编辑上下文
        const ctx: EditToolContext = {
          basePath: process.cwd(),
          resolvePath: (p: string) => path.resolve(p),
          sessionId: context?.sessionId,
          validatePath: async () => {}, // 已经验证过了
        };

        // 计算 occurrence 参数(editTools 使用 0=全部，1=第一处，N=第N处)
        let occurrenceParam = 1; // 默认第一处
        if (replaceAll || occurrence === 0) {
          occurrenceParam = 1; // 行级引擎不支持 0=全部，精确 replaceAll 已在上方处理
        } else if (occurrence && occurrence > 0) {
          occurrenceParam = occurrence;
        }

        // 调用核心引擎
        const result = await executeEditBySearchSingle(
          ctx,
          fullPath,
          oldText,
          newText,
          occurrenceParam,
          3, // ContextLines
        );

        log.info(`文件已编辑: ${fullPath}`);

        // 检测是否使用了模糊匹配(message 中包含 "fuzzy matching" 关键词)
        const usedFuzzy = result.message.toLowerCase().includes("fuzzy");
        const similarityMatch = result.message.match(/fuzzy match:\s*(\d+)%/i);
        const similarity = similarityMatch ? Number(similarityMatch[1]) / 100 : undefined;
        const fallbackSnapshotNotice = buildFallbackSnapshotNotice(process.cwd());

        return {
          contextEndLine: result.contextEndLine,
          contextStartLine: result.contextStartLine,
          diff: generateDiff(
            result.completeOldContent ?? result.oldContent,
            result.completeNewContent ?? result.newContent,
            fullPath,
          ),
          lineCountAfter: result.newContent.split("\n").length,
          lineCountBefore: result.oldContent.split("\n").length,
          message: result.message,
          path: fullPath,
          replacements: 1,
          success: true,
          totalLines: result.totalLines,
          totalMatches: 1,
          ...(usedFuzzy && { fuzzyMatch: true }),
          ...(similarity !== undefined && { similarity }),
          ...(fallbackSnapshotNotice && { fallbackSnapshotNotice }),
          ...(result.matchLocation && {
            matchLocation: result.matchLocation,
          }),
          ...(result.structureAnalysis.indentationWarnings.length > 0 && {
            bracketBalance: result.structureAnalysis.bracketBalance,
            structureWarnings: result.structureAnalysis.indentationWarnings,
          }),
          ...(result.diagnostics &&
            result.diagnostics.length > 0 && {
              diagnostics: result.diagnostics,
            }),
        };
      } finally {
        release();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`编辑失败: ${filePath}`, { error: msg });

      // 转换错误消息格式以兼容测试
      let errorMsg = msg;
      if (msg.includes("Search content not found")) {
        errorMsg = `未找到匹配文本(已尝试精确匹配和模糊匹配)${
          msg.includes("What you searched for") ? `\n\n${msg.split("What you searched for")[1]}` : ""
        }`;
      }

      return { error: errorMsg, path: filePath, success: false };
    }
  },
  name: "filesystem-edit",
  parameters: z.object({
    /** Hash-anchored 编辑:从 read 输出的 hashline 中提取的行 hash 映射，用于验证行内容未被篡改 */
    lineHashes: z
      .record(z.string(), z.string())
      .optional()
      .describe("行号→hash 映射(来自 read 输出的 hashline)，用于验证编辑锚点"),
    /** 替换的新文本 */
    newText: z.string().describe("替换后的新文本"),
    /** 指定替换第 N 处匹配(从 1 开始，与 replaceAll 互斥) */
    occurrence: z.number().optional().describe("指定替换第 N 处匹配(从 1 开始)。不传=第一处，0=全部，N=第 N 处"),
    /** 搜索的旧文本 */
    oldText: z.string().describe("要搜索替换的原始文本"),
    /** 文件路径 */
    path: z.string().describe("要编辑的文件路径(绝对或相对)"),
    /** 是否替换所有匹配(默认只替换第一处) */
    replaceAll: z.boolean().optional().describe("是否替换所有匹配项(默认 false = 只替换第一处)"),
    /** 指定 oldText 起始行号(配合 lineHashes 使用) */
    startLine: z.number().optional().describe("oldText 在文件中的起始行号(从 1 开始)，配合 lineHashes 锚定"),
  }),
  permission: "fs.edit",
  builtin: true,
});

function validateLineHashes(
  content: string,
  oldText: string,
  lineHashes?: Record<string, string>,
  startLine?: number,
): string[] {
  if (!lineHashes || !startLine) {
    return [];
  }

  const lines = content.split("\n");
  const anchorLines = oldText.split("\n");
  const errors: string[] = [];

  for (let i = 0; i < anchorLines.length; i++) {
    const lineNum = startLine + i;
    const expectedHash = lineHashes[String(lineNum)];
    if (!expectedHash) {
      continue;
    }

    const actualLine = lines[lineNum - 1];
    if (actualLine === undefined) {
      errors.push(`行 ${lineNum} 不存在(文件只有 ${lines.length} 行)`);
      continue;
    }

    const actualHash = computeLineHash(actualLine);
    if (actualHash !== expectedHash) {
      errors.push(`行 ${lineNum} 内容已被修改(hash 不匹配:期望 ${expectedHash}，实际 ${actualHash})`);
    }
  }

  return errors;
}

function findNthOccurrence(text: string, search: string, n: number): number {
  if (search.length === 0 || n < 1) {
    return -1;
  }
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(search, idx)) !== -1) {
    count++;
    if (count === n) {
      return idx;
    }
    idx += search.length;
  }
  return -1;
}

function applyExactReplacement(
  original: string,
  oldText: string,
  newText: string,
  replaceAll: boolean | undefined,
  occurrence: number | undefined,
  exactMatches: number,
): { success: true; content: string; replacements: number } | { success: false; error: string; totalMatches: number } {
  if (replaceAll || occurrence === 0) {
    return { content: original.split(oldText).join(newText), replacements: exactMatches, success: true };
  }

  const targetOccurrence = occurrence && occurrence > 0 ? occurrence : 1;
  const idx = findNthOccurrence(original, oldText, targetOccurrence);
  if (idx === -1) {
    return {
      error: `只有 ${exactMatches} 处匹配，但请求替换第 ${targetOccurrence} 处。`,
      success: false,
      totalMatches: exactMatches,
    };
  }

  return {
    content: original.slice(0, idx) + newText + original.slice(idx + oldText.length),
    replacements: 1,
    success: true,
  };
}

function generateDiff(oldText: string, newText: string, filePath: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lines: string[] = [];

  lines.push(`--- ${filePath} (before)`);
  lines.push(`+++ ${filePath} (after)`);

  const maxLen = Math.max(oldLines.length, newLines.length);
  let changeStart = -1;
  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== newLines[i]) {
      changeStart = i;
      break;
    }
  }

  if (changeStart === -1) {
    return "";
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= 0 && newEnd >= 0 && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const changeEnd = Math.max(oldEnd, newEnd);
  const contextStart = Math.max(0, changeStart - 3);
  const contextEnd = Math.min(maxLen - 1, changeEnd + 3);

  lines.push(
    `@@ -${contextStart + 1},${changeEnd - contextStart + 1} +${contextStart + 1},${changeEnd - contextStart + 1} @@`,
  );

  for (let i = contextStart; i <= contextEnd; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      lines.push(` ${oldLine ?? ""}`);
    } else {
      if (oldLine !== undefined) {
        lines.push(`-${oldLine}`);
      }
      if (newLine !== undefined) {
        lines.push(`+${newLine}`);
      }
    }
  }

  return lines.join("\n");
}

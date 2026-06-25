/**
 * Hashline 锚点编辑 — executeHashlineEditSingle 实现
 *
 * 职责:
 *   - 单文件 hashline 锚点编辑
 *   - 锚点验证与冲突检测
 *   - 从后往前应用操作(保持行号稳定)
 *   - 智能上下文处理
 *   - 可选 prettier 格式化
 *   - 结构分析与诊断收集
 */

import { isAbsolute } from "node:path";
import fs from "node:fs";
import type { StructureAnalysis } from "@/tool/filesystem/utils/codeAnalysis";
import { analyzeCodeStructure, findSmartContextBoundaries } from "@/tool/filesystem/utils/codeAnalysis";
import { readFileWithEncoding, writeFileWithEncoding } from "@/tool/filesystem/utils/encoding";
import { validateAnchor } from "@/tool/filesystem/utils/hashline";
import { formatLineWithHash } from "@/tool/filesystem/utils/hashline";
import { backupFileBeforeMutation } from "@/tool/filesystem/utils/backup";
import { recordFileMutation } from "@/tool/rollback";
import { appendStructureWarnings } from "@/tool/filesystem/utils/messageFormat";
import { createInternalError } from "@/core/errors/appError";
import { actionBullet, iconError, iconLsp, iconSearch, iconSuccess } from "@/core/icons/icon";
import type { EditToolContext, HashlineOperation } from "./editTools";
import { tryPrettierFormat } from "./editTools";

/** Hashline 编辑结果 */
export interface EditByHashlineSingleResult {
  message: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  replacedContent: string;
  operationsSummary: string;
  contextStartLine: number;
  contextEndLine: number;
  totalLines: number;
  structureAnalysis: StructureAnalysis;
  diagnostics?: any[];
}

/**
 * 单文件 hashline 锚点编辑。
 *
 * 流程:
 *   1. 验证所有锚点
 *   2. 检查操作冲突
 *   3. 从后往前应用操作(保持行号稳定)
 *   4. 写回 + 结构分析
 */
export async function executeHashlineEditSingle(
  ctx: EditToolContext,
  filePath: string,
  operations: HashlineOperation[],
  contextLines: number,
): Promise<EditByHashlineSingleResult> {
  try {
    const fullPath = ctx.resolvePath(filePath);
    if (!isAbsolute(filePath)) {
      await ctx.validatePath(fullPath);
    }

    if (!fs.existsSync(fullPath)) {
      throw createInternalError("INTERNAL_ERROR", `文件不存在: ${fullPath}`);
    }

    const content = await readFileWithEncoding(fullPath);
    const lines = content.split("\n");

    // 备份
    backupFileBeforeMutation(fullPath);

    interface PreparedOp {
      op: HashlineOperation;
      originalIndex: number;
      startLine: number;
      endLine: number;
    }

    const preparedOps: PreparedOp[] = [];
    const anchorErrors: string[] = [];

    // 验证锚点
    for (const [originalIndex, op] of operations.entries()) {
      const startV = validateAnchor(op.startAnchor, lines);
      if (!startV.valid) {
        anchorErrors.push(
          `Anchor "${op.startAnchor}" invalid${
            startV.expected && startV.actual
              ? ` (expected hash ${startV.expected}, actual ${startV.actual})`
              : startV.lineNum > 0
                ? ` (line ${startV.lineNum} out of range or hash mismatch)`
                : ' (bad format, expected "lineNum:hash")'
          }`,
        );
      }

      let endLine = startV.lineNum;
      let hasValidRange = startV.valid;
      const endAnchorMissing =
        op.endAnchor === undefined ||
        op.endAnchor === null ||
        (typeof op.endAnchor === "string" && op.endAnchor.trim() === "");

      if (endAnchorMissing) {
        anchorErrors.push(`Operation ${originalIndex + 1} (${op.type}): endAnchor is required.`);
        hasValidRange = false;
      } else {
        const endV = validateAnchor(op.endAnchor!, lines);
        if (!endV.valid) {
          anchorErrors.push(
            `Anchor "${op.endAnchor}" invalid${
              endV.expected && endV.actual
                ? ` (expected hash ${endV.expected}, actual ${endV.actual})`
                : endV.lineNum > 0
                  ? ` (line ${endV.lineNum} out of range or hash mismatch)`
                  : ' (bad format, expected "lineNum:hash")'
            }`,
          );
          hasValidRange = false;
        } else {
          endLine = endV.lineNum;
          if (startV.valid && endLine < startV.lineNum) {
            anchorErrors.push(`endAnchor line ${endLine} is before startAnchor line ${startV.lineNum}`);
            hasValidRange = false;
          }
        }
      }

      if ((op.type === "replace" || op.type === "insert_after") && op.content === undefined) {
        anchorErrors.push(`Operation "${op.type}" requires content`);
      }

      if (hasValidRange) {
        preparedOps.push({ endLine, op, originalIndex, startLine: startV.lineNum });
      }
    }

    if (anchorErrors.length > 0) {
      throw createInternalError(
        "INTERNAL_ERROR",
        `${iconError} Hashline anchor validation failed for ${filePath}:\n${anchorErrors
          .map((e) => `  ${actionBullet} ${e}`)
          .join(
            "\n",
          )}\n\n${iconLsp} The file may have changed since your last read. Re-read the file to get fresh anchors.`,
      );
    }

    // 冲突检测
    const conflictErrors: string[] = [];
    for (let i = 0; i < preparedOps.length; i++) {
      const current = preparedOps[i]!;
      for (let j = i + 1; j < preparedOps.length; j++) {
        const next = preparedOps[j]!;
        const sameStartLine = current.startLine === next.startLine;
        const bothInsertAfter = current.op.type === "insert_after" && next.op.type === "insert_after" && sameStartLine;
        if (bothInsertAfter) {
          continue;
        }

        const sameSingleLineAnchor =
          sameStartLine && current.startLine === current.endLine && next.startLine === next.endLine;
        const hasInsertAfter = current.op.type === "insert_after" || next.op.type === "insert_after";
        if (sameSingleLineAnchor && hasInsertAfter) {
          continue;
        }

        const overlaps = current.startLine <= next.endLine && next.startLine <= current.endLine;
        if (!overlaps) {
          continue;
        }

        conflictErrors.push(
          `Operation ${current.originalIndex + 1} (${current.op.type} ${current.startLine}-${current.endLine}) conflicts with operation ${next.originalIndex + 1} (${next.op.type} ${next.startLine}-${next.endLine})`,
        );
      }
    }

    if (conflictErrors.length > 0) {
      throw createInternalError(
        "INTERNAL_ERROR",
        `Hashline operations conflict for ${filePath}:\n${conflictErrors
          .map((e) => `  ${actionBullet} ${e}`)
          .join("\n")}\n\nUse non-overlapping anchors for the same file.`,
      );
    }

    // 从后往前排序(保持行号稳定)
    const sortedOps = [...preparedOps].toSorted((a, b) => {
      if (a.startLine !== b.startLine) {
        return b.startLine - a.startLine;
      }
      const aInsertAfter = a.op.type === "insert_after";
      const bInsertAfter = b.op.type === "insert_after";
      if (aInsertAfter && bInsertAfter) {
        return b.originalIndex - a.originalIndex;
      }
      if (aInsertAfter !== bInsertAfter) {
        return aInsertAfter ? -1 : 1;
      }
      if (a.endLine !== b.endLine) {
        return b.endLine - a.endLine;
      }
      return b.originalIndex - a.originalIndex;
    });

    // 应用操作
    let editStartLine = Infinity;
    let editEndLine = 0;
    const mutableLines = [...lines];
    const opSummaries: string[] = [];
    const hashlineContentRe = /^\s*\d+:[0-9a-fA-F]{2}→/;

    const sanitizeContent = (raw: string): string => {
      const contentLines = raw.split("\n");
      const hasHashlines =
        contentLines.length > 0 && contentLines.every((line) => line === "" || hashlineContentRe.test(line));
      if (!hasHashlines) {
        return raw;
      }
      return contentLines
        .map((line) => {
          let value = line;
          let match: RegExpExecArray | null;
          while ((match = hashlineContentRe.exec(value))) {
            value = value.slice(match[0].length);
          }
          return value;
        })
        .join("\n");
    };

    for (const preparedOp of sortedOps) {
      const { op, startLine, endLine } = preparedOp;
      editStartLine = Math.min(editStartLine, startLine);
      editEndLine = Math.max(editEndLine, endLine);

      switch (op.type) {
        case "replace": {
          const newLines = sanitizeContent(op.content ?? "").split("\n");
          mutableLines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
          opSummaries.push(`replace lines ${startLine}-${endLine} → ${newLines.length} line(s)`);
          break;
        }
        case "insert_after": {
          const newLines = sanitizeContent(op.content ?? "").split("\n");
          mutableLines.splice(startLine, 0, ...newLines);
          opSummaries.push(`insert ${newLines.length} line(s) after line ${startLine}`);
          break;
        }
        case "delete": {
          mutableLines.splice(startLine - 1, endLine - startLine + 1);
          opSummaries.push(`delete lines ${startLine}-${endLine}`);
          break;
        }
      }
    }

    const replacedContent = lines
      .slice(editStartLine - 1, editEndLine)
      .map((line, idx) => {
        const ln = editStartLine + idx;
        return formatLineWithHash(ln, line);
      })
      .join("\n");

    const smartBoundaries = findSmartContextBoundaries(lines, editStartLine, editEndLine, contextLines);
    const contextStart = smartBoundaries.start;
    const contextEnd = smartBoundaries.end;
    const oldContent = lines
      .slice(contextStart - 1, contextEnd)
      .map((line, idx) => {
        const ln = contextStart + idx;
        return formatLineWithHash(ln, line);
      })
      .join("\n");

    // 写回
    const modifiedContent = mutableLines.join("\n");
    await writeFileWithEncoding(fullPath, modifiedContent);

    // 可选 prettier 格式化
    const lineDifference = mutableLines.length - lines.length;
    const fmt = await tryPrettierFormat(fullPath, modifiedContent, ctx);
    const finalLines = fmt.lines;
    const finalTotalLines = fmt.totalLines;
    const finalContextEnd = fmt.formatted
      ? Math.min(finalTotalLines, contextStart + (contextEnd - contextStart) + lineDifference)
      : Math.min(finalTotalLines, contextEnd + lineDifference);

    const finalFileContent = fs.readFileSync(fullPath, "utf8");
    if (content !== finalFileContent) {
      recordFileMutation({
        after: finalFileContent,
        before: content,
        filePath: fullPath,
        projectDir: process.cwd(),
        reason: "filesystem-edit:hashline",
        sessionId: ctx.sessionId,
      });
    }

    const newContextContent = finalLines
      .slice(contextStart - 1, finalContextEnd)
      .map((line, idx) => {
        const ln = contextStart + idx;
        return formatLineWithHash(ln, line);
      })
      .join("\n");

    const structureAnalysis = analyzeCodeStructure(
      finalLines.join("\n"),
      filePath,
      finalLines.slice(editStartLine - 1, editStartLine - 1 + (editEndLine - editStartLine + 1)),
    );

    const result: EditByHashlineSingleResult = {
      contextEndLine: finalContextEnd,
      contextStartLine: contextStart,
      diagnostics: undefined,
      filePath,
      message:
        `${iconSuccess} File edited via hashline anchors: ${filePath}\n` +
        `   Operations: ${opSummaries.join("; ")}\n` +
        `   Result: ${finalTotalLines} total lines${
          smartBoundaries.extended
            ? `\n   ${iconSearch} Context auto-extended (lines ${contextStart}-${finalContextEnd})`
            : ""
        }`,
      newContent: newContextContent,
      oldContent,
      operationsSummary: opSummaries.join("; "),
      replacedContent,
      structureAnalysis,
      totalLines: finalTotalLines,
    };

    result.message = appendStructureWarnings(result.message, structureAnalysis);
    return result;
  } catch (error) {
    throw createInternalError(
      "INTERNAL_ERROR",
      `Failed to edit file ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

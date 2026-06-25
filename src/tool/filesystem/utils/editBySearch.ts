/**
 * 搜索替换编辑 — executeEditBySearchSingle 实现
 *
 * 职责:
 *   - 单文件搜索替换编辑
 *   - 精确匹配与模糊匹配(阈值 0.75)
 *   - 智能上下文处理
 *   - 可选 prettier 格式化
 *   - 结构分析与诊断收集
 */

import path from "node:path";
import { isAbsolute } from "node:path";
import fs from "node:fs";
import type { Diagnostic } from "@/ide/types";
import type { StructureAnalysis } from "@/tool/filesystem/utils/codeAnalysis";
import { calculateSimilarity, calculateSimilarityAsync, normalizeForDisplay } from "@/tool/filesystem/utils/similarity";
import { analyzeCodeStructure, findSmartContextBoundaries } from "@/tool/filesystem/utils/codeAnalysis";
import { findClosestMatches, generateDiffMessage } from "@/tool/filesystem/utils/matchFinder";
import { readFileWithEncoding, writeFileWithEncoding } from "@/tool/filesystem/utils/encoding";
import { backupFileBeforeMutation } from "@/tool/filesystem/utils/backup";
import { recordFileMutation } from "@/tool/rollback";
import { appendDiagnosticsSummary, appendStructureWarnings } from "@/tool/filesystem/utils/messageFormat";
import { createInternalError } from "@/core/errors/appError";
import { actionBullet, iconError, iconLsp, iconSearch, iconSettings, iconSuccess, toolWrite } from "@/core/icons/icon";
import type { EditToolContext } from "./editTools";
import { tryPrettierFormat } from "./editTools";

/** 搜索替换编辑结果 */
export interface EditBySearchSingleResult {
  message: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  completeOldContent?: string;
  completeNewContent?: string;
  replacedContent: string;
  matchLocation?: { startLine: number; endLine: number };
  contextStartLine: number;
  contextEndLine: number;
  totalLines: number;
  structureAnalysis: StructureAnalysis;
  diagnostics?: Diagnostic[];
}

/**
 * 单文件搜索替换编辑。
 *
 * 流程:
 *   1. 读取文件 → 备份
 *   2. 精确匹配 → 失败则模糊匹配(阈值 0.75)
 *   3. 替换 → 写回
 *   4. 结构分析 + 诊断收集
 */
export async function executeEditBySearchSingle(
  ctx: EditToolContext,
  filePath: string,
  searchContent: string,
  replaceContent: string,
  occurrence: number,
  contextLines: number,
): Promise<EditBySearchSingleResult> {
  try {
    const fullPath = ctx.resolvePath(filePath);
    if (!isAbsolute(filePath)) {
      await ctx.validatePath(fullPath);
    }

    if (!fs.existsSync(fullPath)) {
      throw createInternalError("INTERNAL_ERROR", `文件不存在: ${fullPath}`);
    }

    const content = await readFileWithEncoding(fullPath);

    // 备份
    backupFileBeforeMutation(fullPath);

    const lines = content.split("\n");

    const normalizedSearch = searchContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const searchLines = normalizedSearch.split("\n");
    const contentLines = normalizedContent.split("\n");

    // 匹配搜索
    const matches: { startLine: number; endLine: number; similarity: number }[] = [];
    const threshold = 0.75;
    const searchFirstLine = searchLines[0]?.replace(/\s+/g, " ").trim() || "";
    const usePreFilter = searchLines.length >= 5;
    const preFilterThreshold = 0.2;
    const maxMatches = 10;

    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      if (usePreFilter) {
        const firstLineCandidate = contentLines[i]?.replace(/\s+/g, " ").trim() || "";
        const firstLineSimilarity = calculateSimilarity(searchFirstLine, firstLineCandidate, preFilterThreshold);
        if (firstLineSimilarity < preFilterThreshold) {
          continue;
        }
      }

      const candidateLines = contentLines.slice(i, i + searchLines.length);
      const candidateContent = candidateLines.join("\n");
      const similarity = await calculateSimilarityAsync(normalizedSearch, candidateContent, threshold);

      if (similarity >= threshold) {
        matches.push({
          endLine: i + searchLines.length,
          similarity,
          startLine: i + 1,
        });
        if (similarity >= 0.95 || matches.length >= maxMatches) {
          break;
        }
      }
    }

    matches.sort((a, b) => b.similarity - a.similarity);

    if (matches.length === 0) {
      // 尝试更宽泛的搜索
      const closestMatches = await findClosestMatches(normalizedSearch, normalizedContent.split("\n"), 3);

      let errorMessage = `${iconError} Search content not found in file: ${filePath}\n\n`;
      errorMessage += `${iconSearch} Using smart fuzzy matching (threshold: ${threshold})\n\n`;

      if (closestMatches.length > 0) {
        errorMessage += `${iconLsp} Found ${closestMatches.length} similar location(s):\n\n`;
        closestMatches.forEach((candidate, idx) => {
          errorMessage += `${idx + 1}. Lines ${candidate.startLine}-${candidate.endLine} (${(candidate.similarity * 100).toFixed(0)}% match):\n`;
          errorMessage += `${candidate.preview}\n\n`;
        });

        const bestMatch = closestMatches[0];
        if (bestMatch) {
          const bestMatchContent = lines.slice(bestMatch.startLine - 1, bestMatch.endLine).join("\n");
          const diffMsg = generateDiffMessage(normalizedSearch, bestMatchContent, 5);
          if (diffMsg) {
            errorMessage += `${iconSettings} Difference with closest match:\n${diffMsg}\n\n`;
          }
        }
      }

      errorMessage += `${toolWrite} What you searched for (first 5 lines, formatted):\n`;
      searchLines.slice(0, 5).forEach((line, idx) => {
        errorMessage += `${idx + 1}. ${JSON.stringify(normalizeForDisplay(line))}\n`;
      });

      throw createInternalError("INTERNAL_ERROR", errorMessage);
    }

    // 选择匹配项
    let selectedMatch: { startLine: number; endLine: number };
    if (occurrence === -1) {
      if (matches.length === 1) {
        selectedMatch = matches[0]!;
      } else {
        throw createInternalError(
          "INTERNAL_ERROR",
          `Found ${matches.length} matches. Please specify which occurrence to replace (1-${matches.length}).`,
        );
      }
    } else if (occurrence < 1 || occurrence > matches.length) {
      throw createInternalError(
        "INTERNAL_ERROR",
        `Invalid occurrence ${occurrence}. Found ${matches.length} match(es) at lines: ${matches.map((m) => m.startLine).join(", ")}`,
      );
    } else {
      selectedMatch = matches[occurrence - 1]!;
    }

    const { startLine, endLine } = selectedMatch;
    const normalizedReplace = replaceContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const beforeLines = lines.slice(0, startLine - 1);
    const afterLines = lines.slice(endLine);
    const replaceLines = normalizedReplace.split("\n");

    // 保持首行缩进
    if (replaceLines.length > 0) {
      const originalFirstLine = lines[startLine - 1];
      const originalIndent = originalFirstLine?.match(/^(\s*)/)?.[1] || "";
      const replaceFirstLine = replaceLines[0];
      const replaceIndent = replaceFirstLine?.match(/^(\s*)/)?.[1] || "";
      if (originalIndent !== replaceIndent && replaceFirstLine) {
        replaceLines[0] = originalIndent + replaceFirstLine.trim();
      }
    }

    const modifiedLines = [...beforeLines, ...replaceLines, ...afterLines];
    const modifiedContent = modifiedLines.join("\n");
    const lineDifference = replaceLines.length - (endLine - startLine + 1);

    // 写回
    await writeFileWithEncoding(fullPath, modifiedContent);

    // 智能上下文
    const smartBoundaries = findSmartContextBoundaries(lines, startLine, endLine, contextLines);
    const contextStart = smartBoundaries.start;
    const contextEnd = smartBoundaries.end;
    const oldContent = lines.slice(contextStart - 1, contextEnd).join("\n");
    const diffContextEnd = Math.min(modifiedLines.length, contextEnd + lineDifference);
    const newContextContent = modifiedLines.slice(contextStart - 1, diffContextEnd).join("\n");

    // 完整上下文
    const overflowPadding = Math.max(3, contextLines);
    const completeOldStart = Math.max(1, contextStart - overflowPadding);
    const completeOldEnd = Math.min(lines.length, contextEnd + overflowPadding);
    const completeOldContent = lines.slice(completeOldStart - 1, completeOldEnd).join("\n");
    const editLineDelta = modifiedLines.length - lines.length;
    const completeNewEnd = Math.min(modifiedLines.length, completeOldEnd + editLineDelta);
    const completeNewContent = modifiedLines.slice(completeOldStart - 1, completeNewEnd).join("\n");

    // 可选 prettier 格式化
    const fmt = await tryPrettierFormat(fullPath, modifiedContent, ctx);
    const finalContent = fmt.content;
    const finalTotalLines = fmt.totalLines;

    const finalFileContent = fs.readFileSync(fullPath, "utf8");
    if (content !== finalFileContent) {
      recordFileMutation({
        after: finalFileContent,
        before: content,
        filePath: fullPath,
        projectDir: process.cwd(),
        reason: "filesystem-edit:search",
        sessionId: ctx.sessionId,
      });
    }

    // 结构分析 + 诊断
    const structureAnalysis = analyzeCodeStructure(finalContent, filePath, replaceLines);
    const diagnostics: Diagnostic[] = [];

    // 判断是否使用了模糊匹配(similarity < 1.0)
    const usedFuzzy = selectedMatch && "similarity" in selectedMatch && (selectedMatch as any).similarity < 1;
    const fuzzyInfo = usedFuzzy ? ` (fuzzy match: ${((selectedMatch as any).similarity * 100).toFixed(0)}%)` : "";

    const result: EditBySearchSingleResult = {
      completeNewContent,
      completeOldContent,
      contextEndLine: diffContextEnd,
      contextStartLine: contextStart,
      diagnostics: diagnostics.length > 0 ? diagnostics.slice(0, 10) : undefined,
      filePath,
      matchLocation: { endLine, startLine },
      message:
        `${iconSuccess} File edited successfully: ${filePath}\n` +
        `   Matched: lines ${startLine}-${endLine} (occurrence ${occurrence}/${matches.length})${fuzzyInfo}\n` +
        `   Result: ${replaceLines.length} new lines${
          smartBoundaries.extended
            ? `\n   ${iconSearch} Context auto-extended to show complete code block (lines ${contextStart}-${diffContextEnd})`
            : ""
        }`,
      newContent: newContextContent,
      oldContent,
      replacedContent: lines.slice(startLine - 1, endLine).join("\n"),
      structureAnalysis,
      totalLines: finalTotalLines,
    };

    if (diagnostics.length > 0) {
      result.diagnostics = diagnostics.slice(0, 10);
      result.message = appendDiagnosticsSummary(result.message, filePath, diagnostics, {
        includeTip: true,
      });
    }

    result.message = appendStructureWarnings(
      result.message,
      structureAnalysis,
      `${iconLsp} TIP: These warnings help identify potential issues. If intentional, you can ignore them.`,
    );

    return result;
  } catch (error) {
    throw createInternalError(
      "INTERNAL_ERROR",
      `Failed to edit file ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

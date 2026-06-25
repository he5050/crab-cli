/**
 * 消息格式化 — 诊断摘要和结构警告追加。
 *
 * 职责:
 *   - 格式化诊断摘要
 *   - 追加诊断详情
 *   - 格式化结构警告
 *   - 生成提示信息
 *
 * 模块功能:
 *   - appendDiagnosticsSummary: 追加诊断摘要
 *   - appendStructureWarnings: 追加结构警告
 *   - 错误/警告计数
 *   - 详情列表格式化
 *
 * 使用场景:
 *   - 编辑后显示诊断信息
 *   - 代码结构警告展示
 *   - 工具返回消息增强
 *   - 错误提示生成
 *
 * 边界:
 *   1. 支持自定义标签
 *   2. 限制最大详情数
 *   3. 支持提示文本追加
 *   4. 无诊断时原样返回
 *   5. 格式化诊断位置信息
 *
 * 流程:
 *   1. 统计错误和警告数
 *   2. 格式化诊断列表
 *   3. 追加到基础消息
 *   4. 添加提示(如需要)
 *   5. 返回完整消息
 */

import type { Diagnostic } from "@/ide/types";
import type { StructureAnalysis } from "@/tool/filesystem/utils/codeAnalysis";
import { iconError, iconLsp, iconSearch, iconWarning } from "@/core/icons/icon";

/** 诊断摘要选项 */
interface DiagnosticsSummaryOptions {
  headerLabel?: string;
  detailsLabel?: string;
  maxDetails?: number;
  moreSuffix?: string;
  includeTip?: boolean;
  tipText?: string;
}

/**
 * 向基础消息追加 IDE 诊断摘要(错误/警告数 + 详情列表)，无诊断时原样返回。
 * @param baseMessage 基础消息文本
 * @param filePath 文件路径(用于定位)
 * @param diagnostics IDE 诊断列表
 * @param options 摘要选项(标签、最大详情数等)
 * @returns 追加诊断后的完整消息
 */
/** appendDiagnosticsSummary 的实现 */
export function appendDiagnosticsSummary(
  baseMessage: string,
  filePath: string,
  diagnostics: Diagnostic[],
  options: DiagnosticsSummaryOptions = {},
): string {
  const {
    headerLabel = "Diagnostics detected",
    detailsLabel = "Diagnostic Details",
    maxDetails = 5,
    moreSuffix = "more issue(s)",
    includeTip = false,
    tipText = "TIP: Review the errors above and make another edit to fix them",
  } = options;

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

  if (errorCount === 0 && warningCount === 0) {
    return baseMessage;
  }

  let message = `${baseMessage}\n\n${iconWarning} ${headerLabel}: ${errorCount} error(s), ${warningCount} warning(s)`;
  const formattedDiagnostics = diagnostics
    .filter((d) => d.severity === "error" || d.severity === "warning")
    .slice(0, maxDetails)
    .map((d) => {
      const icon = d.severity === "error" ? iconError : iconWarning;
      const location = `${filePath}:${d.line}:${d.character}`;
      return `   ${icon} [${d.source || "unknown"}] ${location}\n      ${d.message}`;
    })
    .join("\n\n");

  message += `\n\n${iconLsp} ${detailsLabel}:\n${formattedDiagnostics}`;
  if (errorCount + warningCount > maxDetails) {
    message += `\n   ... and ${errorCount + warningCount - maxDetails} ${moreSuffix}`;
  }
  if (includeTip) {
    message += `\n\n   ${tipText}`;
  }

  return message;
}

/** 从结构分析中提取警告列表 */
function getStructureWarnings(structureAnalysis: StructureAnalysis): string[] {
  const warnings: string[] = [];

  if (!structureAnalysis.bracketBalance.curly.balanced) {
    const diff = structureAnalysis.bracketBalance.curly.open - structureAnalysis.bracketBalance.curly.close;
    warnings.push(`Curly brackets: ${diff > 0 ? `${diff} unclosed {` : `${Math.abs(diff)} extra }`}`);
  }
  if (!structureAnalysis.bracketBalance.round.balanced) {
    const diff = structureAnalysis.bracketBalance.round.open - structureAnalysis.bracketBalance.round.close;
    warnings.push(`Round brackets: ${diff > 0 ? `${diff} unclosed (` : `${Math.abs(diff)} extra )`}`);
  }
  if (!structureAnalysis.bracketBalance.square.balanced) {
    const diff = structureAnalysis.bracketBalance.square.open - structureAnalysis.bracketBalance.square.close;
    warnings.push(`Square brackets: ${diff > 0 ? `${diff} unclosed [` : `${Math.abs(diff)} extra ]`}`);
  }

  if (structureAnalysis.htmlTags && !structureAnalysis.htmlTags.balanced) {
    if (structureAnalysis.htmlTags.unclosedTags.length > 0) {
      warnings.push(`Unclosed HTML tags: ${structureAnalysis.htmlTags.unclosedTags.join(", ")}`);
    }
    if (structureAnalysis.htmlTags.unopenedTags.length > 0) {
      warnings.push(`Unopened closing tags: ${structureAnalysis.htmlTags.unopenedTags.join(", ")}`);
    }
  }

  if (structureAnalysis.indentationWarnings.length > 0) {
    warnings.push(...structureAnalysis.indentationWarnings.map((warning: string) => `Indentation: ${warning}`));
  }

  return warnings;
}

/**
 * 向基础消息追加代码结构分析警告(括号不匹配、标签未闭合等)，无警告时原样返回。
 * @param baseMessage 基础消息文本
 * @param structureAnalysis 代码结构分析结果
 * @param tipText 追加在末尾的提示文本
 * @returns 追加警告后的完整消息
 */
/** appendStructureWarnings 的实现 */
export function appendStructureWarnings(
  baseMessage: string,
  structureAnalysis: StructureAnalysis,
  tipText: string = "TIP: These warnings help identify potential issues.",
): string {
  const warnings = getStructureWarnings(structureAnalysis);
  if (warnings.length === 0) {
    return baseMessage;
  }

  let message = `${baseMessage}\n\n${iconSearch} Structure Analysis:\n`;
  warnings.forEach((warning) => {
    message += `   ${iconWarning} ${warning}\n`;
  });
  message += `\n   ${tipText}`;
  return message;
}

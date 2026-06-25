import { createInternalError } from "@/core/errors/appError";
import {
  actionBullet,
  iconError,
  iconSearch,
  iconSettings,
  iconSuccess,
  iconWarning,
  toolGeneric,
} from "@/core/icons/icon";
/**
 * 批量操作工具 — 多文件批量编辑的参数解析与结果汇总。
 *
 * 职责:
 *   - 解析文件路径参数
 *   - 提取文件路径
 *   - 执行批量操作
 *   - 汇总批量结果
 *
 * 模块功能:
 *   - parseFilePathParameter: 解析路径参数
 *   - extractFilePath: 提取文件路径
 *   - executeBatchOperation: 执行批量操作
 *   - 批量结果汇总
 *
 * 使用场景:
 *   - 多文件批量编辑
 *   - 批量读取操作
 *   - 批量写入操作
 *   - 结果统计汇总
 *
 * 边界:
 *   1. 支持 string/string[]/T[] 参数
 *   2. 统一批量结果格式
 *   3. 统计成功/失败数
 *   4. 支持搜索替换配置
 *   5. 通用批量执行框架
 *
 * 流程:
 *   1. 解析文件路径参数
 *   2. 提取文件路径
 *   3. 遍历执行操作
 *   4. 收集操作结果
 *   5. 汇总统计信息
 */

/** 单条批量操作结果 */
export interface BatchResultItem {
  path: string;
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/** 批量操作汇总结果，包含成功/失败统计和每条操作结果 */
export interface BatchOperationResult<T extends BatchResultItem = BatchResultItem> {
  message: string;
  results: T[];
  totalFiles: number;
  successCount: number;
  failureCount: number;
}

/** 单条搜索替换配置项 */
export interface EditBySearchConfig {
  path: string;
  searchContent: string;
  replaceContent: string;
  occurrence?: number;
}

/**
 * 将文件路径参数统一为数组格式。
 * 支持: string, string[], T[]
 */
/** parseFilePathParameter 的实现 */
export function parseFilePathParameter<T extends { path: string }>(filePath: string | string[] | T[]): (string | T)[] {
  if (Array.isArray(filePath)) {
    return filePath;
  }
  return [filePath];
}

/**
 * 从文件项中提取路径。
 */
/** extractFilePath 的实现 */
export function extractFilePath<T extends { path: string }>(fileItem: string | T): string {
  return typeof fileItem === "string" ? fileItem : fileItem.path;
}

/**
 * 解析搜索替换参数(单路径/字符串批量/配置批量)。
 */
/** parseEditBySearchParams 的实现 */
export function parseEditBySearchParams(
  fileItem: string | EditBySearchConfig,
  globalSearchContent?: string,
  globalReplaceContent?: string,
  globalOccurrence?: number,
): {
  path: string;
  searchContent: string;
  replaceContent: string;
  occurrence: number;
} {
  if (typeof fileItem === "string") {
    if (!globalSearchContent || !globalReplaceContent) {
      throw createInternalError(
        "INTERNAL_ERROR",
        "searchContent and replaceContent are required for string array format",
      );
    }
    return {
      occurrence: globalOccurrence ?? 1,
      path: fileItem,
      replaceContent: globalReplaceContent,
      searchContent: globalSearchContent,
    };
  }

  return {
    occurrence: fileItem.occurrence ?? globalOccurrence ?? 1,
    path: fileItem.path,
    replaceContent: fileItem.replaceContent,
    searchContent: fileItem.searchContent,
  };
}

/**
 * 通用批量操作执行框架。
 * 逐文件执行，收集成功/失败结果，生成汇总消息。
 */
export async function executeBatchOperation<TConfig, TSingleResult, TBatchItem extends BatchResultItem>(
  fileItems: (string | TConfig)[],
  parseParams: (fileItem: string | TConfig) => Record<string, unknown>,
  executeSingle: (...params: unknown[]) => Promise<TSingleResult>,
  mapResult: (path: string, result: TSingleResult) => Omit<TBatchItem, "success" | "error">,
): Promise<BatchOperationResult<TBatchItem>> {
  const results: TBatchItem[] = [];

  for (const fileItem of fileItems) {
    try {
      const params = parseParams(fileItem);
      const result = await executeSingle(...Object.values(params));

      results.push({
        success: true,
        ...mapResult(params.path as string, result),
        path: params.path as string,
      } as TBatchItem);
    } catch (error) {
      const filePath = typeof fileItem === "string" ? fileItem : (fileItem as { path: string }).path;
      results.push({
        error: error instanceof Error ? error.message : "Unknown error",
        path: filePath,
        success: false,
      } as TBatchItem);
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  let detailedMessage = `Batch Edit Summary: ${successCount} succeeded, ${failureCount} failed\n\n`;

  results.forEach((result, index) => {
    const num = index + 1;
    const separator = "─".repeat(80);

    if (result.success) {
      detailedMessage += `${separator}\n`;
      detailedMessage += `${iconSuccess} File ${num}/${results.length}: ${result.path}\n`;
      detailedMessage += `${separator}\n\n`;

      const fileResult = result as Record<string, unknown>;

      // 提取关键元数据
      if (fileResult.message && typeof fileResult.message === "string") {
        const lines = fileResult.message.split("\n");
        const metadataLines = lines.filter(
          (l: string) =>
            l.trim().startsWith("Matched:") ||
            l.trim().startsWith("Replaced:") ||
            l.trim().startsWith("Result:") ||
            l.trim().startsWith(iconSearch),
        );
        if (metadataLines.length > 0) {
          metadataLines.forEach((line: string) => {
            detailedMessage += `${line}\n`;
          });
          detailedMessage += "\n";
        }
      }

      // 变更范围
      if (fileResult.oldContent && fileResult.newContent) {
        detailedMessage += `${iconSettings} Changes (lines ${fileResult.contextStartLine ?? "?"}-${fileResult.contextEndLine ?? "?"})\n\n`;
      }

      // 结构分析警告
      if (fileResult.structureAnalysis) {
        const warnings: string[] = [];
        const sa = fileResult.structureAnalysis as Record<string, unknown>;
        const bb = sa.bracketBalance as Record<string, Record<string, number>> | undefined;

        if (bb) {
          for (const [name, bracket] of Object.entries(bb)) {
            if (!bracket.balanced) {
              const diff = (bracket.open || 0) - (bracket.close || 0);
              warnings.push(`${name} brackets: ${diff > 0 ? `${diff} unclosed` : `${Math.abs(diff)} extra close`}`);
            }
          }
        }

        if (warnings.length > 0) {
          detailedMessage += `${iconWarning} Structure Warnings:\n`;
          warnings.forEach((w) => {
            detailedMessage += `   ${actionBullet} ${w}\n`;
          });
          detailedMessage += "\n";
        }
      }

      // 诊断信息
      if (fileResult.diagnostics && Array.isArray(fileResult.diagnostics) && fileResult.diagnostics.length > 0) {
        const diags = fileResult.diagnostics as Record<string, unknown>[];
        const errorCount = diags.filter((d) => d.severity === "error").length;
        const warningCount = diags.filter((d) => d.severity === "warning").length;

        if (errorCount > 0 || warningCount > 0) {
          detailedMessage += `${toolGeneric} Diagnostics: ${errorCount} error(s), ${warningCount} warning(s)\n`;
          diags.slice(0, 3).forEach((d) => {
            const icon = d.severity === "error" ? iconError : iconWarning;
            detailedMessage += `   ${icon} Line ${d.line}: ${d.message}\n`;
          });
          if (diags.length > 3) {
            detailedMessage += `   ... and ${diags.length - 3} more\n`;
          }
          detailedMessage += "\n";
        }
      }
    } else {
      detailedMessage += `${separator}\n`;
      detailedMessage += `${iconError} File ${num}/${results.length}: ${result.path}\n`;
      detailedMessage += `${separator}\n`;
      detailedMessage += `Error: ${result.error}\n\n`;
    }
  });

  return {
    failureCount,
    message: detailedMessage.trim(),
    results,
    successCount,
    totalFiles: fileItems.length,
  };
}

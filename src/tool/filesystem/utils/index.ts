/**
 * 文件系统工具 utils — 统一导出。
 *
 * 职责:
 *   - 提供文件系统工具辅助函数
 *   - 统一导出所有工具函数
 *   - 编码检测与转换
 *   - 编辑前备份
 *   - 路径修复
 *   - hashline 行锚点
 *   - 相似度计算
 *   - 模糊匹配查找
 *   - 代码结构分析
 *   - 消息格式化
 *
 * 模块功能:
 *   - 编码工具
 *   - 备份工具
 *   - 路径修复
 *   - hashline 工具
 *   - 相似度计算
 *   - 模糊匹配
 *   - 代码分析
 *   - 消息格式化
 *
 * 使用场景:
 *   - 文件系统工具内部使用
 *   - 编码转换
 *   - 文件备份
 *   - 路径处理
 *   - 编辑锚定
 *   - 相似度匹配
 *
 * 边界:
 *   1. 纯工具函数集合
 *   2. 无状态管理
 *   3. 统一导出所有工具
 *   4. 支持类型导出
 *
 * 流程:
 *   1. 导入各子模块
 *   2. 统一重新导出
 *   3. 提供类型定义
 */

// 编码检测与转换
export { readFileWithEncoding, readFileLinesStreaming, writeFileWithEncoding } from "./encoding";

// 编辑前备份
export { backupFileBeforeMutation } from "./backup";

// 路径修复
export { tryFixPath } from "./pathFixer";

// Hashline 行锚点
export { lineHash, formatLineWithHash, parseAnchor, validateAnchor, buildHashMap } from "./hashline";
/** hashline 解析后的锚点信息 */
export type { ParsedAnchor } from "./hashline";

// 相似度计算
export {
  calculateSimilarity,
  levenshteinDistance,
  levenshteinDistanceAsync,
  calculateSimilarityAsync,
  normalizeForDisplay,
} from "./similarity";

// 模糊匹配查找
export { findClosestMatches, generateDiffMessage } from "./matchFinder";
/** 模糊匹配候选结果 */
export type { MatchCandidate } from "./matchFinder";

// 代码结构分析
export { analyzeCodeStructure, findSmartContextBoundaries } from "./codeAnalysis";
/** 代码结构分析结果、括号平衡、HTML 标签平衡 */
export type { StructureAnalysis, BracketBalance, HtmlTagBalance } from "./codeAnalysis";

// 消息格式化
export { appendDiagnosticsSummary, appendStructureWarnings } from "./messageFormat";

// IDE 诊断获取
export { getFreshDiagnostics } from "./diagnostics";

// 批量操作
export {
  parseFilePathParameter,
  extractFilePath,
  parseEditBySearchParams,
  executeBatchOperation,
} from "./batchOperations";
/** 批量操作结果项、批量操作汇总、搜索替换配置 */
export type { BatchResultItem, BatchOperationResult, EditBySearchConfig } from "./batchOperations";

// Office 文件解析
export {
  readOfficeDocument,
  getOfficeFileType,
  parseWordDocument,
  parsePDFDocument,
  parseExcelDocument,
  parsePowerPointDocument,
} from "./officeParser";
/** Office 文档解析后的内容 */
export type { DocumentContent } from "./officeParser";

// 编辑工具核心
export { executeEditBySearchSingle, executeHashlineEditSingle } from "./editTools";
/** 编辑工具核心类型: 搜索替换结果、hashline 编辑结果、操作配置、上下文 */
export type {
  EditBySearchSingleResult,
  EditByHashlineSingleResult,
  HashlineOperation,
  EditToolContext,
} from "./editTools";

// 读取工具核心
export { executeGetFileContentCore } from "./readTools";
/** 文件读取结果类型: 单文件读取、多文件读取、读取上下文 */
export type { SingleFileReadResult, MultipleFilesReadResult, GetFileContentContext } from "./readTools";

// 路径安全检查 — 统一路径遍历防护(CWE-22)
import fs from "node:fs";
import path from "node:path";

/**
 * 验证文件路径是否在指定工作目录范围内。
 * 同时检查 resolve 后的路径和解析符号链接后的真实路径，取最严格的实现。
 * @returns 错误信息字符串，若路径合法则返回 null
 */
/** validatePathWithinCwd 的实现 */
export function validatePathWithinCwd(filePath: string, cwd?: string): string | null {
  const _cwd = cwd ?? process.cwd();
  const realCwd = fs.realpathSync(_cwd);
  const resolved = path.resolve(filePath);

  // 第一层: resolve 后的路径检查
  if (!resolved.startsWith(_cwd + path.sep) && resolved !== _cwd) {
    return `路径越界: 不允许访问工作区之外的文件 (path: ${resolved})`;
  }

  // 第二层: 解析符号链接后的真实路径检查
  try {
    const realPath = fs.realpathSync(resolved);
    if (!realPath.startsWith(realCwd + path.sep) && realPath !== realCwd) {
      return `路径越界: 解析后的真实路径在工作区之外 (realPath: ${realPath})`;
    }
  } catch {
    // 文件不存在时无法解析真实路径，仅用 resolved 检查即可
  }

  return null;
}

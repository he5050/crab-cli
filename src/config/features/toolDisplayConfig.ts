/**
 * 工具显示配置 — 工具在 TUI 中的显示策略。
 *
 * 职责:
 *   - 定义工具在 TUI 中的显示策略
 *   - 区分两步显示和单步显示工具
 *   - 提取文件编辑 diff 元数据
 *
 * 模块功能:
 *   - isToolNeedTwoStepDisplay: 判断工具是否需要显示两步状态
 *   - isToolOnlyShowCompleted: 判断工具是否只需要显示完成状态
 *   - extractFilesystemEditDiffData: 提取 filesystem-edit 的 diff 元数据
 *   - TWO_STEP_DISPLAY_TOOL_NAMES: 两步显示工具名列表
 *
 * 使用场景:
 *   - TUI 工具执行状态显示
 *   - 文件编辑 diff 展示
 *   - 工具执行进度反馈
 *
 * 边界:
 *   1. 两步显示工具包括耗时较长的操作(文件编辑、Bash、搜索等)
 *   2. 子代理工具默认需要两步显示
 *   3. 其他工具只显示完成状态
 *
 * 流程:
 *   1. 检查工具名是否在 TWO_STEP_TOOLS 列表中
 *   2. 检查是否为子代理工具
 *   3. 返回显示策略
 */
import { toAppError } from "@/core/errors/appError";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("config:tool-display");

function logToolDisplayDebugFailure(message: string, error: unknown, context: Record<string, unknown> = {}): void {
  const appError = toAppError(error);
  log.debug(message, {
    ...context,
    error: appError.message,
    errorCode: appError.code,
  });
}

/**
 * 需要显示两步状态的工具(进行中 → 完成)。
 * 这些是耗时较长的工具，用户需要看到执行进度。
 */
const TWO_STEP_TOOLS = new Set([
  // 文件编辑工具
  "filesystem-edit",
  "filesystem-replaceedit",
  "filesystem-write",

  // Bash 工具
  "bash-execute",

  // 代码搜索
  "codebase-search",

  // 联网搜索
  "websearch-search",
  "websearch-fetch",

  // 用户交互
  "askuser-ask-question",
]);

/**
 * 固定列表内的两步显示工具名。
 */
export const TWO_STEP_DISPLAY_TOOL_NAMES: readonly string[] = [...TWO_STEP_TOOLS];

/**
 * 判断工具是否需要显示两步状态。
 */
export function isToolNeedTwoStepDisplay(toolName: string): boolean {
  if (TWO_STEP_TOOLS.has(toolName)) {
    return true;
  }

  // 子代理工具也需要两步显示
  if (toolName.startsWith("subagent-")) {
    return true;
  }

  return false;
}

/**
 * 判断工具是否只需要显示完成状态。
 */
export function isToolOnlyShowCompleted(toolName: string): boolean {
  return !isToolNeedTwoStepDisplay(toolName);
}

/**
 * 从工具结果内容中提取 filesystem-edit 的 diff 元数据。
 * 用于截断或纯文本 content 时恢复 DiffViewer。
 */
export function extractFilesystemEditDiffData(toolName: string, content: string): Record<string, unknown> | undefined {
  if ((toolName !== "filesystem-edit" && toolName !== "filesystem-replaceedit") || content.startsWith("Error:")) {
    return undefined;
  }
  try {
    const resultData = JSON.parse(content);
    if (resultData.oldContent && resultData.newContent) {
      return {
        completeNewContent: resultData.completeNewContent,
        completeOldContent: resultData.completeOldContent,
        contextStartLine: resultData.contextStartLine,
        filename: resultData.filePath || resultData.path || resultData.filename,
        newContent: resultData.newContent,
        oldContent: resultData.oldContent,
      };
    }
    if (resultData.results && Array.isArray(resultData.results)) {
      return {
        batchResults: resultData.results,
        isBatch: true,
      };
    }
    if (resultData.batchResults && Array.isArray(resultData.batchResults)) {
      return {
        batchResults: resultData.batchResults,
        isBatch: true,
      };
    }
  } catch (error) {
    logToolDisplayDebugFailure("提取文件编辑 diff 元数据失败", error, {
      operation: "config.toolDisplay.extractFilesystemEditDiffData",
      toolName,
    });
  }
  return undefined;
}

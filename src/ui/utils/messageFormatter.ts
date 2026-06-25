/**
 * 消息格式化模块
 *
 * 职责:
 *   - 工具调用显示信息格式化
 *   - 路径截断和智能参数格式化
 *   - 为 TUI 提供可读的工具调用展示
 *
 * 模块功能:
 *   - 格式化工具调用消息(formatToolCallMessage)
 *   - 智能路径截断(smartTruncatePath/truncatePath)
 *   - 参数值智能格式化(根据参数类型和长度)
 *   - 编辑工具长内容参数特殊处理
 *
 * 使用场景:
 *   - 聊天界面显示工具调用信息
 *   - 工具调用历史记录展示
 *   - 调试信息输出
 *   - 日志记录中的工具调用格式化
 *
 * 边界:
 *   1. 独立实现，不依赖 ToolCall 类型
 *   2. 不依赖 i18n，使用硬编码中文
 *   3. 路径截断保留完整目录名，从后往前截断
 *   4. 编辑工具的长内容参数显示为 "<N 行>" 或截断字符串
 *   5. 数组和对象参数进行简化显示
 *
 * 流程:
 *   1. 接收工具调用信息(名称和参数 JSON)
 *   2. 解析参数 JSON
 *   3. 根据参数类型和工具类型格式化每个参数值
 *   4. 对路径类型参数进行智能截断
 *   5. 对长内容进行截断或行数提示
 *   6. 返回格式化后的工具名称和参数列表
 */

// ─── 类型 ──────────────────────────────────────────────────

export interface ToolCallDisplay {
  name: string;
  arguments: string; // JSON string
}

export interface FormattedToolCall {
  toolName: string;
  args: { key: string; value: string; isLast: boolean }[];
}

// ─── 路径工具 ──────────────────────────────────────────────

const PATH_DISPLAY_PADDING = 30;
const MIN_DISPLAY_LENGTH = 10;

function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

function isFilePath(value: string): boolean {
  if (value.includes("://")) {
    return false;
  }
  return /^(\/|[A-Za-z]:\\)/.test(value);
}

/**
 * 纯路径截断，从后往前保留完整目录名。
 */
export function truncatePath(filePath: string, maxLen: number): string {
  const safeMaxLen = Math.max(maxLen, 4);
  if (filePath.length <= safeMaxLen) {
    return filePath;
  }

  const sep = filePath.includes("\\") ? "\\" : "/";
  const parts = filePath.split(sep);
  const filename = parts.pop() || "";

  if (filename.length + 4 > safeMaxLen) {
    return `...${filename.slice(-(safeMaxLen - 3))}`;
  }

  const prefix = `...${sep}`;
  const available = safeMaxLen - prefix.length - filename.length - 1;

  if (available <= 0) {
    return prefix + filename;
  }

  const includedParts: string[] = [];
  let used = filename.length;

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) {
      continue;
    }
    const needed = part.length + 1;
    if (used + needed > available) {
      break;
    }
    includedParts.unshift(part);
    used += needed;
  }

  if (includedParts.length === 0) {
    return prefix + filename;
  }
  return prefix + includedParts.join(sep) + sep + filename;
}

/**
 * 智能截断路径。
 */
export function smartTruncatePath(filePath: string, maxLength?: number): string {
  const effectiveMaxLength = Math.max(maxLength ?? getTerminalWidth() - PATH_DISPLAY_PADDING, MIN_DISPLAY_LENGTH);
  return truncatePath(filePath, effectiveMaxLength);
}

// ─── 工具调用格式化 ────────────────────────────────────────

/** Edit 工具的长内容参数 */
const EDIT_LONG_CONTENT_PARAMS = new Set([
  "searchContent",
  "replaceContent",
  "newContent",
  "oldContent",
  "content",
  "completeOldContent",
  "completeNewContent",
]);

/** Edit 工具名称 */
const EDIT_TOOLS = new Set(["filesystem-edit", "filesystem-replaceedit", "filesystem-create"]);

/**
 * 格式化工具调用为 UI 显示信息。
 */
export function formatToolCallMessage(toolCall: ToolCallDisplay): FormattedToolCall {
  try {
    const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
    const argEntries = Object.entries(args);
    const formattedArgs: { key: string; value: string; isLast: boolean }[] = [];

    const isEditTool = EDIT_TOOLS.has(toolCall.name);
    const isTerminalExecute = toolCall.name === "terminal-execute";

    if (argEntries.length > 0) {
      argEntries.forEach(([key, value], idx, arr) => {
        let valueStr: string;

        if (isEditTool && EDIT_LONG_CONTENT_PARAMS.has(key)) {
          if (typeof value === "string") {
            const lines = value.split("\n");
            const lineCount = lines.length;
            if (lineCount > 3) {
              valueStr = `<${lineCount} 行>`;
            } else if (value.length > 60) {
              valueStr = `"${value.slice(0, 60)}..."`;
            } else {
              valueStr = `"${value}"`;
            }
          } else {
            valueStr = JSON.stringify(value);
          }
        } else if (typeof value === "string") {
          if (isTerminalExecute && key === "command") {
            valueStr = `"${value}"`;
          } else if (isFilePath(value)) {
            valueStr = `"${smartTruncatePath(value)}"`;
          } else if (value.length > 60) {
            valueStr = `"${value.slice(0, 60)}..."`;
          } else {
            valueStr = `"${value}"`;
          }
        } else if (Array.isArray(value)) {
          valueStr = value.length === 0 ? "[]" : `<${value.length} 项>`;
        } else if (typeof value === "object" && value !== null) {
          const keys = Object.keys(value);
          valueStr = keys.length <= 3 ? `{${keys.join(", ")}}` : `{${keys.slice(0, 3).join(", ")}, ...}`;
        } else {
          valueStr = JSON.stringify(value);
        }

        formattedArgs.push({ isLast: idx === arr.length - 1, key, value: valueStr });
      });
    }

    return { args: formattedArgs, toolName: toolCall.name };
  } catch {
    return { args: [], toolName: toolCall.name };
  }
}

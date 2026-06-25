/**
 * Token 估算工具 — 提供消息 token 数量的粗略估算。
 *
 * 职责:
 *   - 估算文本内容的 token 数量
 *   - 支持中英文混合文本
 *   - 处理多模态内容（图片、工具结果等）
 *
 * 使用场景:
 *   - Token 预算预检查
 *   - 成本预估
 *   - 请求大小验证
 *
 * 注意:
 *   - 这是启发式估算，实际 token 数可能因模型而异
 *   - 仅用于预检查，不应用于精确计费
 */

import type { ModelMessage } from "ai";

/**
 * 估算单条消息的 token 数量。
 *
 * 估算规则:
 * - 英文：约 4 字符/token
 * - 中文：约 1.5 字符/token
 * - 代码块：约 3 字符/token（token 编码更高效）
 * - 系统开销：每条消息约 4 tokens
 * - 图片：每张约 100 tokens（保守估计）
 * - 工具结果：每个约 50 tokens
 *
 * @param msg 消息对象
 * @returns 估算的 token 数量
 */
export function estimateMessageTokens(msg: ModelMessage): number {
  let tokens = 4; // 每条消息的基础开销

  if (typeof msg.content === "string") {
    tokens += estimateTextTokens(msg.content);
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === "text" && typeof part.text === "string") {
        tokens += estimateTextTokens(part.text);
      } else if (part.type === "image") {
        // 图片内容：保守估计每张 100 tokens
        tokens += 100;
      } else if (part.type === "tool-result") {
        // 工具执行结果：保守估计每个 50 tokens
        tokens += 50;
      } else if (part.type === "file") {
        // 文件内容：保守估计每个 200 tokens
        tokens += 200;
      }
    }
  }

  return tokens;
}

/**
 * 估算文本的 token 数量。
 *
 * @param text 文本内容
 * @returns 估算的 token 数量
 */
export function estimateTextTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  // 简单估算：中文字符按 1.5 字符/token，其他按 4 字符/token
  // 代码块按更低的 token 率估算（约 3 字符/token，因为 token 编码更高效）
  const chineseChars = (text.match(/[一-龥]/g) || []).length;
  // 检测 fenced code blocks（``` ... ```），估算其内部字符数
  const codeBlockMatches = text.match(/```[\s\S]*?```/g);
  const codeBlockChars = codeBlockMatches
    ? codeBlockMatches.reduce((sum, block) => {
        // 去除 ``` 标记本身（每块约 6 个字符：开头 3 + 结尾 3）
        const innerLength = Math.max(0, block.length - 6);
        return sum + innerLength;
      }, 0)
    : 0;
  const otherChars = text.length - chineseChars - codeBlockChars;

  return Math.ceil(chineseChars / 1.5) + Math.ceil(codeBlockChars / 3) + Math.ceil(otherChars / 4);
}

/**
 * 估算消息列表的总 token 数量。
 *
 * @param messages 消息列表
 * @returns 估算的总 token 数量
 */
export function estimateMessagesTokens(messages: ModelMessage[]): number {
  return messages.reduce((total, msg) => total + estimateMessageTokens(msg), 0);
}

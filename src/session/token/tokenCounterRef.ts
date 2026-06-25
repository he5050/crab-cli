/**
 * Token 估算核心逻辑。
 *
 * 职责:
 *   - 估算纯文本的 token 数(区分 CJK 与其他字符)
 *   - 估算 ModelMessage 数组的总 token 数
 *   - 格式化 token 计数为可读字符串
 *
 * 模块功能:
 *   - estimateTokens: 估算字符串的 token 数
 *   - estimateMessagesTokens: 估算 ModelMessage 数组的总 token 数
 *   - formatTokenCount: 格式化 token 计数为可读字符串
 *
 * 使用场景:
 *   - LLM 对话上下文长度预算
 *   - 压缩策略触发的 token 阈值判断
 *   - 状态栏/日志中的人类可读 token 展示
 *
 * 边界:
 *   1. 纯计算函数，无副作用，不读写文件
 *   2. CJK 字符按 1.5 token/字符估算，其他字符按 4 字符/token 估算
 *   3. 不依赖任何 LLM Provider SDK
 *   4. 不感知具体模型的 tokenizer 实现
 */
import type { ModelMessage } from "ai";

export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  let cjkCount = 0;
  let otherCount = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (
      (code >= 0x4e_00 && code <= 0x9f_ff) ||
      (code >= 0x34_00 && code <= 0x4d_bf) ||
      (code >= 0x30_00 && code <= 0x30_3f) ||
      (code >= 0x30_40 && code <= 0x30_ff) ||
      (code >= 0xac_00 && code <= 0xd7_af) ||
      (code >= 0xf9_00 && code <= 0xfa_ff) ||
      (code >= 0xff_00 && code <= 0xff_ef)
    ) {
      cjkCount++;
    } else {
      otherCount++;
    }
  }

  return Math.ceil(cjkCount * 1.5 + otherCount / 4);
}

/**
 * 估算 ModelMessage 数组的总 token 数。
 * 这里保留为纯计算，避免 core 反向依赖 conversation。
 */
export function estimateMessagesTokens(messages: ModelMessage[]): number {
  let total = 0;

  for (const msg of messages) {
    total += 4;

    const { content } = msg;
    if (typeof content === "string") {
      total += estimateTokens(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part == null) {
          continue;
        }
        if (typeof part === "string") {
          total += estimateTokens(part);
        } else if ("type" in part) {
          if (part.type === "text" && "text" in part) {
            total += estimateTokens(String(part.text));
          } else if (part.type === "tool-call" && "input" in part) {
            total += estimateTokens(JSON.stringify(part.input));
            if ("toolName" in part) {
              total += estimateTokens(String(part.toolName));
            }
          } else if (part.type === "tool-result") {
            const output = "output" in part ? part.output : "";
            total += estimateTokens(typeof output === "string" ? output : JSON.stringify(output));
            if ("toolName" in part) {
              total += estimateTokens(String(part.toolName));
            }
          }
        }
      }
    }
  }

  return total;
}

export function formatTokenCount(count: number): string {
  if (count < 1000) {
    return `${count}`;
  }
  if (count < 1_000_000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return `${(count / 1_000_000).toFixed(1)}M`;
}

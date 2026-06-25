/**
 * Compressor
 *
 * 职责:
 *   - AI 摘要压缩(主流方法)
 *   - 工具结果截断(回退方法)
 *   - 清理孤立的 tool_calls
 *   - 查找保留区域起始索引
 *
 * 模块功能:
 *   - compressWithAI: AI 摘要压缩
 *   - truncateToolResults: 工具结果截断
 *   - pruneToolOutputs: 清理旧工具输出
 *   - cleanOrphanedToolCalls: 清理孤立 tool_calls
 *   - findPreserveStartIndex: 查找保留区域起始索引
 *   - findRecentRoundsStartIndex: 查找最近轮次起始索引
 *   - truncateOversizedToolResults: 截断超大工具结果
 *   - defaultCompressor: 默认压缩器实例
 *   - Compressor: 压缩器类
 *
 * 使用场景:
 *   - 上下文 Token 超出限制时压缩
 *   - 自动压缩触发时调用
 *   - 子代理上下文压缩
 *   - 混合压缩策略执行
 *
 * 边界:
 *   1. AI 压缩需要调用 LLM，可能耗时
 *   2. 工具结果截断会丢失部分信息
 *   3. 保留区域的消息不会被压缩
 *   4. 压缩前会清理孤立 tool_calls
 *
 * 流程:
 *   1. 检查 Token 使用率和阈值
 *   2. 清理孤立的 tool_calls
 *   3. 尝试 AI 摘要压缩
 *   4. 成功后截断超大工具结果
 *   5. 失败时回退到工具结果截断
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import { hookExecutor } from "@/hooks/hookExecutor";
import { estimateMessagesTokens, estimateTokens } from "../conversation";

import { COMPRESSION_PROMPT, serializeMessagesForCompression } from "../overflow/prompt";
import type { CompressConfig, CompressionResult } from "../types";
import { DEFAULT_COMPRESS_CONFIG } from "../types";
import { isToolCallPart, isToolResultPart } from "@/conversation/message/messagePartGuards";
import { rebuildAssistantContent } from "@/conversation/message/messageFactories";

const log = createLogger("compress");

// ─── 阈值常量 ────────────────────────────────────────────────

/** 默认保留尾部轮数 */
const DEFAULT_TAIL_TURNS = 2;
/** 保留区工具结果最大字符(截断用) */
const PRESERVED_TOOL_RESULT_MAX_CHARS = 2000;

// ─── 消息清理 ────────────────────────────────────────────────

/**
 * 清理孤立的 tool_calls。
 *
 * 删除违反 API 要求的消息:
 * 1. 有 tool_calls 的 assistant 消息但无对应的 tool result
 * 2. 有 tool_calls 的 assistant 消息但 tool result 不紧随其后
 * 3. tool result 消息但没有对应的 tool_calls
 * 4. tool result 消息没有紧接在对应的 assistant 之后
 *
 * P1-2 优化: 使用两遍 O(n) 算法替代 O(n²) 向前搜索。
 * 第一遍: 构建 toolCallId → assistantIndex 映射，收集所有 tool 消息索引
 * 第二遍: 检查孤立并标记删除
 */
export function cleanOrphanedToolCalls(messages: ModelMessage[]): void {
  const removeSet = new Set<number>();

  // ── 第一遍: 构建 toolCallId → assistantIndex 映射，收集 tool 消息索引 ──
  const toolCallToAssistantIndex = new Map<string, number>();
  const toolResultIndices: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (!Array.isArray(msg.content)) continue;

    if (msg.role === "assistant") {
      const toolCallParts = msg.content.filter(isToolCallPart) as Extract<
        typeof msg.content extends (infer T)[] ? T : never,
        { type: "tool-call" }
      >[];
      for (const part of toolCallParts) {
        if (part.toolCallId) {
          toolCallToAssistantIndex.set(part.toolCallId, i);
        }
      }
    }

    if (msg.role === "tool") {
      toolResultIndices.push(i);
    }
  }

  // ── 第二遍: 检查 assistant 是否有对应的 tool result ──
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || !Array.isArray(msg.content) || msg.role !== "assistant") continue;

    const toolCallParts = msg.content.filter(isToolCallPart) as Extract<
      typeof msg.content extends (infer T)[] ? T : never,
      { type: "tool-call" }
    >[];
    if (toolCallParts.length === 0) continue;

    // 检查下一条消息是否是 tool result
    const nextMsg = messages[i + 1];
    if (!nextMsg || nextMsg.role !== "tool") {
      removeSet.add(i);
      continue;
    }

    // 检查所有 tool_call 都有对应的 tool result
    const expectedIds = new Set(toolCallParts.map((p) => p.toolCallId).filter(Boolean));
    let foundCount = 0;

    for (let j = i + 1; j < messages.length; j++) {
      const following = messages[j];
      if (!following || following.role !== "tool") break;
      if (Array.isArray(following.content)) {
        for (const part of following.content) {
          if (isToolResultPart(part) && expectedIds.has(part.toolCallId)) {
            foundCount++;
          }
        }
      }
    }

    if (foundCount < expectedIds.size) {
      removeSet.add(i);
    }
  }

  // ── 第三遍: 检查 tool 消息是否有对应的 assistant（使用预构建的映射）─
  for (const toolIdx of toolResultIndices) {
    const msg = messages[toolIdx];
    if (!msg || !Array.isArray(msg.content)) continue;

    const toolResultParts = msg.content.filter(isToolResultPart) as Extract<
      typeof msg.content extends (infer T)[] ? T : never,
      { type: "tool-result" }
    >[];
    const toolCallIds = toolResultParts.map((p) => p.toolCallId).filter(Boolean) as string[];

    if (toolCallIds.length === 0) {
      removeSet.add(toolIdx);
      continue;
    }

    let hasValidAssistant = false;
    for (const id of toolCallIds) {
      const assistantIdx = toolCallToAssistantIndex.get(id);
      if (assistantIdx !== undefined && assistantIdx < toolIdx) {
        // 验证 assistant 和 tool 之间只有 tool 消息
        let onlyToolsBetween = true;
        for (let k = assistantIdx + 1; k < toolIdx; k++) {
          const between = messages[k];
          if (between && between.role !== "tool") {
            onlyToolsBetween = false;
            break;
          }
        }
        if (onlyToolsBetween) {
          hasValidAssistant = true;
          break;
        }
      }
    }

    if (!hasValidAssistant) {
      if (!removeSet.has(toolIdx)) {
        removeSet.add(toolIdx);
      }
    }
  }

  // ── 从后向前移除(保持索引正确) ──
  const sorted = [...removeSet].sort((a: number, b: number) => b - a);
  for (const idx of sorted) {
    messages.splice(idx, 1);
  }

  if (sorted.length > 0) {
    log.debug(`清理了 ${sorted.length} 条孤立 tool_call/tool_result 消息`);
  }
}

// ─── 保留起始位置 ────────────────────────────────────────────

/**
 * 找到需要保留的消息起始位置(保留最近的工具调用链)。
 *
 * 保留策略:
 * - 最后是 tool 消息 → 保留 assistant(tool_calls) → tool
 * - 最后是 assistant(tool_calls) → 保留此条
 * - 最后是普通 assistant 或 user → 全部压缩
 *
 * @returns 保留消息的起始索引
 */
export function findPreserveStartIndex(messages: ModelMessage[]): number {
  if (messages.length === 0) {
    return 0;
  }

  const lastMsg = messages[messages.length - 1];
  const lastContent = lastMsg?.content;

  // 检查最后一条是否是 tool 消息
  if (lastMsg?.role === "tool") {
    // 向前找对应的 assistant with tool-calls
    for (let i = messages.length - 2; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) {
        continue;
      }
      if (msg.role === "assistant") {
        const { content } = msg;
        if (Array.isArray(content)) {
          const hasToolCalls = content.some(isToolCallPart);
          if (hasToolCalls) {
            return i;
          }
        }
      }
    }
    return messages.length - 1;
  }

  // 检查最后一条是否是 assistant with tool-calls
  if (lastMsg?.role === "assistant" && Array.isArray(lastContent)) {
    const hasToolCalls = lastContent.some(isToolCallPart);
    if (hasToolCalls) {
      return messages.length - 1;
    }
  }

  // 普通消息 → 全部压缩
  return messages.length;
}

// ─── 辅助函数 ──────────────────────────────────────────────

/**
 * 判断 content 中是否包含 tool-call parts。
 */
function hasToolCallParts(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(isToolCallPart);
}

/**
 * 判断 content 中是否包含 tool-result parts。
 */
function hasToolResultParts(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(isToolResultPart);
}

/**
 * 从 tool 消息的 content 中查找对应的 toolCallId。
 */
function findToolCallIds(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter(isToolResultPart)
    .map((p) => p.toolCallId)
    .filter(Boolean);
}

/**
 * 从 assistant 消息的 content 中查找 tool-call 的 toolName。
 */
function findToolNames(content: unknown, toolCallId: string): string {
  if (!Array.isArray(content)) {
    return "unknown";
  }
  for (const p of content) {
    if (isToolCallPart(p)) {
      if (p.toolCallId === toolCallId) {
        return String(p.toolName);
      }
    }
  }
  return "unknown";
}

// ─── 轮次切割(子代理用) ──────────────────────────────────

/**
 * 按轮次切割:从后向前数 N 个完整的工具调用轮次。
 *
 * 一个轮次 = assistant(tool_calls) + 连续的 tool results。
 * 与 findPreserveStartIndex 不同，此方法保留多个轮次。
 *
 *
 * @param messages - 消息数组
 * @param keepRounds - 要保留的轮数
 * @returns 切割起始索引
 */
export function findRecentRoundsStartIndex(messages: ModelMessage[], keepRounds: number): number {
  let roundCount = 0;
  let i = messages.length - 1;

  while (i >= 0 && roundCount < keepRounds) {
    const msg = messages[i];
    if (!msg) {
      i--;
      continue;
    }

    if (msg.role === "tool" || (hasToolResultParts(msg.content) && msg.role !== "assistant")) {
      // 跳过所有连续的 tool 消息
      while (i >= 0) {
        const m = messages[i];
        if (m && (m.role === "tool" || hasToolResultParts(m?.content))) {
          i--;
        } else {
          break;
        }
      }
      // I 现在应指向 assistant(tool_calls) 消息
      if (i >= 0 && messages[i]?.role === "assistant" && hasToolCallParts(messages[i]?.content)) {
        roundCount++;
        i--;
      }
    } else {
      i--;
    }
  }

  let cut = Math.max(0, i + 1);

  // 防御性检查:不要在孤立的 tool 消息中间切割
  while (cut < messages.length) {
    const m = messages[cut];
    if (!m) {
      break;
    }
    if (m.role === "tool" && !hasPrecedingAssistantWithToolCall(messages, cut)) {
      cut++;
      continue;
    }
    break;
  }

  return cut;
}

/**
 * 检查 messages[idx](tool 消息)在之前是否有对应的 assistant(tool_calls)。
 */
function hasPrecedingAssistantWithToolCall(messages: ModelMessage[], idx: number): boolean {
  const toolCallIds = findToolCallIds(messages[idx]?.content);
  if (toolCallIds.length === 0) {
    return false;
  }

  for (let j = idx - 1; j >= 0; j--) {
    const m = messages[j];
    if (!m) {
      continue;
    }
    if (m.role === "assistant" && hasToolCallParts(m.content)) {
      return true;
    }
    if (m.role === "user") {
      return false;
    }
  }
  return false;
}

// ─── 保留区截断(Gap #3) ──────────────────────────────────

/**
 * 截断保留区域中超大的工具结果。
 *
 * 保留结果的首 60% + 尾 30%，中间用占位符替换。
 * AI 压缩省下的 token 不被保留区的大工具输出吃掉。
 *
 * 注: 此函数用于压缩后保留区的精简。压缩前工具输出的 head-only 截断
 * 见 conversation/compaction.ts → truncateToolOutputs。
 * 两者策略不同：本函数保留头尾（更适合摘要后保留区），
 * truncateToolOutputs 仅保留头部（更适合压缩前预处理）。
 *
 * @param messages - 消息数组(就地修改)
 * @param maxChars - 每个工具结果的最大字符数
 */
export function truncateOversizedToolResults(
  messages: ModelMessage[],
  maxChars: number = PRESERVED_TOOL_RESULT_MAX_CHARS,
): void {
  for (let idx = 0; idx < messages.length; idx++) {
    const msg = messages[idx];
    if (!msg) {
      continue;
    }
    const { content } = msg;
    if (typeof content === "string") {
      continue;
    }
    if (!Array.isArray(content)) {
      continue;
    }

    let modified = false;
    const newParts = content.map((part) => {
      if (!isToolResultPart(part)) {
        return part;
      }

      const { output } = part;
      if (output == null) {
        return part;
      }

      const outputStr = typeof output === "string" ? output : JSON.stringify(output);
      if (outputStr.length <= maxChars) {
        return part;
      }

      modified = true;

      // 查找工具名
      const toolCallId = part.toolCallId ? String(part.toolCallId) : undefined;
      let toolName = "unknown";
      if (toolCallId) {
        for (let j = idx - 1; j >= 0; j--) {
          const prev = messages[j];
          if (prev?.role === "assistant" && hasToolCallParts(prev.content)) {
            toolName = findToolNames(prev.content, toolCallId);
            break;
          }
          if (prev?.role !== "tool") {
            break;
          }
        }
      }

      const keepStart = Math.floor(maxChars * 0.6);
      const keepEnd = Math.floor(maxChars * 0.3);
      const truncated = outputStr.length - keepStart - keepEnd;

      return {
        ...part,
        output: `${outputStr.substring(
          0,
          keepStart,
        )}\n\n[... ${truncated} chars truncated from ${toolName} result ...]\n\n${outputStr.substring(
          outputStr.length - keepEnd,
        )}`,
      };
    });

    if (modified) {
      messages[idx] = rebuildAssistantContent(msg, newParts);
    }
  }
}

// ─── 共享 LLM 调用 ──────────────────────────────────────────

/**
 * 调用 LLM 生成压缩摘要。
 *
 * 使用动态 `import("@api")` 延迟加载 LLM 调用模块，
 * 避免压缩模块初始化时产生对 `@api` 的静态循环依赖。
 * 与 `CompactAgent`（使用静态 import）不同，此函数被 Compressor 和
 * SubAgentCompressor 在运行时按需调用。
 *
 * @param serialized - 序列化的消息文本
 * @param systemPrompt - 系统提示词
 * @param appConfig - 应用配置
 * @param caller - 调用方标识（用于日志）
 * @returns 摘要文本，失败返回 null
 */
export async function callLlmForSummary(
  serialized: string,
  systemPrompt: string,
  appConfig: AppConfigSchema,
  caller: string,
): Promise<string | null> {
  const userPrompt = `## Conversation History to Compress\n\n${serialized}`;
  try {
    const { completeLlm } = await import("@api");
    const { text: summary } = await completeLlm(appConfig, [{ content: userPrompt, role: "user" }], {
      maxTokens: 4000,
      system: systemPrompt,
      temperature: 0.3,
      timeout: 15_000,
    });
    if (!summary) {
      log.warn(`${caller}: AI 摘要生成返回空结果`);
      return null;
    }
    return summary;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.warn(`${caller}: AI 摘要压缩失败: ${errMsg}`);
    return null;
  }
}

// ─── 主压缩器类 ──────────────────────────────────────────────

export class Compressor {
  private config: CompressConfig;

  constructor(config?: Partial<CompressConfig>) {
    this.config = { ...DEFAULT_COMPRESS_CONFIG, ...config };
  }

  /**
   * AI 摘要压缩(主流方法)。
   *
   * 使用 LLM 将旧消息生成结构化交接文档，替换原消息。
   * 注意：锁管理由调用方（如 compressService）通过 compressionCoordinator.withLock 统一处理，
   * 本方法内部不再获取锁，避免嵌套锁导致级联超时。
   */
  async compressWithAI(
    messages: ModelMessage[],
    appConfig: AppConfigSchema,
    sessionId?: string,
  ): Promise<CompressionResult | null> {
    return this.compressWithCustomPrompt(messages, appConfig, COMPRESSION_PROMPT, "compress:ai", sessionId);
  }

  /**
   * 使用自定义提示词的 AI 摘要压缩。
   *
   * 将 orchestrator（切片 → 清理 → 序列化 → LLM 调用）与 Compressor 解耦，
   * 供 SubAgentCompressor 等需要不同提示词的场景复用核心逻辑。
   *
   * @param messages - 对话消息数组（将被就地修改）
   * @param appConfig - 应用配置
   * @param systemPrompt - 压缩提示词
   * @param caller - 调用方标识（日志用）
   * @param sessionId - 会话 ID（Hook 用）
   * @returns 压缩结果，无需压缩时返回 null
   */
  async compressWithCustomPrompt(
    messages: ModelMessage[],
    appConfig: AppConfigSchema,
    systemPrompt: string,
    caller: string,
    sessionId?: string,
  ): Promise<CompressionResult | null> {
    if (messages.length === 0) {
      return null;
    }

    // Compress Hook (before)
    const tokensBefore = estimateMessagesTokens(messages);
    await hookExecutor.compress(sessionId ?? "", "before", tokensBefore);

    // 找保留位置
    const preserveStart = findPreserveStartIndex(messages);
    if (preserveStart === 0) {
      log.debug("所有消息都需要保留，无法压缩");
      return null;
    }

    const messagesToCompress = messages.slice(0, preserveStart);
    const preservedMessages = messages.slice(preserveStart);

    // 清理孤立的 tool_calls
    cleanOrphanedToolCalls(messagesToCompress);

    // 序列化并调用 LLM
    const serialized = serializeMessagesForCompression(messagesToCompress, this.config.toolOutputTruncateLength);

    const summary = await callLlmForSummary(serialized, systemPrompt, appConfig, caller);

    if (!summary) {
      return null;
    }

    // 构造压缩后的消息数组
    messages.length = 0;
    messages.push(
      {
        content: `[系统自动生成的对话摘要 — 以下是之前对话的压缩版]\n\n${summary}`,
        role: "user",
      },
      {
        content: "收到，我已了解之前的对话上下文摘要。请继续。",
        role: "assistant",
      },
      ...preservedMessages,
    );

    const tokensAfter = estimateMessagesTokens(messages);

    log.info(`AI 压缩完成`, {
      eventType: "compress.ai.done",
      payload: {
        compressionRatio: `${Math.round((1 - tokensAfter / tokensBefore) * 100)}%`,
        preservedCount: preservedMessages.length,
        summaryLength: summary.length,
        tokensAfter,
        tokensBefore,
      },
      success: true,
    });

    // Compress Hook (after)
    await hookExecutor.compress(sessionId ?? "", "after", tokensAfter);

    const summaryTokens = estimateTokens(summary);
    const serializedTokens = estimateTokens(serialized);

    return {
      preservedMessageStartIndex: preserveStart,
      preservedMessages,
      summary,
      usage: {
        completion_tokens: summaryTokens,
        prompt_tokens: serializedTokens,
        total_tokens: serializedTokens + summaryTokens,
      },
    };
  }

  /**
   * 工具结果截断(回退方法)。
   *
   * 不调用 LLM，直接截断大型工具输出。
   */
  truncateToolResults(messages: ModelMessage[], keepRounds: number = DEFAULT_TAIL_TURNS): ModelMessage[] {
    const result = [...messages];
    const startFrom = Math.max(0, result.length - keepRounds * 2);

    for (let i = 0; i < startFrom; i++) {
      const msg = result[i];
      if (!msg) {
        continue;
      }
      const { content } = msg;
      if (typeof content === "string") {
        continue;
      }
      if (!Array.isArray(content)) {
        continue;
      }

      const newParts = content.map((part) => {
        if (!isToolResultPart(part)) {
          return part;
        }

        const { output } = part;
        if (output == null) {
          return part;
        }

        const outputStr = typeof output === "string" ? output : JSON.stringify(output);
        if (outputStr.length <= this.config.toolOutputTruncateLength) {
          return part;
        }

        return {
          ...part,
          output: `${outputStr.slice(0, this.config.toolOutputTruncateLength)}\n...[截断，原始长度 ${outputStr.length} 字符]`,
        };
      });

      result[i] = rebuildAssistantContent(msg, newParts);
    }

    return result;
  }
}

/** 全局默认压缩器实例 */
export const defaultCompressor = new Compressor();

/**
 * 使用自定义提示词执行 AI 压缩（独立函数，委托给 defaultCompressor）。
 */
export function compressWithCustomPrompt(
  messages: ModelMessage[],
  appConfig: AppConfigSchema,
  systemPrompt: string,
  caller: string,
  sessionId?: string,
): Promise<CompressionResult | null> {
  return defaultCompressor.compressWithCustomPrompt(messages, appConfig, systemPrompt, caller, sessionId);
}

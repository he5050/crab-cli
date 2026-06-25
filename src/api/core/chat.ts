/**
 * Chat API — 高层对话接口（对 streamLlm 的语义化封装）。
 *
 * 职责:
 *   - 提供简化的 chat() / chatComplete() 函数
 *   - 参数校验与默认值填充
 *   - Usage 统计聚合
 *   - 内部调用 LLM 引擎
 *
 * 使用场景:
 *   - Hook 执行器等需要简化对话调用的场景
 *   - 快速集成对话功能
 *   - 不需要手动处理流事件的场景
 *
 * 边界:
 *   - 仅提供便捷封装，核心逻辑在 llm.ts
 *   - chatComplete() 返回聚合后的完整结果（文本 + usage + reasoning）
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { type LlmOptions, type LlmStreamEvent, type LlmTokenUsage, streamLlm, completeLlm } from "./llm";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("chat");

/** chatComplete 的返回结果 — 聚合流式事件的最终状态 */
export interface ChatResult {
  /** 完整文本内容 */
  text: string;
  /** 完整推理内容（如果有） */
  reasoning?: string;
  /** Token 使用统计 */
  usage?: LlmTokenUsage;
}

/**
 * 流式对话 — 对 streamLlm 的语义化封装。
 * 自动进行参数校验和日志记录。
 */
export async function* chat(
  config: AppConfigSchema,
  messages: ModelMessage[],
  options: LlmOptions = {},
): AsyncGenerator<LlmStreamEvent> {
  // 参数校验：消息列表不能为空
  if (!messages || messages.length === 0) {
    const error = new Error("chat: 消息列表不能为空");
    log.warn(`参数校验失败: ${error.message}`);
    yield { type: "error", error };
    return;
  }

  log.debug(`开始对话流`, { eventType: "chat.start", messageCount: messages.length });
  yield* streamLlm(config, messages, options);
  log.debug(`对话流结束`, { eventType: "chat.end" });
}

/**
 * 非流式对话 — 等待完整响应后返回聚合结果。
 * 适用于不需要实时显示生成过程的场景（如后台任务、批量处理）。
 * 内部委托给 completeLlm，仅增加参数校验和日志。
 *
 * @returns 聚合后的完整结果（文本 + usage + reasoning）
 * @throws 当流式过程中出现错误时抛出
 */
export async function chatComplete(
  config: AppConfigSchema,
  messages: ModelMessage[],
  options: LlmOptions = {},
): Promise<ChatResult> {
  // 参数校验：消息列表不能为空
  if (!messages || messages.length === 0) {
    throw new Error("chatComplete: 消息列表不能为空");
  }

  log.debug(`开始非流式对话`, { eventType: "chat.complete.start", messageCount: messages.length });

  const result = await completeLlm(config, messages, options);

  log.debug(`非流式对话完成`, {
    eventType: "chat.complete.end",
    messageCount: messages.length,
    textLength: result.text.length,
    reasoningLength: result.reasoning?.length ?? 0,
    usage: result.usage,
  });

  return result;
}

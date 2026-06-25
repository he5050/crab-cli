/**
 * Mock stream generator — 替代 mock.module("llm") 的流式注入方案。
 *
 * 使用方式:将 createStreamFn 返回的函数传入 ConversationHandler({ streamFn })。
 * 无需 mock.module，不会产生跨文件污染。
 */
import type { LlmStreamEvent } from "@/api";
import type { AppConfigSchema } from "@/schema/config";
import type { ModelMessage } from "ai";

type StreamFn = (
  config: AppConfigSchema,
  messages: ModelMessage[],
  options?: Record<string, any>,
) => AsyncGenerator<LlmStreamEvent>;

/** 单轮流事件描述 */
export type StreamRoundDef =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolName: string; toolCallId: string; args: unknown }
  | { type: "error"; error: Error }
  | { type: "done"; fullText?: string };

/**
 * 从轮次定义列表创建一个 streamFn。
 *
 * @param rounds 每次被调用时依次使用的轮次定义数组
 *   - 每个数组元素是一轮的所有事件(text/tool-call/error/done)
 *   - 如果调用次数超过 rounds 长度，最后一轮会自动加 done
 *
 * @example
 * const streamFn = createStreamFn([
 *   // 第一轮:纯文本
 *   [{ type: "text", text: "你好" }, { type: "done" }],
 *   // 第二轮:工具调用后文本
 *   [
 *     { type: "tool-call", toolName: "fs_read", toolCallId: "c1", args: { path: "a.txt" } },
 *     { type: "done" },
 *   ],
 *   [{ type: "text", text: "文件内容是 hello" }, { type: "done", fullText: "文件内容是 hello" }],
 * ]);
 */
export function createStreamFn(rounds: StreamRoundDef[][]): StreamFn {
  let callIndex = 0;

  return async function* (
    _config: AppConfigSchema,
    _messages: ModelMessage[],
    _options?: Record<string, any>,
  ): AsyncGenerator<LlmStreamEvent> {
    const roundDef = rounds[Math.min(callIndex, rounds.length - 1)];
    callIndex++;

    if (!roundDef || roundDef.length === 0) {
      yield { fullText: "", type: "done" as const };
      return;
    }

    let hasDone = false;
    for (const event of roundDef) {
      if (event.type === "text") {
        yield { text: event.text, type: "text-delta" as const };
      } else if (event.type === "tool-call") {
        yield {
          args: event.args,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          type: "tool-call" as const,
        };
      } else if (event.type === "error") {
        yield { error: event.error, type: "error" as const };
      } else if (event.type === "done") {
        hasDone = true;
        yield {
          fullText: event.fullText ?? "",
          type: "done" as const,
        };
      }
    }

    // 自动补 done 事件(如果轮次没有显式包含)
    if (!hasDone) {
      yield { fullText: "", type: "done" as const };
    }
  };
}

/**
 * 快捷:创建纯文本回复的 streamFn。
 * 多次调用返回相同文本。
 */
export function textStreamFn(text: string): StreamFn {
  return createStreamFn([
    [
      { text, type: "text" },
      { fullText: text, type: "done" },
    ],
  ]);
}

/**
 * 快捷:创建带工具调用 + 后续文本回复的 streamFn。
 */
export function toolCallStreamFn(toolName: string, toolCallId: string, args: unknown, responseText: string): StreamFn {
  return createStreamFn([
    [{ args, toolCallId, toolName, type: "tool-call" }, { type: "done" }],
    [
      { text: responseText, type: "text" },
      { fullText: responseText, type: "done" },
    ],
  ]);
}

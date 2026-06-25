/**
 * 停止处理(Stop Handler)— 对话结束后的 Hook 处理。
 *
 * 职责:
 *   - 执行 onStop Hook
 *   - 处理 Hook 注入的消息
 *   - 解析 Hook 输出中的 JSON 指令
 *
 * 模块功能:
 *   - handleStopHook(): 执行对话停止 Hook 并返回结果
 *
 * 使用场景:
 *   - 对话正常结束时(而非中止)调用
 *   - 支持 Hook 返回 injectedMessages 和 shouldContinueConversation
 *
 * 边界:
 * 1. Hook 输出格式为 JSON，支持 injectedMessages 和 shouldContinueConversation
 * 2. 非 JSON 输出被忽略(普通 shell hook 的 stdout)
 * 3. 无 sessionId 时直接返回 shouldContinue=false
 *
 * 流程:
 * 1. 调用 hookExecutor.stop() 获取所有 Hook 结果
 * 2. 解析 Hook 输出中的 JSON 指令
 * 3. 提取注入消息(injectedMessages)
 * 4. 检查是否应该继续对话(shouldContinueConversation)
 */

import { createLogger } from "@/core/logging/logger";
import { hookExecutor } from "@/hooks/hookExecutor";

const log = createLogger("conversation:stop");

/** 停止 Hook 结果 */
export interface StopHookResult {
  /** 是否应该继续对话(Hook 注入了新的用户消息) */
  shouldContinue: boolean;
  /** Hook 注入的消息(如有) */
  injectedMessages?: {
    role: "user" | "assistant";
    content: string;
  }[];
}

/**
 * 处理对话停止 Hook。
 *
 * 在对话正常结束时调用(非中止)，执行 onStop Hook:
 *   1. 调用 hookExecutor.stop() 获取所有 Hook 结果
 *   2. 解析 Hook 输出中的 JSON 指令
 *   3. 如果 Hook 返回了 injectedMessages，提取并返回
 *   4. 如果 shouldContinueConversation=true，返回 shouldContinue=true
 *
 * Hook 输出格式(JSON):
 *   {
 *     "injectedMessages": [
 *       { "role": "user", "content": "继续执行..." }
 *     ],
 *     "shouldContinueConversation": true
 *   }
 *
 * @param sessionId - 会话 ID
 * @returns 停止 Hook 结果
 */
export async function handleStopHook(sessionId?: string): Promise<StopHookResult> {
  if (!sessionId) {
    return { shouldContinue: false };
  }

  try {
    const results = await hookExecutor.stop(sessionId);

    // 解析 Hook 结果中的注入消息
    const injectedMessages: { role: "user" | "assistant"; content: string }[] = [];
    let shouldContinue = false;

    for (const result of results) {
      if (!result.success || !result.output) {
        continue;
      }

      try {
        const parsed = JSON.parse(result.output);

        // 提取注入消息
        if (Array.isArray(parsed.injectedMessages)) {
          for (const msg of parsed.injectedMessages) {
            if (msg.role === "user" || msg.role === "assistant") {
              injectedMessages.push({
                content: String(msg.content),
                role: msg.role,
              });
            }
          }
        }

        // 检查是否应该继续对话
        if (parsed.shouldContinueConversation === true) {
          shouldContinue = true;
        }
      } catch {
        // 非 JSON 输出，忽略(普通 shell hook 的 stdout)
      }
    }

    if (injectedMessages.length > 0 || shouldContinue) {
      log.info(`Stop Hook 返回注入消息: ${injectedMessages.length} 条, shouldContinue=${shouldContinue}`);
      return {
        injectedMessages: injectedMessages.length > 0 ? injectedMessages : undefined,
        shouldContinue: shouldContinue || injectedMessages.some((m) => m.role === "user"),
      };
    }

    return { shouldContinue: false };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.warn(`Stop Hook 执行失败: ${errMsg}`);
    return { shouldContinue: false };
  }
}

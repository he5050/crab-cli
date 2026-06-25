/**
 * 对话准备 — 工具加载、上下文同步、消息清理
 *
 * 职责:
 *   - 准备对话所需的工具列表
 *   - 同步代码库上下文
 *   - 清理孤立 tool_calls
 *
 * 模块功能:
 *   - ConversationSetupResult: 对话准备结果接口
 *   - prepareConversationSetup: 准备对话设置
 *
 * 使用场景:
 *   - 对话开始前的准备工作
 *   - 工具加载和注册
 *   - 上下文同步
 *
 * 边界:
 * 1. ConversationSetup 是静态工具函数集合
 * 2. 在 ConversationHandler.sendMessage 开始前调用
 * 3. 不管理消息状态
 *
 * 流程:
 * 1. 调用 buildCodebaseContext 获取代码库上下文(目录结构 + 最近修改文件)
 *   2. 调用 cleanOrphanedToolCallsFromModel 清理消息历史中的孤立 tool_calls
 *   3. 收集当前可用工具列表
 */

import type { ModelMessage } from "ai";
import { createLogger } from "@/core/logging/logger";
import { type ContextInjectOptions, buildCodebaseContext } from "./contextInjector";
import { cleanOrphanedToolCallsFromModel } from "@/conversation/message/messageBuilder";
import { getRegisteredTools } from "@/tool/registry/toolRegistry";

const log = createLogger("conversation:setup");

/** 对话准备结果 */
export interface ConversationSetupResult {
  /** 是否准备成功 */
  ok: boolean;
  /** 错误信息(ok=false 时有值) */
  error?: string;
  /** 代码库上下文文本 */
  codebaseContext?: string;
  /** 当前可用的工具名称列表 */
  availableTools?: string[];
}

/**
 * 准备对话环境。
 *
 * 在每次 sendMessage 之前调用:
 *   1. 获取代码库上下文(目录结构 + 最近修改文件)
 *   2. 清理消息历史中的孤立 tool_calls
 *
 *
 * @param messages - 当前消息历史(将被就地修改:清理孤立 tool_calls)
 * @param options - 上下文注入选项
 */
export async function prepareConversation(
  messages: ModelMessage[],
  options?: Partial<ContextInjectOptions>,
): Promise<ConversationSetupResult> {
  try {
    // 1. 获取代码库上下文
    let codebaseContext: string | undefined;
    try {
      codebaseContext = await buildCodebaseContext(options);
    } catch (error) {
      log.debug(`获取代码库上下文失败(不影响对话): ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2. 清理孤立 tool_calls
    cleanOrphanedToolCallsFromModel(messages);

    // 3. 收集当前可用工具列表
    const availableTools = Object.keys(getRegisteredTools());

    return {
      availableTools,
      codebaseContext,
      ok: true,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(`对话准备失败: ${errMsg}`);
    return {
      error: errMsg,
      ok: false,
    };
  }
}

/**
 * 工具运行时执行器 — 统一执行已注册的工具
 *
 * 职责:
 *   - 创建工具执行的基础上下文
 *   - 执行已注册的工具并处理参数验证
 *   - 统一工具执行的错误处理
 *
 * 模块功能:
 *   - createBaseToolContext: 创建基础工具上下文(包含会话 ID、消息 ID 等)
 *   - executeRegisteredTool: 执行指定名称的已注册工具，返回执行结果
 *   - RuntimeToolExecutionResult: 工具执行结果接口定义
 *
 * 使用场景:
 *   - 消息处理器调用工具执行用户请求
 *   - 工具链或工作流中的工具编排
 *   - 测试和调试工具执行
 *
 * 边界:
 * 1. 只能执行已在 toolRegistry 中注册的工具
 * 2. 工具参数必须符合 Zod schema 定义
 * 3. 执行失败返回错误信息而非抛出异常
 * 4. 工具执行结果是字符串或 JSON 序列化后的字符串
 *
 * 流程:
 * 1. 根据工具名称从 registry 获取工具定义
 * 2. 使用 Zod schema 验证传入参数
 * 3. 调用工具的 execute 方法
 * 4. 序列化结果或捕获并返回错误
 */

import { createLogger } from "@/core/logging/logger";
import { createId } from "@/core/identity";
import type { ToolContext } from "../types";
import { DEFAULT_CONFIG } from "@/config";
import { ToolExecutor, type ToolExecutorOptions } from "./toolExecutor";
import type { AppConfigSchema } from "@/schema/config";

const log = createLogger("tool:runtimeExec");

/** 创建基础工具执行上下文 @param sessionId 会话 ID @param abortSignal 可选中止信号 @returns 工具上下文 */
export function createBaseToolContext(sessionId: string, abortSignal?: AbortSignal): ToolContext {
  return {
    abortSignal,
    messageId: createId("msg"),
    sessionId,
  };
}

/** 运行时工具执行结果 */
export interface RuntimeToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

/** 运行时工具执行选项 */
export interface RuntimeToolExecutionOptions {
  getConfig?: () => AppConfigSchema;
  defaultTimeout?: number;
  askPermission?: ToolExecutorOptions["askPermission"];
}

/** 执行指定名称的已注册工具 @param toolName 工具名称 @param rawArgs 原始参数 @param context 工具上下文 @param options 执行选项 @returns 标准化执行结果 */
export async function executeRegisteredTool(
  toolName: string,
  rawArgs: Record<string, unknown>,
  context: ToolContext,
  options?: RuntimeToolExecutionOptions,
): Promise<RuntimeToolExecutionResult> {
  const executor = new ToolExecutor({
    askPermission: options?.askPermission ?? (async () => true),
    defaultTimeout: options?.defaultTimeout,
    getConfig: options?.getConfig ?? (() => DEFAULT_CONFIG),
    getToolContext: () => context,
  });

  try {
    const result = await executor.execute(toolName, rawArgs, { signal: context.abortSignal });
    const normalizedError = result.success
      ? undefined
      : result.error?.startsWith('Tool not found: "')
        ? `未知工具: ${toolName}`
        : result.error;
    return {
      error: normalizedError,
      output: result.success
        ? typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output ?? "")
        : `Error: ${normalizedError ?? ""}`,
      success: result.success,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn(`工具执行异常`, { error, toolName });
    return {
      error,
      output: `Error: ${error}`,
      success: false,
    };
  }
}

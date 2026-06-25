/**
 * 工具执行核心模块 — 参数验证、调用、超时与结果截断的统一封装。
 *
 * 职责:
 *   - 负责参数 Zod 验证、工具 execute 调用、超时包装
 *   - 对执行结果进行 token 限制截断
 *   - 统一返回 ToolExecutionCoreResult(success / validation_failed / exception)
 *
 * 模块功能:
 *   - executeToolCore: 工具执行核心函数(被 ToolExecutor 复用)
 *   - truncateByTokenLimit: 工具输出按 token 上限截断
 *   - ToolExecutionCoreOptions: 核心入参(toolName/tool/args/timeout/signal 等)
 *   - ToolExecutionCoreResult: 核心返回的判别联合
 *
 * 使用场景:
 *   - ToolExecutor 在执行前调用此模块做参数校验和统一错误结构
 *   - 任何需要 per-tool timeoutMs 的工具入口
 *
 * 边界:
 *   1. 不感知权限/敏感命令/审计，由 ToolExecutor 上层处理
 *   2. 超时控制委托 runWithTimeout(per-tool)或 withTimeoutAndSignal(fallback)
 *   3. 截断基于 token 限制器，对 string 直接限长，对 object 仅在 JSON 长度 > 100k 时截断
 *   4. 不改变工具的返回值结构(除截断外)
 *
 * 流程:
 *   1. tool.parameters.parse 校验 args(ZodError → validation_failed)
 *   2. 选择 effectivePerToolTimeout 或 fallbackTimeout
 *   3. 通过 runWithTimeout / withTimeoutAndSignal 触发工具 execute
 *   4. truncateByTokenLimit 对结果进行 token 截断
 *   5. 返回 success；异常被 catch 后返回 exception(不再 throw)
 */
import { DEFAULT_TOOL_EXECUTION_TIMEOUT_MS } from "@/config";
import { createLogger } from "@/core/logging/logger";
import { withTimeoutAndSignal } from "@/core/concurrency/promiseUtils";
import type { AppConfigSchema } from "@/schema/config";
import type { ToolContext, ToolDefinition } from "../types";
import { runWithTimeout } from "./toolTimeout";
import { z } from "zod";

const log = createLogger("tool:execution-core");

/** 工具执行核心结果（判别联合：成功/验证失败/异常） */
export type ToolExecutionCoreResult =
  | {
      kind: "success";
      toolName: string;
      args: Record<string, unknown>;
      output: unknown;
      durationMs: number;
    }
  | {
      kind: "validation_failed";
      toolName: string;
      args: Record<string, unknown>;
      error: string;
      durationMs: number;
    }
  | {
      kind: "exception";
      toolName: string;
      args: Record<string, unknown>;
      error: string;
      exception: Error;
      durationMs: number;
    };

/** 工具执行核心入参 */
export interface ToolExecutionCoreOptions {
  toolName: string;
  tool: ToolDefinition<any>;
  args: Record<string, unknown>;
  startTime: number;
  fallbackTimeout?: number;
  signal?: AbortSignal;
  getConfig: () => AppConfigSchema;
  getToolContext?: () => ToolContext;
}

/** 工具执行核心函数：参数验证、超时控制、结果截断的统一封装 */
export async function executeToolCore(options: ToolExecutionCoreOptions): Promise<ToolExecutionCoreResult> {
  const { toolName, tool, startTime } = options;
  let { args } = options;

  log.debug(`开始参数验证`, { toolName });
  try {
    args = tool.parameters.parse(args) as Record<string, unknown>;
    log.debug(`参数验证通过`, { toolName });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      log.warn(`参数验证失败`, { issues, toolName });
      return {
        args: options.args,
        durationMs: Date.now() - startTime,
        error: issues,
        kind: "validation_failed",
        toolName,
      };
    }
    log.error(`参数验证时发生非预期异常`, { error: error instanceof Error ? error.message : String(error), toolName });
    throw error;
  }

  const effectivePerToolTimeout = tool.timeoutMs && tool.timeoutMs > 0 ? tool.timeoutMs : undefined;
  const fallbackTimeout = options.fallbackTimeout ?? DEFAULT_TOOL_EXECUTION_TIMEOUT_MS;
  const logTimeout = effectivePerToolTimeout ?? fallbackTimeout;
  log.info(`开始执行工具`, { perTool: Boolean(effectivePerToolTimeout), timeoutMs: logTimeout, toolName });

  try {
    let result: unknown;
    if (effectivePerToolTimeout) {
      const baseToolCtx = options.getToolContext?.();
      const toolCtx = {
        sessionId: baseToolCtx?.sessionId ?? "unknown",
        messageId: baseToolCtx?.messageId ?? "unknown",
        ...baseToolCtx,
        abortSignal: baseToolCtx?.abortSignal ?? options.signal,
      };
      result = await runWithTimeout(
        tool as ToolDefinition & { timeoutMs: number },
        args as Record<string, unknown>,
        toolCtx,
      );
    } else {
      result = await withTimeoutAndSignal(
        tool.execute(args, options.getToolContext?.()),
        fallbackTimeout,
        options.signal,
        `Tool "${toolName}" timed out after ${fallbackTimeout}ms`,
      );
    }

    const durationMs = Date.now() - startTime;
    const output = await truncateByTokenLimit(toolName, result, options.getConfig);
    log.info(`工具执行完成`, { durationMs, outputType: typeof result, toolName });
    log.debug(`工具执行结果`, {
      outputPreview: typeof output === "string" ? output.slice(0, 200) : "[object]",
      outputType: typeof output,
      toolName,
    });

    return {
      args,
      durationMs,
      kind: "success",
      output,
      toolName,
    };
  } catch (error) {
    const exception = error instanceof Error ? error : new Error(String(error));
    const durationMs = Date.now() - startTime;
    log.error(`工具执行失败`, { durationMs, error: exception.message, toolName });
    return {
      args,
      durationMs,
      error: exception.message,
      exception,
      kind: "exception",
      toolName,
    };
  }
}

async function truncateByTokenLimit(
  toolName: string,
  result: unknown,
  getConfig: () => AppConfigSchema,
): Promise<unknown> {
  if (result && typeof result === "string") {
    const { validateAndTruncate, getToolResultTokenLimit } = await import("@/core/concurrency/tokenLimiter");
    const limit = getToolResultTokenLimit(getConfig());
    const limited = validateAndTruncate(result, limit);
    if (limited.truncated) {
      // 写入完整输出到临时文件，供用户后续查阅
      const { writeToolOutputToFile } = await import("../result/truncate");
      const filePath = writeToolOutputToFile(result);
      const fileHint = filePath
        ? `\n\n完整输出已保存到: ${filePath}\n可使用 Read 工具查看完整内容(建议用 offset/limit 分段读取)。`
        : "";
      log.info(`工具输出被截断`, { limit, tokens: limited.tokenCount, toolName });
      return limited.content + fileHint;
    }
    return result;
  }

  if (result && typeof result === "object") {
    let outputStr: string;
    try {
      outputStr = JSON.stringify(result);
    } catch {
      outputStr = "[Circular or non-serializable object]";
      log.warn(`工具输出序列化失败，使用占位符`, { toolName });
    }
    if (outputStr.length > 100_000) {
      const { validateAndTruncate, getToolResultTokenLimit } = await import("@/core/concurrency/tokenLimiter");
      const limit = getToolResultTokenLimit(getConfig());
      const limited = validateAndTruncate(outputStr, limit);
      if (limited.truncated) {
        log.info(`工具输出被截断`, { limit, tokens: limited.tokenCount, toolName });
        return limited.content;
      }
    }
  }

  return result;
}

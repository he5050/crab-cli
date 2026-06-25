/**
 * 工具调用循环 — 处理一轮工具调用的确认→执行→结果收集。
 *
 * 职责:
 *   - 工具权限确认流程
 *   - 工具执行(含拦截器)
 *   - 结果收集和格式化
 *   - 错误处理
 *
 * 模块功能:
 *   - executeToolCallRound: 执行工具调用循环
 *   - ToolCallRequest: 工具调用请求接口
 *   - ToolCallExecutionResult: 工具调用执行结果接口
 *   - ToolExecutor: 工具执行器接口
 *   - ToolCallLoopOptions: 工具调用循环选项接口
 *
 * 使用场景:
 *   - 对话中的工具调用处理
 *   - 批量工具执行
 *   - 工具权限管理
 *
 * 边界:
 *   1. 无状态设计，每次调用独立
 *   2. 依赖背压控制
 *   3. 需要权限系统支持
 *   4. 支持 YOLO 自动批准模式
 *
 * 流程:
 *   1. 接收工具调用请求列表
 *   2. 检查权限(非 YOLO 模式)
 *   3. 获取执行许可(背压控制)
 *   4. 执行工具调用
 *   5. 收集和格式化结果
 *   6. 返回执行结果
 */

import { acquireExecutionPermit } from "@/core/concurrency/backpressure";
import type { ToolCallInfo } from "@/conversation/types";
import { createLogger } from "@/core/logging/logger";

/**
 * 工具调用循环 — 处理一轮工具调用的确认→执行→结果收集。
 *
 * 职责:
 *   - 工具权限确认流程
 *   - 工具执行(含拦截器)
 *   - 结果收集和格式化
 *   - 错误处理
 *
 * 设计:
 *   ToolCallLoop 是无状态工具类，每次调用 execute() 传入工具调用列表和执行上下文，
 *   返回 ToolCallRoundResult。不维护内部状态。
 */

const log = createLogger("conversation:tool-loop");

/** 单个工具调用的执行请求 */
export interface ToolCallRequest {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

/** 单个工具调用的执行结果 */
export interface ToolCallExecutionResult {
  toolCallId: string;
  toolName: string;
  output: unknown;
  isError: boolean;
  /** 执行耗时(毫秒) */
  durationMs?: number;
}

/** 工具执行器接口(解耦具体实现) */
export interface ToolExecutor {
  /**
   * 执行单个工具调用。
   * @returns 工具执行结果
   */
  execute(request: ToolCallRequest): Promise<ToolCallExecutionResult>;
}

/** 工具调用循环选项 */
export interface ToolCallLoopOptions {
  /** 工具调用列表 */
  toolCalls: ToolCallRequest[];
  /** 工具执行器 */
  executor: ToolExecutor;
  /** 中止信号 */
  abortSignal?: AbortSignal;
  /** 是否跳过确认(YOLO 模式) */
  autoApprove?: boolean;
  /** 权限确认回调(返回 false 拒绝) */
  onConfirm?: (toolName: string, args: unknown) => Promise<boolean>;
  /** 工具调用开始回调 */
  onToolStart?: (toolName: string, callId: string, args: unknown) => void;
  /** 工具调用完成回调 */
  onToolComplete?: (result: ToolCallExecutionResult) => void;
  /** 工具调用被拒绝回调 */
  onToolRejected?: (toolName: string, callId: string) => void;
}

/**
 * 执行一轮工具调用。
 *
 * 流程:
 *   1. 遍历工具调用列表
 *   2. 检查中止信号
 *   3. 权限确认(autoApprove=true 时跳过)
 *   4. 执行工具
 *   5. 收集结果
 *
 * @returns 工具执行结果数组
 */
export async function executeToolCallRound(options: ToolCallLoopOptions): Promise<{
  results: ToolCallExecutionResult[];
  /** 是否被中止 */
  aborted: boolean;
}> {
  const {
    toolCalls,
    executor,
    abortSignal,
    autoApprove = false,
    onConfirm,
    onToolStart,
    onToolComplete,
    onToolRejected,
  } = options;

  const results: ToolCallExecutionResult[] = [];
  let aborted = false;

  for (const tc of toolCalls) {
    // 检查中止信号
    if (abortSignal?.aborted) {
      // 为剩余未执行的工具生成中止结果
      for (const remaining of toolCalls.slice(toolCalls.indexOf(tc))) {
        const abortResult: ToolCallExecutionResult = {
          isError: true,
          output: "工具执行被用户中止",
          toolCallId: remaining.toolCallId,
          toolName: remaining.toolName,
        };
        results.push(abortResult);
        onToolComplete?.(abortResult);
      }
      aborted = true;
      break;
    }

    // 权限确认
    if (!autoApprove && onConfirm) {
      const approved = await onConfirm(tc.toolName, tc.args);
      if (!approved) {
        log.debug(`工具被拒绝: ${tc.toolName}`);
        const rejectedResult: ToolCallExecutionResult = {
          isError: true,
          output: "权限被拒绝",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
        };
        results.push(rejectedResult);
        onToolRejected?.(tc.toolName, tc.toolCallId);
        onToolComplete?.(rejectedResult);
        continue;
      }
      // 竞态保护:确认返回后二次检查 abort signal
      if (abortSignal?.aborted) {
        log.debug(`确认后检测到中止，拒绝工具: ${tc.toolName}`);
        const abortResult: ToolCallExecutionResult = {
          isError: true,
          output: "工具执行被用户中止",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
        };
        results.push(abortResult);
        onToolRejected?.(tc.toolName, tc.toolCallId);
        onToolComplete?.(abortResult);
        continue;
      }
    }

    // 通知开始
    onToolStart?.(tc.toolName, tc.toolCallId, tc.args);

    // 执行工具

    // 背压控制:等待执行许可
    await acquireExecutionPermit();
    const startTime = Date.now();
    try {
      const result = await executor.execute(tc);
      result.durationMs = Date.now() - startTime;
      results.push(result);
      onToolComplete?.(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`工具执行异常: ${tc.toolName}: ${errorMsg}`);
      const errorResult: ToolCallExecutionResult = {
        durationMs: Date.now() - startTime,
        isError: true,
        output: { error: errorMsg },
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
      };
      results.push(errorResult);
      onToolComplete?.(errorResult);
    }
  }

  return { aborted, results };
}

/**
 * 将 ToolCallInfo[] 转换为 ToolCallRequest[]。
 */
export function toToolCallRequests(calls: ToolCallInfo[]): ToolCallRequest[] {
  return calls.map((call) => ({
    args: call.arguments,
    toolCallId: call.id,
    toolName: call.name,
  }));
}

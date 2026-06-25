/**
 * [Task 执行器]
 *
 * 职责:
 *   - 创建独立的 ConversationHandler 执行异步任务
 *   - 收集执行结果和 Token 使用量
 *   - 支持任务中止(AbortSignal)
 *   - 处理 Goal 自动续接逻辑
 *   - 记录任务执行耗时
 *
 * 模块功能:
 *   - executeTask: 执行单个异步任务
 *   - TaskExecutorOptions: 任务执行选项接口
 *   - TaskExecutorResult: 任务执行结果接口
 *
 * 使用场景:
 *   - TaskManager 调用执行后台任务
 *   - 需要独立会话隔离的异步操作
 *   - 支持 Goal 续接的长时间运行任务
 *
 * 边界:
 *   1. 每个任务创建独立的 ConversationHandler 实例
 *   2. Goal 自动续接最多 10 次
 *   3. 支持通过 AbortSignal 中止执行
 *   4. 不修改调用方的任何状态
 *
 * 流程:
 *   1. 创建 ConversationHandler 实例
 *   2. 发送初始提示词执行
 *   3. 检查是否需要 Goal 续接
 *   4. 循环续接直到完成或达到上限
 *   5. 收集结果并返回
 */

import type { AppConfigSchema } from "@/schema/config";
import { ConversationHandler, type ConversationResult } from "@/conversation";
import type { AsyncTask } from "../types";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("task:executor");
const GOAL_AUTO_CONTINUATION_INPUT = "[系统自动续接] 继续推进当前目标。";
const MAX_GOAL_CONTINUATIONS = 50;

/** 任务执行选项 */
export interface TaskExecutorOptions {
  /** 应用配置 */
  config: AppConfigSchema;
  /** 任务提示词 */
  prompt: string;
  /** 中止信号 */
  abortSignal?: AbortSignal;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 使用的模型 */
  model?: string;
  HandlerClass?: typeof ConversationHandler;
}

/** 任务执行结果 */
export interface TaskExecutorResult {
  /** 执行结果 */
  result: ConversationResult;
  /** 执行耗时(毫秒) */
  durationMs: number;
}

/**
 * 执行单个异步任务。
 *
 * 创建独立的 ConversationHandler，执行 prompt，收集结果。
 * 不修改调用方的任何状态。
 */
export async function executeTask(task: AsyncTask, options: TaskExecutorOptions): Promise<TaskExecutorResult> {
  const startTime = Date.now();

  log.info(`开始执行任务: ${task.id}`);

  const Handler = options.HandlerClass ?? ConversationHandler;

  let handler: InstanceType<typeof Handler>;
  try {
    handler = new Handler(options.config, {
      abortSignal: options.abortSignal,
      maxToolRounds: 50,
      sessionId: task.sessionId ?? task.id,
      systemPrompt: options.systemPrompt,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;
    log.error(`任务 ${task.id} Handler 构造失败: ${errMsg}`);
    return {
      durationMs,
      result: { error: errMsg, goalContinuation: false, ok: false },
    };
  }

  try {
    let result = await handler.sendMessage(options.prompt);
    let continuationCount = 0;

    while (result.ok && result.goalContinuation && continuationCount < MAX_GOAL_CONTINUATIONS) {
      continuationCount++;
      log.info(`任务 ${task.id} 触发 Goal 自动续接 #${continuationCount}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      result = await handler.sendMessage(GOAL_AUTO_CONTINUATION_INPUT);
    }

    if (result.goalContinuation && continuationCount >= MAX_GOAL_CONTINUATIONS) {
      log.warn(`任务 ${task.id} 达到 Goal 自动续接安全上限 (${MAX_GOAL_CONTINUATIONS})`);
    }

    const durationMs = Date.now() - startTime;

    log.info(`任务执行完成: ${task.id}, ok=${result.ok}, duration=${durationMs}ms`);

    return { durationMs, result };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;

    log.error(`任务执行失败: ${task.id}: ${errMsg}`);

    return {
      durationMs,
      result: {
        error: errMsg,
        ok: false,
        text: "",
        toolRounds: 0,
      },
    };
  }
}

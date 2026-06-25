/**
 * 工具执行超时辅助模块
 *
 * 职责:
 *   - 提供 per-tool timeoutMs 强制执行能力
 *   - 与 ToolContext.abortSignal 协同，触发下游可观察的中止
 *   - 发布超时事件到 EventBus，便于可观测性
 *
 * 模块功能:
 *   - runWithTimeout: 包装工具 execute，强制执行 timeoutMs
 *   - 抛出结构化 ToolTimeoutError(name/code/toolName/timeoutMs)
 *
 * 使用场景:
 *   - 工具声明了 timeoutMs 时，由 ToolExecutor 调用
 *   - 需要在超时触发时联动 abortSignal 的工具(如 Bun.spawn)
 *
 * 边界:
 *   1. 纯辅助函数，不感知 ToolExecutor 的权限/审计/截断
 *   2. timeoutMs <= 0 或 undefined 时直接透传 execute(无 race)
 *   3. 始终清理 setTimeout，避免定时器泄漏
 *   4. 超时时同步触发 ctx.abortSignal(若存在)，便于子操作响应
 *
 * 流程:
 *   1. 检查 timeoutMs；无效则直接 await execute
 *   2. 创建本地 AbortController 并桥接 ctx.abortSignal
 *   3. Promise.race(execute, timeout-timer)
 *   4. 任意一边结算后清理 timer 与 abort 监听
 *   5. 超时分支:构造 ToolTimeoutError，abort 控制器，发布事件，rethrow
 */
import { type ToolContext, ToolTimeoutError } from "../types";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:timeout");

/**
 * 在 per-tool 超时窗口内执行工具。
 *
 * @param tool - 工具定义
 * @param args - 已通过 Zod 验证的参数
 * @param ctx - 工具执行上下文(可选)
 * @returns 工具 execute 的返回值
 * @throws {ToolTimeoutError} 当执行超过 tool.timeoutMs 时
 */
export async function runWithTimeout<
  T extends { execute: (...args: any[]) => Promise<unknown>; name: string; timeoutMs?: number },
>(tool: T, args: Parameters<T["execute"]>[0], ctx?: ToolContext): Promise<unknown> {
  const { timeoutMs } = tool;
  // 无效 timeoutMs:直接执行，不做 race(保持原有行为)
  if (!timeoutMs || timeoutMs <= 0) {
    return await tool.execute(args, ctx);
  }

  // 创建本地 AbortController，用于:
  //  1. 桥接外部 ctx.abortSignal
  //  2. 在超时触发时主动 abort，便于下游工具(如 Bun.spawn with signal)响应
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(ctx?.abortSignal?.reason);
  if (ctx?.abortSignal) {
    if (ctx.abortSignal.aborted) {
      controller.abort(ctx.abortSignal.reason);
    } else {
      ctx.abortSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  // 把 controller.signal 透传给 execute:构造一个新的 ctx 合并 signal
  const childCtx: ToolContext | undefined = ctx ? { ...ctx, abortSignal: controller.signal } : ctx;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    return await new Promise<unknown>((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        const err = new ToolTimeoutError(tool.name, timeoutMs, `Tool "${tool.name}" timed out after ${timeoutMs}ms`);
        // 触发本地 AbortController，让下游能响应
        try {
          controller.abort(err);
        } catch {
          // Ignore — abort 失败不应阻止 timeout 错误冒泡
        }
        log.warn(`工具执行超时`, { timeoutMs, toolName: tool.name });
        // 事件发布:best-effort，发布失败不阻塞主流程
        try {
          globalBus.publish(AppEvent.ToolTimeout, {
            messageId: ctx?.messageId,
            sessionId: ctx?.sessionId,
            timeoutMs,
            toolName: tool.name,
          });
        } catch (error) {
          log.debug(`发布 ToolTimeout 事件失败`, { error: (error as Error).message });
        }
        reject(err);
      }, timeoutMs);

      Promise.resolve()
        .then(() => tool.execute(args, childCtx))
        .then(
          (value) => {
            if (timedOut) {
              return;
            } // 超时已先结算；忽略迟到的成功
            resolve(value);
          },
          (error) => {
            if (timedOut) {
              return;
            } // 超时已先结算；忽略迟到的失败
            reject(error);
          },
        );
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (ctx?.abortSignal) {
      try {
        ctx.abortSignal.removeEventListener("abort", onExternalAbort);
      } catch {
        // Ignore
      }
    }
  }
}

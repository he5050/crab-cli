/**
 * [StatusLine Hook 模块]
 *
 * 职责:
 *   - 执行 StatusLine Hook 获取自定义状态内容
 *   - 格式化状态栏显示
 *   - 支持动态更新状态栏
 *
 * 模块功能:
 *   - StatusLineSegment: 状态栏段接口定义
 *   - StatusLineHookResult: 状态栏 Hook 结果接口
 *   - executeStatusLineHooks: 执行状态栏 Hook 获取内容
 *   - formatStatusLine: 格式化状态栏内容
 *   - getDefaultStatusLine: 获取默认状态栏内容
 *
 * 使用场景:
 *   - 自定义状态栏显示内容
 *   - 动态显示会话信息、模式状态等
 *   - 通过 Shell 或 Builtin Hook 扩展状态栏
 *
 * 边界:
 *   1. 仅处理 Notification 事件的 Hook
 *   2. 支持 JSON 格式输出和普通文本输出
 *   3. 按优先级排序显示状态栏段
 *   4. 单个 Hook 失败不影响其他 Hook 执行
 *
 * 流程:
 *   1. 从注册表获取 Notification 事件的 Hook
 *   2. 依次执行每个 Hook(Shell 或 Builtin 类型)
 *   3. 解析 Hook 输出为状态栏段
 *   4. 按优先级排序并返回结果
 */
import { createLogger } from "@/core/logging/logger";
import { hookRegistry } from "@/hooks/hookRegistry";
import { executeShellHook } from "@/hooks/shellHook";
import type { HookContext, HookDecision } from "@/hooks/types";

const log = createLogger("hooks:statusline");

/** 状态栏段 */
export interface StatusLineSegment {
  /** 显示文本 */
  text: string;
  /** 样式(颜色等) */
  style?: "default" | "success" | "warning" | "error" | "info";
  /** 优先级(数字越小越靠左) */
  priority?: number;
}

/** 状态栏 Hook 结果 */
export interface StatusLineHookResult {
  /** 是否成功 */
  success: boolean;
  /** 状态栏段列表 */
  segments: StatusLineSegment[];
  /** 错误信息 */
  error?: string;
}

/**
 * 执行 StatusLine Hook 获取自定义状态内容。
 *
 * @param sessionId - 当前会话 ID
 * @param context - 额外上下文信息
 * @returns 状态栏 Hook 结果
 */
export async function executeStatusLineHooks(
  sessionId?: string,
  context?: Record<string, unknown>,
): Promise<StatusLineHookResult> {
  const hookContext: HookContext = { event: "Notification", sessionId, ...context };
  const hooks = hookRegistry.getByEvent("Notification", hookContext);

  if (hooks.length === 0) {
    return { segments: [], success: true };
  }

  const segments: StatusLineSegment[] = [];
  let hasError = false;

  for (const hook of hooks) {
    try {
      let decision: HookDecision;
      let output: string | undefined;

      if (hook.type === "shell" && hook.command) {
        const ctx: HookContext = {
          event: "Notification",
          sessionId,
          ...context,
        };
        const shellResult = await executeShellHook(hook, ctx);
        decision = shellResult.decision;
        output = shellResult.output;
      } else if (hook.type === "builtin" && hook.handler) {
        const ctx: HookContext = {
          event: "Notification",
          sessionId,
          ...context,
        };
        decision = await hook.handler(ctx);
      } else {
        continue;
      }

      // 解析输出为状态栏段
      if (output) {
        try {
          // 尝试解析 JSON 格式
          const parsed = JSON.parse(output);
          if (Array.isArray(parsed.segments)) {
            segments.push(...parsed.segments);
          } else if (parsed.text) {
            segments.push({
              priority: parsed.priority ?? 100,
              style: parsed.style || "default",
              text: parsed.text,
            });
          }
        } catch {
          // 非 JSON，直接使用文本
          segments.push({
            priority: 100,
            style: "default",
            text: output.trim(),
          });
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn(`StatusLine Hook 执行失败: ${hook.name}: ${msg}`);
      hasError = true;
    }
  }

  // 按优先级排序
  segments.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  return {
    error: hasError ? "部分 Hook 执行失败" : undefined,
    segments,
    success: !hasError,
  };
}

/**
 * 格式化状态栏内容。
 *
 * @param segments - 状态栏段列表
 * @param maxLength - 最大长度
 * @returns 格式化后的状态栏字符串
 */
export function formatStatusLine(segments: StatusLineSegment[], maxLength = 200): string {
  if (segments.length === 0) {
    return "";
  }

  const parts = segments.map((s) => s.text);
  let result = parts.join(" | ");

  if (result.length > maxLength) {
    result = `${result.slice(0, maxLength - 3)}...`;
  }

  return result;
}

/**
 * 获取默认状态栏内容(无 Hook 时)。
 *
 * @param sessionId - 会话 ID
 * @param mode - 当前模式
 * @returns 默认状态栏段
 */
export function getDefaultStatusLine(sessionId?: string, mode?: string): StatusLineSegment[] {
  const segments: StatusLineSegment[] = [];

  if (mode) {
    segments.push({
      priority: 10,
      style: "info",
      text: `Mode: ${mode}`,
    });
  }

  if (sessionId) {
    const shortId = sessionId.slice(-8);
    segments.push({
      priority: 20,
      style: "default",
      text: `Session: ${shortId}`,
    });
  }

  return segments;
}

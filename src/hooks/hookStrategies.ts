/**
 * [Hook 策略]
 *
 * 职责:
 *   - 按 Hook 事件类型解释执行结果
 *   - 根据 exitCode 决定后续行为
 *   - 提供统一的结果解释接口
 *
 * 模块功能:
 *   - InterpretedHookResult: 解释后的结果接口
 *   - HookStrategy: 策略接口定义
 *   - hookStrategies: 所有事件类型的策略映射
 *   - interpretHookResult: 统一的结果解释入口
 *   - 各事件类型的策略实现(PreToolUse, PostToolUse, UserMessage 等)
 *
 * 使用场景:
 *   - Hook 执行后需要解释结果决定后续行为
 *   - 根据 exitCode 判断是继续、阻止还是替换
 *   - 处理 Hook 失败或警告情况
 *
 * 边界:
 *   1. 每种 Hook 事件类型有独立策略
 *   2. exitCode 语义:0=成功，1=警告/替换，>=2=错误/阻止
 *   3. 根据 decision.action 推断 exitCode
 *   4. SubAgentStop 和 Stop 支持消息注入
 *
 * 流程:
 *   1. 获取 Hook 执行结果列表
 *   2. 根据事件类型选择对应策略
 *   3. 策略解释结果返回 action(continue/block/replace/warn)
 *   4. 根据 action 决定后续流程
 */

import type { HookDecision, HookEvent, HookResult, HookActionResult, AnyHookResult } from "@/hooks/types";

/** 扩展 Hook 结果类型，带 hookName */
interface HookResultWithHookName extends HookResult {
  hookName: string;
}

/** 策略解释后的结构化结果 */
export interface InterpretedHookResult {
  action: "continue" | "block" | "replace" | "warn";
  replacedContent?: string;
  errorDetails?: {
    type: "warning" | "error";
    exitCode: number;
    command: string;
    output?: string;
    error?: string;
  };
  hookFailed?: boolean;
  warningMessage?: string;
  shouldContinueConversation?: boolean;
  injectedMessages?: { role: "user" | "assistant"; content: string }[];
}

/** 策略接口 */
export interface HookStrategy {
  interpret(results: Array<HookResult | HookActionResult>, originalContent?: string): InterpretedHookResult;
}

/** 查找第一个失败的 Hook */
function findFirstFailed(results: Array<AnyHookResult>): AnyHookResult | null {
  return results.find((r) => !r.success) ?? null;
}

/** 类型守卫: 判断是否为完整 HookResult（带 decision） */
function isHookResult(result: AnyHookResult): result is HookResult {
  return "decision" in result;
}

/** 从 AnyHookResult 安全提取 output（仅 HookResult 和 CommandHookResult 有此字段） */
function getOutput(result: AnyHookResult): string | undefined {
  if ("output" in result) {
    return result.output as string | undefined;
  }
  return undefined;
}

/** 构建错误详情 */
function buildErrorDetails(result: AnyHookResult): InterpretedHookResult["errorDetails"] {
  if ("hookName" in result) {
    const hookResult = result as HookResult;
    return {
      command: hookResult.hookName,
      error: hookResult.error,
      exitCode: 0,
      output: hookResult.output,
      type: "error",
    };
  }
  const actionResult = result as HookActionResult;
  if (actionResult.type === "command") {
    return {
      command: actionResult.command,
      error: actionResult.error,
      exitCode: actionResult.exitCode,
      output: actionResult.output,
      type: "error",
    };
  }
  // PromptHookResult
  return {
    command: "prompt",
    error: actionResult.error,
    exitCode: 0,
    output: actionResult.response?.message,
    type: "error",
  };
}

/** 从 HookDecision 或 HookActionResult 提取 exitCode 语义 */
function extractExitCode(result: AnyHookResult): number {
  if ("decision" in result) {
    const hookResult = result as HookResult;
    if (hookResult.decision.action === "block") {
      return 2;
    }
    if (hookResult.decision.action === "replace") {
      return 1;
    }
    return 0;
  }
  if (result.type === "command") {
    if (result.success && result.exitCode === 0) {
      return 0;
    }
    if (!result.success) {
      return result.exitCode >= 2 ? 2 : 1;
    }
    return result.exitCode;
  }
  return result.success ? 0 : 2;
}

// ── 策略实现 ─────────────────────────────────────────────────────

/** PreToolUse 策略 */
const preToolUseStrategy: HookStrategy = {
  interpret(results) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    const exitCode = extractExitCode(error);
    if (exitCode === 1) {
      return {
        action: "block",
        replacedContent:
          error.error || getOutput(error) || `[beforeToolCall Hook Warning] ${(error as HookResult).hookName}`,
      };
    }
    if (exitCode >= 2) {
      return {
        action: "block",
        errorDetails: buildErrorDetails(error),
        hookFailed: true,
      };
    }
    return { action: "continue" };
  },
};

/** PostToolUse 策略 */
const postToolUseStrategy: HookStrategy = {
  interpret(results) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    const exitCode = extractExitCode(error);
    if (exitCode === 1) {
      return {
        action: "replace",
        replacedContent:
          error.error ||
          (error as HookResult).output ||
          `[afterToolCall Hook Warning] ${(error as HookResult).hookName}`,
      };
    }
    if (exitCode >= 2) {
      return {
        action: "block",
        errorDetails: buildErrorDetails(error),
        hookFailed: true,
      };
    }
    return { action: "continue" };
  },
};

/** UserMessage 策略 */
const userMessageStrategy: HookStrategy = {
  interpret(results, originalContent) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    const exitCode = extractExitCode(error);
    if (exitCode === 1) {
      return {
        action: "replace",
        replacedContent: error.error || getOutput(error) || originalContent || "",
      };
    }
    if (exitCode >= 2) {
      return {
        action: "block",
        errorDetails: buildErrorDetails(error),
      };
    }
    return { action: "continue" };
  },
};

/** ToolConfirmation 策略 */
const toolConfirmationStrategy: HookStrategy = {
  interpret(results) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    const exitCode = extractExitCode(error);
    if (exitCode === 1) {
      const combinedOutput = [(error as HookResult).output, error.error].filter(Boolean).join("\n\n") || "(no output)";
      return {
        action: "warn",
        warningMessage: `[Hook Warning] toolConfirmation:\n${(error as HookResult).hookName}\nOutput: ${combinedOutput}`,
      };
    }
    if (exitCode >= 2) {
      return {
        action: "block",
        errorDetails: buildErrorDetails(error),
      };
    }
    return { action: "continue" };
  },
};

/** Compress 策略 */
const compressStrategy: HookStrategy = {
  interpret(results) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    const exitCode = extractExitCode(error);
    if (exitCode === 1) {
      const combinedOutput = [(error as HookResult).output, error.error].filter(Boolean).join("\n\n") || "(no output)";
      return {
        action: "warn",
        warningMessage: `[WARN] beforeCompress hook warning:\n${combinedOutput}`,
      };
    }
    if (exitCode >= 2) {
      return {
        action: "block",
        errorDetails: buildErrorDetails(error),
        hookFailed: true,
      };
    }
    return { action: "continue" };
  },
};

/** SessionStart 策略 */
const sessionStartStrategy: HookStrategy = {
  interpret(results) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    const exitCode = extractExitCode(error);
    const combinedOutput = [getOutput(error), error.error].filter(Boolean).join("\n\n") || "(no output)";

    if (exitCode === 1) {
      return {
        action: "warn",
        warningMessage: `[WARN] onSessionStart hook warning:\n${(error as HookResult).hookName}\n${combinedOutput}`,
      };
    }
    if (exitCode >= 2) {
      return {
        action: "block",
        errorDetails: buildErrorDetails(error),
      };
    }
    return { action: "continue" };
  },
};

/** SubAgentStop 策略 */
const subAgentStopStrategy: HookStrategy = {
  interpret(results) {
    if (!results || results.length === 0) {
      return { action: "continue" };
    }

    const injectedMessages: { role: "user" | "assistant"; content: string }[] = [];
    let shouldContinue = false;

    for (const result of results) {
      if (!result.success) {
        const exitCode = extractExitCode(result);
        if (exitCode >= 2) {
          injectedMessages.push({
            content: result.error || (result as HookResult).output || "未知错误",
            role: "user",
          });
          shouldContinue = true;
        }
      } else if (isHookResult(result) && result.decision.action === "inject") {
        const inject = result.decision as { action: "inject"; message: string; shouldContinueConversation?: boolean };
        injectedMessages.push({
          content: inject.message,
          role: "user",
        });
        if (inject.shouldContinueConversation) {
          shouldContinue = true;
        }
      }
    }

    if (shouldContinue || injectedMessages.length > 0) {
      return {
        action: "continue",
        injectedMessages,
        shouldContinueConversation: shouldContinue,
      };
    }
    return { action: "continue" };
  },
};

/** Stop 策略 */
const stopStrategy: HookStrategy = {
  interpret(results) {
    if (!results || results.length === 0) {
      return { action: "continue" };
    }

    const injectedMessages: { role: "user" | "assistant"; content: string }[] = [];
    let shouldContinue = false;

    for (const result of results) {
      if (!result.success) {
        const exitCode = extractExitCode(result);
        if (exitCode === 1) {
          // 警告，继续
        } else if (exitCode >= 2) {
          injectedMessages.push({
            content: result.error || (result as HookResult).output || "未知错误",
            role: "user",
          });
          shouldContinue = true;
        }
      } else if (isHookResult(result) && result.decision.action === "inject") {
        const inject = result.decision as { action: "inject"; message: string; shouldContinueConversation?: boolean };
        injectedMessages.push({
          content: inject.message,
          role: "user",
        });
        if (inject.shouldContinueConversation) {
          shouldContinue = true;
        }
      }
    }

    if (shouldContinue || injectedMessages.length > 0) {
      return {
        action: "continue",
        injectedMessages,
        shouldContinueConversation: shouldContinue,
      };
    }
    return { action: "continue" };
  },
};

/** 通知策略(默认行为:警告继续) */
const notificationStrategy: HookStrategy = {
  interpret(results) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    return {
      action: "warn",
      warningMessage: error.error || getOutput(error) || "Hook warning",
    };
  },
};

/** SkillExecute 策略 */
const skillExecuteStrategy: HookStrategy = {
  interpret(results) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    const exitCode = extractExitCode(error);
    if (exitCode >= 2) {
      return {
        action: "block",
        errorDetails: buildErrorDetails(error),
        hookFailed: true,
      };
    }
    return { action: "warn", warningMessage: error.error || (error as HookResult).output || "Hook warning" };
  },
};

/** SessionEnd 策略(默认行为) */
const sessionEndStrategy: HookStrategy = {
  interpret(results) {
    // 会话结束时的 Hook 只做通知，不影响流程
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    return {
      action: "warn",
      warningMessage: error.error || (error as HookResult).output || "SessionEnd hook warning",
    };
  },
};

/** OnError 策略 — 错误发生时触发，仅通知不阻止 */
const onErrorStrategy: HookStrategy = {
  interpret(results) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    const exitCode = extractExitCode(error);
    if (exitCode >= 2) {
      return {
        action: "warn",
        warningMessage: `[Hook Error] onError hook failed: ${error.error || getOutput(error) || "unknown"}`,
      };
    }
    return { action: "continue" };
  },
};

/** SubAgentStart 策略 */
const subAgentStartStrategy: HookStrategy = {
  interpret(results) {
    const error = findFirstFailed(results);
    if (!error) {
      return { action: "continue" };
    }

    const exitCode = extractExitCode(error);
    if (exitCode >= 2) {
      return {
        action: "block",
        errorDetails: buildErrorDetails(error),
        hookFailed: true,
      };
    }
    return { action: "continue" };
  },
};

// ── 策略映射 ──────────────────────────────────────────────────────

/** 所有 Hook 事件的策略映射 */
export const hookStrategies: Record<HookEvent, HookStrategy> = {
  Compress: compressStrategy,
  Notification: notificationStrategy,
  OnError: onErrorStrategy,
  PostToolUse: postToolUseStrategy,
  PreToolUse: preToolUseStrategy,
  SessionEnd: sessionEndStrategy,
  SessionStart: sessionStartStrategy,
  SkillExecute: skillExecuteStrategy,
  Stop: stopStrategy,
  SubAgentStart: subAgentStartStrategy,
  SubAgentStop: subAgentStopStrategy,
  ToolConfirmation: toolConfirmationStrategy,
  UserMessage: userMessageStrategy,
};

/** 统一的 Hook 结果解释入口。
 * 根据 hookEvent 选择对应的策略来解释执行结果。
 * 支持 HookResult（完整，带 decision）和 HookActionResult（轻量，来自 UnifiedHooksExecutor）。
 */
export function interpretHookResult(
  hookEvent: HookEvent,
  results: Array<HookResult | HookActionResult>,
  originalContent?: string,
): InterpretedHookResult {
  const hasInject = results.some((r) => {
    if ("decision" in r) {
      return r.success && r.decision.action === "inject";
    }
    return false;
  });
  if (results.every((r) => r.success) && !hasInject) {
    return { action: "continue" };
  }

  const strategy = hookStrategies[hookEvent];
  return strategy.interpret(results as HookResult[], originalContent);
}

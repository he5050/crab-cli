/**
 * Hook 执行器 — 统一执行所有 Hook，记录结果，发布事件。
 *
 * 职责:
 *   - 按优先级执行匹配的 Hook
 *   - 处理 Hook 决策(pass/block/replace)
 *   - 记录执行日志
 *   - 发布 HookExecuted 事件到 EventBus
 *   - 错误容错(Hook 失败不阻塞主流程)
 *
 * 模块功能:
 *   - HookExecutor: Hook 执行器类
 *   - execute: 执行指定事件的所有 Hook
 *   - executeOne: 执行单个 Hook
 *   - getExecutionLog: 获取执行日志
 *   - clearLog: 清空执行日志
 *
 * 使用场景:
 *   - 工具调用前后执行 Hook
 *   - 会话开始/结束时执行 Hook
 *   - 错误发生时执行 Hook(OnError)
 *   - 子代理启动/停止时执行 Hook
 *   - 用户消息处理时执行 Hook
 *
 * 边界:
 *   1. 按优先级顺序执行 Hook
 *   2. PreToolUse 事件被 block 时停止后续 Hook
 *   3. Hook 失败不阻塞主流程
 *   4. 执行日志最多保留 200 条
 *
 * 流程:
 *   1. 从注册表获取匹配的 Hook 列表
 *   2. 按优先级排序
 *   3. 依次执行每个 Hook
 *   4. 记录执行结果到日志
 *   5. 发布 HookExecuted 事件
 *   6. 检查是否需要停止后续 Hook
 */
import { createLogger } from "@/core/logging/logger";
import { hookRegistry } from "@/hooks/hookRegistry";
import { executeShellHook } from "@/hooks/shellHook";
import type { HookContext, HookDecision, HookDefinition, HookEvent, HookResult } from "@/hooks/types";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";

const log = createLogger("hooks:executor");

/** Hook 执行器(全局单例) */
export class HookExecutor {
  /** 执行日志(最近 200 条) */
  private executionLog: HookResult[] = [];
  private maxLogSize = 200;

  /**
   * 执行指定事件的所有 Hook。
   *
   * 返回所有 Hook 的执行结果。
   * 对于 PreToolUse 事件，如果有 Hook 返回 block，则后续 Hook 不再执行。
   */
  async execute(event: HookEvent, context: Partial<HookContext>): Promise<HookResult[]> {
    const fullContext: HookContext = {
      event,
      ...context,
    };

    const hooks = hookRegistry.getByEvent(event, fullContext);
    if (hooks.length === 0) {
      return [];
    }

    log.debug(`执行 ${hooks.length} 个 Hook [${event}]`);
    const results: HookResult[] = [];

    for (const hook of hooks) {
      const result = await this.executeOne(hook, fullContext);
      results.push(result);
      this.addToLog(result);

      // 发布 Hook 执行事件
      globalBus.publish(AppEvent.HookExecuted, {
        decision: result.decision.action,
        duration: result.duration,
        error: result.error,
        event: result.event,
        hookId: result.hookId,
        hookName: result.hookName,
        success: result.success,
      });

      // PreToolUse: 如果被阻止，停止后续 Hook
      if (event === "PreToolUse" && result.decision.action === "block") {
        log.info(`Hook ${hook.name} 阻止了工具调用: ${result.decision.reason ?? "未提供原因"}`);
        break;
      }
    }

    return results;
  }

  /**
   * 执行单个 Hook。
   */
  private async executeOne(hook: HookDefinition, context: HookContext): Promise<HookResult> {
    const start = Date.now();

    try {
      let decision: HookDecision;
      let output: string | undefined;
      let error: string | undefined;

      if (hook.type === "shell" && hook.command) {
        const shellResult = await executeShellHook(hook, context);
        decision = shellResult.decision;
        output = shellResult.output;
        error = shellResult.error;
      } else if (hook.type === "builtin" && hook.handler) {
        decision = await hook.handler(context);
      } else {
        decision = { action: "pass" };
        error = `Hook 类型未识别或缺少执行体: ${hook.type}`;
      }

      const duration = Date.now() - start;

      return {
        decision,
        duration,
        error,
        event: context.event,
        hookId: hook.id,
        hookName: hook.name,
        output,
        success: !error,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const duration = Date.now() - start;
      log.error(`Hook 执行异常: ${hook.name}: ${msg}`);

      return {
        decision: { action: "pass" },
        duration,
        error: msg,
        event: context.event,
        hookId: hook.id,
        hookName: hook.name,
        success: false,
      };
    }
  }

  /**
   * 快捷方法:执行 PreToolUse Hook。
   * 返回 true 表示放行，false 表示被阻止。
   */
  async preToolUse(
    toolName: string,
    args?: unknown,
    callId?: string,
  ): Promise<{ allowed: boolean; reason?: string; results: HookResult[] }> {
    const results = await this.execute("PreToolUse", { toolArgs: args, toolCallId: callId, toolName });

    for (const result of results) {
      if (result.decision.action === "block") {
        return { allowed: false, reason: result.decision.reason, results };
      }
    }

    return { allowed: true, results };
  }

  /**
   * 快捷方法:执行 PostToolUse Hook。
   */
  async postToolUse(
    toolName: string,
    result?: unknown,
    isError?: boolean,
    callId?: string,
  ): Promise<{ replaced?: unknown; results: HookResult[] }> {
    const hookResults = await this.execute("PostToolUse", {
      isError,
      toolCallId: callId,
      toolName,
      toolResult: result,
    });

    // 检查是否有 Hook 替换了结果
    for (const hr of hookResults) {
      if (hr.decision.action === "replace") {
        return { replaced: hr.decision.output, results: hookResults };
      }
    }

    return { results: hookResults };
  }

  /**
   * 快捷方法:执行 SessionStart Hook。
   */
  async sessionStart(sessionId: string): Promise<HookResult[]> {
    return this.execute("SessionStart", { sessionId });
  }

  /**
   * 快捷方法:执行 SessionEnd Hook。
   */
  async sessionEnd(sessionId: string): Promise<HookResult[]> {
    return this.execute("SessionEnd", { sessionId });
  }

  /**
   * 快捷方法:执行 Notification Hook。
   */
  async notification(message: string, sessionId?: string): Promise<HookResult[]> {
    return this.execute("Notification", { message, sessionId });
  }

  /**
   * 快捷方法:执行 Stop Hook。
   */
  async stop(sessionId: string): Promise<HookResult[]> {
    return this.execute("Stop", { sessionId });
  }

  /**
   * 快捷方法:执行 SubAgentStart Hook。
   */
  async subAgentStart(agentId: string, agentName: string, parentAgent?: string): Promise<HookResult[]> {
    return this.execute("SubAgentStart", { agentId, agentName, sessionId: parentAgent });
  }

  /**
   * 快捷方法:执行 SubAgentStop Hook。
   */
  async subAgentStop(
    agentId: string,
    agentName: string,
    success: boolean,
    parentAgent?: string,
  ): Promise<HookResult[]> {
    return this.execute("SubAgentStop", { agentId, agentName, isError: !success, sessionId: parentAgent });
  }

  /**
   * 快捷方法:执行 UserMessage Hook。
   */
  async userMessage(content: string, sessionId?: string): Promise<HookResult[]> {
    return this.execute("UserMessage", { message: content, sessionId });
  }

  /**
   * 快捷方法:执行 ToolConfirmation Hook。
   */
  async toolConfirmation(
    toolName: string,
    args?: unknown,
    sessionId?: string,
  ): Promise<{ allowed: boolean; reason?: string; results: HookResult[] }> {
    const results = await this.execute("ToolConfirmation", { sessionId, toolArgs: args, toolName });
    for (const result of results) {
      if (result.decision.action === "block") {
        return { allowed: false, reason: result.decision.reason, results };
      }
    }
    return { allowed: true, results };
  }

  /**
   * 快捷方法:执行 Compress Hook。
   */
  async compress(sessionId: string, phase: "before" | "after", tokenCount?: number): Promise<HookResult[]> {
    return this.execute("Compress", { message: phase, sessionId, toolResult: { tokenCount } });
  }

  /**
   * 快捷方法:执行 OnError Hook。
   * 在工具执行错误、API 调用失败等场景触发。
   */
  async onError(
    error: Error | string,
    context?: { toolName?: string; sessionId?: string; toolArgs?: unknown; toolResult?: unknown },
  ): Promise<HookResult[]> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return this.execute("OnError", {
      event: "OnError",
      isError: true,
      message: errorMsg,
      sessionId: context?.sessionId,
      toolArgs: context?.toolArgs,
      toolName: context?.toolName,
      toolResult: context?.toolResult ?? { error: errorMsg },
    });
  }

  /**
   * 快捷方法:执行 SkillExecute Hook(Skill 执行前后)。
   * 返回 true 表示放行，false 表示被阻止。
   */
  async skillExecute(
    skillName: string,
    params?: Record<string, unknown>,
  ): Promise<{ allowed: boolean; reason?: string; results: HookResult[] }> {
    const results = await this.execute("SkillExecute", {
      toolArgs: { params, skillName },
      toolName: "skill",
    });
    for (const result of results) {
      if (result.decision.action === "block") {
        return { allowed: false, reason: result.decision.reason, results };
      }
    }
    return { allowed: true, results };
  }

  /**
   * 获取执行日志。
   */
  getLog(limit?: number): HookResult[] {
    if (limit) {
      return this.executionLog.slice(-limit);
    }
    return [...this.executionLog];
  }

  /**
   * 清空执行日志。
   */
  clearLog(): void {
    this.executionLog = [];
  }

  /** 添加到日志(保留最近 N 条) */
  private addToLog(result: HookResult): void {
    this.executionLog.push(result);
    if (this.executionLog.length > this.maxLogSize) {
      this.executionLog = this.executionLog.slice(-this.maxLogSize);
    }
  }
}

/** 全局 Hook 执行器实例 */
export const hookExecutor = new HookExecutor();

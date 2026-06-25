/**
 * Token 预算控制器 — 跟踪和限制 LLM Token 使用。
 *
 * 职责:
 *   - 跟踪每次调用的 Token 使用量（输入 + 输出）
 *   - 支持多层级预算（全局、会话、请求）
 *   - 预算耗尽时触发回调
 *   - 提供剩余预算查询
 *
 * 使用场景:
 *   - 限制单次对话的 Token 消耗
 *   - 多轮对话的累计预算控制
 *   - 预算预警（剩余 20% 时通知）
 *   - 强制截断（预算耗尽时拒绝新请求）
 */

import { createLogger } from "@/core/logging/logger";
import type { LlmStreamEvent } from "../core/llm";
import type { TokenUsage } from "@/session/types";

const log = createLogger("tokenBudget");

export interface TokenBudgetOptions {
  /** 总预算上限 */
  limit: number;
  /** 预警阈值（0-1），默认 0.2 表示剩余 20% 时预警 */
  warningThreshold?: number;
  /** 预算耗尽回调 */
  onExhausted?: () => void;
  /** 预警回调 */
  onWarning?: (remaining: number) => void;
}

export interface BudgetState {
  used: number;
  limit: number;
  remaining: number;
  utilization: number;
  exhausted: boolean;
  warned: boolean;
}

export class TokenBudgetController {
  private used = 0;
  private limit: number;
  private warningThreshold: number;
  private onExhausted?: () => void;
  private onWarning?: (remaining: number) => void;
  private exhaustedFlag = false;
  private warnedFlag = false;
  private readonly scope: string;

  constructor(scope: string, options: TokenBudgetOptions) {
    this.scope = scope;

    // 边界条件：参数验证
    if (options.limit <= 0) {
      throw new Error(`TokenBudget [${scope}]: limit 必须为正数，收到 ${options.limit}`);
    }
    if ((options.warningThreshold ?? 0) < 0 || (options.warningThreshold ?? 1) > 1) {
      throw new Error(
        `TokenBudget [${scope}]: warningThreshold 必须在 [0, 1] 范围内，收到 ${options.warningThreshold}`,
      );
    }

    this.limit = options.limit;
    this.warningThreshold = options.warningThreshold ?? 0.2;
    this.onExhausted = options.onExhausted;
    this.onWarning = options.onWarning;
  }

  /**
   * 记录一次 Token 使用。
   */
  record(usage: TokenUsage): void {
    if (this.exhaustedFlag) {
      return;
    }

    // 边界条件：防止负值和溢出
    const tokensToAdd = Math.max(0, (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));

    // 防止整数溢出（JavaScript Number 安全范围）
    const MAX_SAFE_VALUE = Number.MAX_SAFE_INTEGER - 1000000; // 预留缓冲
    if (this.used > MAX_SAFE_VALUE || tokensToAdd > MAX_SAFE_VALUE) {
      log.warn(`TokenBudget [${this.scope}]: Token 计数接近溢出，当前=${this.used}, 新增=${tokensToAdd}`);
      this.exhaustedFlag = true;
      this.onExhausted?.();
      return;
    }

    this.used += tokensToAdd;

    if (!this.warnedFlag && this.getRemainingRatio() <= this.warningThreshold) {
      this.warnedFlag = true;
      this.onWarning?.(this.getRemaining());
    }

    if (!this.exhaustedFlag && this.used >= this.limit) {
      this.exhaustedFlag = true;
      this.onExhausted?.();
    }
  }

  /**
   * 获取当前预算状态。
   */
  getState(): BudgetState {
    return {
      used: this.used,
      limit: this.limit,
      remaining: this.getRemaining(),
      utilization: this.getUtilization(),
      exhausted: this.exhaustedFlag,
      warned: this.warnedFlag,
    };
  }

  /**
   * 检查是否可以继续分配预算。
   */
  canAllocate(estimatedTokens: number): boolean {
    return !this.exhaustedFlag && this.used + estimatedTokens <= this.limit;
  }

  /**
   * 重置预算（用于新会话）。
   */
  reset(): void {
    this.used = 0;
    this.exhaustedFlag = false;
    this.warnedFlag = false;
  }

  /**
   * 获取剩余 token 数。
   */
  getRemaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  private getRemainingRatio(): number {
    return this.getRemaining() / this.limit;
  }

  private getUtilization(): number {
    return this.used / this.limit;
  }
}

const globalBudgets = new Map<string, TokenBudgetController>();

export function getOrCreateBudget(scope: string, options: TokenBudgetOptions): TokenBudgetController {
  const existing = globalBudgets.get(scope);
  if (existing) {
    return existing;
  }
  const budget = new TokenBudgetController(scope, options);
  globalBudgets.set(scope, budget);
  return budget;
}

export function getBudget(scope: string): TokenBudgetController | undefined {
  return globalBudgets.get(scope);
}

export function removeBudget(scope: string): void {
  globalBudgets.delete(scope);
}

export function clearAllBudgets(): void {
  globalBudgets.clear();
}

export function createBudgetMiddleware(budget: TokenBudgetController, estimateInput: boolean = true) {
  return {
    name: "token-budget-tracker",
    priority: 1,
    async *handler(event: LlmStreamEvent, next: () => AsyncGenerator<LlmStreamEvent | null>) {
      yield* next();
      if (event.type === "done" && event.usage) {
        budget.record({
          inputTokens: event.usage.promptTokens,
          outputTokens: event.usage.completionTokens,
        });
      }
    },
  };
}

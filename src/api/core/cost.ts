/**
 * Token 成本精确计算 — 基于 Decimal.js 的浮点安全运算。
 *
 * 职责:
 *   - 定义 PricingTable 类型（支持 context tier 定价）
 *   - 使用 Decimal.js 精确计算调用成本
 *   - 支持 standard / cache.read / cache.write 三级定价
 *   - 提供 accumulateCost 累加器
 *
 * 使用场景:
 *   - LLM 调用后计算实际花费
 *   - 会话级成本统计
 *   - 多轮对话成本累加
 *
 * 边界:
 *   1. 所有货币运算使用 Decimal.js，避免浮点精度问题
 *   2. 定价表以"每百万 token"为单位
 *   3. 缺失的定价 tier 默认按 0 计算
 *
 * 定价 tier 说明:
 *   - standard: 标准输入 token 定价
 *   - cache.read: 缓存读取 token 定价（通常低于 standard）
 *   - cache.write: 缓存写入 token 定价（通常高于 standard）
 *   - output: 输出 token 定价（通常最高）
 */

import Decimal from "decimal.js";
import type { TokenUsage } from "@/session/types";

/** Token 使用量（统一引用系统 TokenUsage 类型） */
export type CostUsage = TokenUsage;

/** 定价表 — 每百万 token 的价格（美元） */
export interface PricingTable {
  /** 标准输入 token 每百万价格 */
  inputPer1M: number | string;
  /** 输出 token 每百万价格 */
  outputPer1M: number | string;
  /** 缓存读取 token 每百万价格（可选，默认 0） */
  cacheReadPer1M?: number | string;
  /** 缓存写入 token 每百万价格（可选，默认 0） */
  cacheWritePer1M?: number | string;
}

/** 成本计算结果 */
export interface CostBreakdown {
  /** 标准输入成本 */
  inputCost: string;
  /** 输出成本 */
  outputCost: string;
  /** 缓存读取成本 */
  cacheReadCost: string;
  /** 缓存写入成本 */
  cacheWriteCost: string;
  /** 总成本（Decimal.js 字符串表示，保留完整精度） */
  totalCost: string;
  /** 总成本（浮点数，用于显示） */
  totalCostNumber: number;
}

/** 百万常量 */
const PER_MILLION = new Decimal(1_000_000);

/**
 * 计算单个 tier 的成本。
 *
 * @param tokens token 数量
 * @param pricePer1M 每百万 token 价格
 * @returns Decimal 成本对象
 */
function calculateTierCost(tokens: number, pricePer1M: number | string | undefined): Decimal {
  if (tokens <= 0 || pricePer1M === undefined || pricePer1M === null) {
    return new Decimal(0);
  }
  return new Decimal(tokens).mul(new Decimal(pricePer1M)).div(PER_MILLION);
}

/**
 * 精确计算 LLM 调用成本。
 *
 * 使用 Decimal.js 避免浮点精度问题，支持 context tier 定价。
 *
 * @param usage Token 使用量
 * @param pricing 定价表
 * @returns 成本明细
 *
 * @example
 * ```typescript
 * const cost = calculateCost(
 *   { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 200 },
 *   { inputPer1M: 0.15, outputPer1M: 0.60, cacheReadPer1M: 0.015 }
 * );
 * console.log(cost.totalCost); // "0.0001800000"
 * ```
 */
export function calculateCost(usage: CostUsage, pricing: PricingTable): CostBreakdown {
  const inputTokens = Math.max(0, usage.inputTokens ?? 0);
  const outputTokens = Math.max(0, usage.outputTokens ?? 0);
  // cacheReadInputTokens 优先，cachedTokens 作为兼容回退
  const cacheReadTokens = Math.max(0, usage.cacheReadInputTokens ?? usage.cachedTokens ?? 0);
  const cacheWriteTokens = Math.max(0, usage.cacheCreationInputTokens ?? 0);

  const inputCost = calculateTierCost(inputTokens, pricing.inputPer1M);
  const outputCost = calculateTierCost(outputTokens, pricing.outputPer1M);
  const cacheReadCost = calculateTierCost(cacheReadTokens, pricing.cacheReadPer1M);
  const cacheWriteCost = calculateTierCost(cacheWriteTokens, pricing.cacheWritePer1M);

  const totalCost = inputCost.plus(outputCost).plus(cacheReadCost).plus(cacheWriteCost);

  return {
    inputCost: inputCost.toString(),
    outputCost: outputCost.toString(),
    cacheReadCost: cacheReadCost.toString(),
    cacheWriteCost: cacheWriteCost.toString(),
    totalCost: totalCost.toString(),
    totalCostNumber: totalCost.toNumber(),
  };
}

/** 累加成本结果 */
export interface AccumulatedCost {
  /** 累计总成本（Decimal 字符串） */
  totalCost: string;
  /** 累计总成本（浮点数） */
  totalCostNumber: number;
  /** 累计输入 token 数 */
  totalInputTokens: number;
  /** 累计输出 token 数 */
  totalOutputTokens: number;
  /** 累计缓存读取 token 数 */
  totalCacheReadTokens: number;
  /** 累计缓存写入 token 数 */
  totalCacheWriteTokens: number;
  /** 调用次数 */
  callCount: number;
}

/**
 * 创建成本累加器。
 * 使用 Decimal.js 确保多轮累加不丢失精度。
 *
 * @returns 累加器对象
 *
 * @example
 * ```typescript
 * const accumulator = createCostAccumulator();
 * accumulator.add(usage1, pricing1);
 * accumulator.add(usage2, pricing2);
 * console.log(accumulator.getResult());
 * ```
 */
export function createCostAccumulator() {
  let totalCost = new Decimal(0);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let callCount = 0;

  return {
    add(usage: CostUsage, pricing: PricingTable): CostBreakdown {
      const breakdown = calculateCost(usage, pricing);
      totalCost = totalCost.plus(new Decimal(breakdown.totalCost));
      totalInputTokens += Math.max(0, usage.inputTokens ?? 0);
      totalOutputTokens += Math.max(0, usage.outputTokens ?? 0);
      totalCacheReadTokens += Math.max(0, usage.cacheReadInputTokens ?? usage.cachedTokens ?? 0);
      totalCacheWriteTokens += Math.max(0, usage.cacheCreationInputTokens ?? 0);
      callCount++;
      return breakdown;
    },

    getResult(): AccumulatedCost {
      return {
        callCount,
        totalCost: totalCost.toString(),
        totalCostNumber: totalCost.toNumber(),
        totalInputTokens,
        totalOutputTokens,
        totalCacheReadTokens,
        totalCacheWriteTokens,
      };
    },

    reset(): void {
      totalCost = new Decimal(0);
      totalInputTokens = 0;
      totalOutputTokens = 0;
      totalCacheReadTokens = 0;
      totalCacheWriteTokens = 0;
      callCount = 0;
    },
  };
}

/**
 * 使用 Decimal.js 精确累加 Token 使用量。
 * 用于替代 llmLoop.ts 中的原生数字累加，避免大数精度丢失。
 *
 * @param current 当前累计使用量
 * @param increment 新增使用量
 * @returns 累加后的使用量
 */
export function accumulateUsageDecimal<T extends CostUsage>(current: T | undefined, increment: CostUsage): T {
  if (!current) {
    return {
      inputTokens: increment.inputTokens,
      outputTokens: increment.outputTokens,
      ...(increment.cacheCreationInputTokens !== undefined
        ? { cacheCreationInputTokens: increment.cacheCreationInputTokens }
        : {}),
      ...(increment.cacheReadInputTokens !== undefined ? { cacheReadInputTokens: increment.cacheReadInputTokens } : {}),
      ...(increment.cachedTokens !== undefined ? { cachedTokens: increment.cachedTokens } : {}),
    } as T;
  }

  const inputTokens = new Decimal(current.inputTokens ?? 0).plus(increment.inputTokens ?? 0).toNumber();
  const outputTokens = new Decimal(current.outputTokens ?? 0).plus(increment.outputTokens ?? 0).toNumber();

  const result: CostUsage = {
    inputTokens,
    outputTokens,
  };

  if (current.cacheCreationInputTokens !== undefined || increment.cacheCreationInputTokens !== undefined) {
    result.cacheCreationInputTokens = new Decimal(current.cacheCreationInputTokens ?? 0)
      .plus(increment.cacheCreationInputTokens ?? 0)
      .toNumber();
  }

  if (current.cacheReadInputTokens !== undefined || increment.cacheReadInputTokens !== undefined) {
    result.cacheReadInputTokens = new Decimal(current.cacheReadInputTokens ?? 0)
      .plus(increment.cacheReadInputTokens ?? 0)
      .toNumber();
  }

  if (current.cachedTokens !== undefined || increment.cachedTokens !== undefined) {
    result.cachedTokens = new Decimal(current.cachedTokens ?? 0).plus(increment.cachedTokens ?? 0).toNumber();
  }

  return result as T;
}

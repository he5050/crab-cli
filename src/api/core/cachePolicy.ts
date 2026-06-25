/**
 * LLM 缓存策略 — 提示词缓存控制。
 *
 * 职责:
 *   - 定义缓存策略接口(CachePolicy)
 *   - 判断哪些内容适合缓存(system prompt + 工具定义)
 *   - 生成 cache_control 参数
 *   - 提供默认缓存策略
 *
 * 使用场景:
 *   - streamLlm 调用前构建缓存控制参数
 *   - Provider 选项中注入缓存标记
 *   - 降低重复 prompt 的 token 消耗
 *
 * 边界:
 *   1. 仅负责缓存策略决策，不执行实际缓存
 *   2. 缓存粒度: system prompt 末尾块 + 工具定义
 *   3. ephemeral 策略适用于 Anthropic prompt caching
 *   4. none 策略完全禁用缓存
 *
 * 流程:
 *   1. shouldCache 判断内容是否可缓存
 *   2. buildCacheControl 生成 cache_control 参数
 *   3. streamLlm 集成缓存标记
 */
import type { Tool } from "ai";

/** 缓存策略类型 */
export type CacheStrategy = "none" | "ephemeral" | "persistent";

/** 缓存策略配置 */
export interface CachePolicy {
  /** 缓存策略 */
  strategy: CacheStrategy;
  /** 最大缓存时间(秒)，仅 persistent 策略使用 */
  maxAge?: number;
}

/** 默认缓存策略 — ephemeral(临时缓存) */
export const defaultCachePolicy: CachePolicy = {
  strategy: "ephemeral",
};

/** cache_control 参数类型 */
export interface CacheControlParam {
  type: "ephemeral" | "persistent";
  /** 持久缓存的最大存活时间(秒) */
  ttl?: string;
}

/**
 * 判断 system prompt 是否适合缓存。
 *
 * 可缓存条件:
 *   - 非空且长度超过阈值(>200 字符)，短 prompt 缓存收益低
 *
 * @param systemPrompt 系统提示词
 * @returns 是否可缓存
 */
export function shouldCacheSystemPrompt(systemPrompt: string | undefined): boolean {
  if (!systemPrompt) {
    return false;
  }
  // 短 prompt 缓存收益低于开销，设 200 字符为下限
  const MIN_CACHEABLE_LENGTH = 200;
  return systemPrompt.length >= MIN_CACHEABLE_LENGTH;
}

/**
 * 判断工具定义是否适合缓存。
 *
 * 可缓存条件:
 *   - 至少有一个工具
 *
 * @param tools 工具定义映射表
 * @returns 是否可缓存
 */
export function shouldCacheTools(tools: Record<string, Tool> | undefined): boolean {
  if (!tools) {
    return false;
  }
  return Object.keys(tools).length > 0;
}

/**
 * 综合判断内容是否可缓存。
 *
 * @param systemPrompt 系统提示词
 * @param tools 工具定义
 * @returns 是否应启用缓存
 */
export function shouldCache(systemPrompt: string | undefined, tools: Record<string, Tool> | undefined): boolean {
  return shouldCacheSystemPrompt(systemPrompt) || shouldCacheTools(tools);
}

/**
 * 根据策略生成 cache_control 参数。
 *
 * @param policy 缓存策略
 * @returns cache_control 参数，strategy="none" 时返回 undefined
 */
export function buildCacheControl(policy: CachePolicy): CacheControlParam | undefined {
  switch (policy.strategy) {
    case "none":
      return undefined;
    case "ephemeral":
      return { type: "ephemeral" };
    case "persistent":
      return {
        type: "persistent",
        ...(policy.maxAge !== undefined ? { ttl: `${policy.maxAge}s` } : {}),
      };
    default:
      return undefined;
  }
}

/**
 * 为 system prompt 构建带缓存标记的消息块。
 *
 * Anthropic prompt caching 要求在最后一个内容块上添加 cache_control。
 * 此函数将 system prompt 包装为带 cache_control 的内容块。
 *
 * @param systemPrompt 系统提示词
 * @param policy 缓存策略
 * @returns 带缓存标记的内容块数组，或原始字符串(不缓存时)
 */
export function buildSystemPromptWithCache(
  systemPrompt: string,
  policy: CachePolicy = defaultCachePolicy,
): string | Array<{ type: "text"; text: string; cache_control?: CacheControlParam }> {
  const cacheControl = buildCacheControl(policy);
  if (!cacheControl || !shouldCacheSystemPrompt(systemPrompt)) {
    return systemPrompt;
  }
  return [{ cache_control: cacheControl, text: systemPrompt, type: "text" }];
}

/**
 * 为工具定义构建带缓存标记的配置。
 *
 * 在 Anthropic API 中，工具定义可通过 providerOptions 注入缓存标记。
 *
 * @param policy 缓存策略
 * @returns 包含 cacheControl 的 providerOptions 片段
 */
export function buildToolsCacheOptions(policy: CachePolicy = defaultCachePolicy): Record<string, unknown> | undefined {
  const cacheControl = buildCacheControl(policy);
  if (!cacheControl) {
    return undefined;
  }
  return { cacheControl };
}

/**
 * 从应用配置解析缓存策略。
 *
 * 优先使用 Provider 级 promptCaching 配置，
 * 禁用时返回 none 策略。
 *
 * @param promptCachingEnabled Provider 的 promptCaching.enabled 配置
 * @returns 解析后的缓存策略
 */
export function resolveCachePolicy(promptCachingEnabled: boolean): CachePolicy {
  if (!promptCachingEnabled) {
    return { strategy: "none" };
  }
  return defaultCachePolicy;
}

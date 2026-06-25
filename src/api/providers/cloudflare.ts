/**
 * Cloudflare Workers AI Provider 适配器 — Cloudflare 的 Workers AI 服务。
 *
 * 职责:
 *   - 提供 Cloudflare Workers AI 的 baseURL、认证、模型列表
 *   - 支持 OpenAI Chat 协议
 *   - 需要 accountId 构建 baseURL
 *
 * 使用场景:
 *   - 通过 Cloudflare Workers AI 访问 Llama/Qwen 等开源模型
 *   - 配置向导中选择 Cloudflare 作为 Provider
 *
 * 边界:
 *   1. 认证方式: API Key（Authorization: Bearer ${key}）
 *   2. baseURL: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1
 *   3. 协议兼容 OpenAI Chat API
 */
import type { SingleProviderConfig } from "@/schema/config";

/** Cloudflare 默认配置 */
export const CLOUDFLARE_DEFAULTS = {
  baseURL: "https://api.cloudflare.com/client/v4/accounts",
  defaultModel: "@cf/meta/llama-3.1-8b-instruct",
  requestMethod: "chat" as const,
};

/** Cloudflare Workers AI 模型列表 */
export const CLOUDFLARE_MODELS = [
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3.1-70b-instruct",
  "@cf/qwen/qwen1.5-14b-chat-awq",
];

/**
 * 构建 Cloudflare Workers AI baseURL。
 *
 * @param accountId - Cloudflare Account ID
 * @returns 完整的 baseURL
 */
export function buildCloudflareBaseURL(accountId: string): string {
  return `${CLOUDFLARE_DEFAULTS.baseURL}/${accountId}/ai/v1`;
}

/**
 * Cloudflare Provider 配置工厂。
 *
 * @param accountId - Cloudflare Account ID
 * @param apiKey    - Cloudflare API Key
 * @param model     - 默认模型（可选）
 * @returns Provider 配置
 */
export function createCloudflareConfig(
  accountId: string,
  apiKey: string,
  model?: string,
): Partial<SingleProviderConfig> {
  return {
    apiKey,
    baseURL: buildCloudflareBaseURL(accountId),
    defaultModel: model ?? CLOUDFLARE_DEFAULTS.defaultModel,
    modelList: CLOUDFLARE_MODELS,
    requestMethod: CLOUDFLARE_DEFAULTS.requestMethod,
  };
}

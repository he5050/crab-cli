/**
 * OpenRouter Provider 适配器 — 统一 API 网关。
 *
 * 职责:
 *   - 提供 OpenRouter 的 baseURL、认证、模型列表
 *   - 支持 OpenAI Chat 协议
 *   - 通过 /models 端点获取模型列表
 *
 * 使用场景:
 *   - 通过 OpenRouter 统一访问多种 LLM
 *   - 配置向导中选择 OpenRouter 作为 Provider
 *
 * 边界:
 *   1. 认证方式:API Key（Authorization: Bearer ${key}）
 *   2. baseURL: https://openrouter.ai/api/v1
 *   3. 协议兼容 OpenAI Chat API
 */
import type { SingleProviderConfig } from "@/schema/config";

/** OpenRouter 默认配置 */
export const OPENROUTER_DEFAULTS = {
  baseURL: "https://openrouter.ai/api/v1",
  defaultModel: "anthropic/claude-sonnet-4",
  requestMethod: "chat" as const,
};

/** OpenRouter Provider 配置工厂 */
export function createOpenRouterConfig(apiKey: string, model?: string): Partial<SingleProviderConfig> {
  return {
    apiKey,
    baseURL: OPENROUTER_DEFAULTS.baseURL,
    defaultModel: model ?? OPENROUTER_DEFAULTS.defaultModel,
    modelList: [
      "anthropic/claude-sonnet-4",
      "anthropic/claude-3.5-haiku",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-pro",
      "meta-llama/llama-3.3-70b-instruct",
      "mistralai/mistral-large",
      "deepseek/deepseek-chat",
    ],
    requestMethod: OPENROUTER_DEFAULTS.requestMethod,
  };
}

/**
 * 从 OpenRouter /models 端点获取模型列表。
 *
 * @param apiKey - OpenRouter API Key
 * @returns 模型 ID 列表
 */
export async function fetchOpenRouterModels(apiKey: string): Promise<string[]> {
  const response = await fetch(`${OPENROUTER_DEFAULTS.baseURL}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`获取 OpenRouter 模型列表失败: ${response.status}`);
  }

  const data = (await response.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}

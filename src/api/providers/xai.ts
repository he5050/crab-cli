/**
 * xAI Grok Provider 适配器 — xAI 的 Grok 模型。
 *
 * 职责:
 *   - 提供 xAI 的 baseURL、认证
 *   - 支持 OpenAI Chat 协议
 *
 * 使用场景:
 *   - 通过 xAI API 访问 Grok 模型
 *   - 配置向导中选择 xAI 作为 Provider
 *
 * 边界:
 *   1. 认证方式: API Key（Authorization: Bearer ${key}）
 *   2. baseURL: https://api.x.ai/v1
 *   3. 协议兼容 OpenAI Chat API
 */
import type { SingleProviderConfig } from "@/schema/config";

/** xAI 默认配置 */
export const XAI_DEFAULTS = {
  baseURL: "https://api.x.ai/v1",
  defaultModel: "grok-3",
  requestMethod: "chat" as const,
};

/** xAI 模型列表 */
export const XAI_MODELS = ["grok-3", "grok-3-mini", "grok-2", "grok-2-vision"];

/** xAI Provider 配置工厂 */
export function createXaiConfig(apiKey: string, model?: string): Partial<SingleProviderConfig> {
  return {
    apiKey,
    baseURL: XAI_DEFAULTS.baseURL,
    defaultModel: model ?? XAI_DEFAULTS.defaultModel,
    modelList: XAI_MODELS,
    requestMethod: XAI_DEFAULTS.requestMethod,
  };
}

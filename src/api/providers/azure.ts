/**
 * Azure OpenAI Provider 适配器 — Azure 托管的 OpenAI 服务。
 *
 * 职责:
 *   - 提供 Azure OpenAI 的 baseURL、认证、部署配置
 *   - 支持 API Key（api-key header）或 Azure AD 认证
 *   - 支持 deployment-based 模型
 *
 * 使用场景:
 *   - 企业级 Azure OpenAI 部署
 *   - 配置向导中选择 Azure OpenAI 作为 Provider
 *
 * 边界:
 *   1. baseURL: https://${resourceName}.openai.azure.com/openai
 *   2. 请求路径: /deployments/${deployment}/chat/completions?api-version=2024-02-15-preview
 *   3. 认证: api-key header 或 Azure AD Bearer token
 *   4. 模型名称即 deployment 名称
 */
import type { SingleProviderConfig } from "@/schema/config";

/** Azure OpenAI API 版本 */
export const AZURE_API_VERSION = "2024-02-15-preview";

/** Azure OpenAI 默认配置 */
export const AZURE_DEFAULTS = {
  defaultModel: "gpt-4o",
  requestMethod: "chat" as const,
};

/**
 * 构建 Azure OpenAI baseURL。
 *
 * @param resourceName - Azure 资源名称
 * @returns baseURL
 */
export function buildAzureBaseURL(resourceName: string): string {
  return `https://${resourceName}.openai.azure.com/openai`;
}

/**
 * 构建 Azure OpenAI 请求路径。
 *
 * @param deployment - 部署名称
 * @returns 请求路径
 */
export function buildAzureRequestPath(deployment: string): string {
  return `/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`;
}

/**
 * 构建 Azure OpenAI 认证头。
 *
 * API Key 模式: api-key header
 * Azure AD 模式: Authorization: Bearer ${token}
 *
 * @param apiKey - API Key
 * @param azureAdToken - Azure AD token（可选）
 * @returns 认证头
 */
export function buildAzureAuthHeaders(apiKey?: string, azureAdToken?: string): Record<string, string> {
  if (azureAdToken) {
    return { Authorization: `Bearer ${azureAdToken}` };
  }
  if (apiKey) {
    return { "api-key": apiKey };
  }
  return {};
}

/** Azure OpenAI Provider 配置工厂 */
export function createAzureConfig(
  resourceName: string,
  apiKey: string,
  deployment?: string,
): Partial<SingleProviderConfig> {
  const model = deployment ?? AZURE_DEFAULTS.defaultModel;
  return {
    apiKey,
    baseURL: buildAzureBaseURL(resourceName),
    customHeaders: buildAzureAuthHeaders(apiKey),
    defaultModel: model,
    modelList: [model],
    requestMethod: AZURE_DEFAULTS.requestMethod,
  };
}

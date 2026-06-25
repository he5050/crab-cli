/**
 * Provider 适配器模块 — 导出所有扩展 Provider 的配置工厂和工具函数。
 *
 * 模块结构:
 *   - openrouter.ts     — OpenRouter 统一 API
 *   - azure.ts          — Azure OpenAI
 *   - bedrock.ts        — AWS Bedrock（SigV4 签名）
 *   - xai.ts            — xAI Grok
 *   - githubCopilot.ts — GitHub Copilot（OAuth Device Flow）
 */
export { OPENROUTER_DEFAULTS, createOpenRouterConfig, fetchOpenRouterModels } from "./openrouter";
export {
  AZURE_API_VERSION,
  AZURE_DEFAULTS,
  buildAzureBaseURL,
  buildAzureRequestPath,
  buildAzureAuthHeaders,
  createAzureConfig,
} from "./azure";
export {
  BEDROCK_DEFAULTS,
  BEDROCK_MODELS,
  signSigV4,
  buildBedrockUrl,
  createBedrockConfig,
  type AwsCredentials,
} from "./bedrock";
export { XAI_DEFAULTS, XAI_MODELS, createXaiConfig } from "./xai";
export {
  COPILOT_OAUTH_CONFIG,
  COPILOT_DEFAULTS,
  COPILOT_MODELS,
  requestDeviceCode,
  pollForToken,
  getCopilotToken,
  exchangeCopilotToken,
  createCopilotConfig,
} from "./githubCopilot";

/** 所有扩展 Provider 的元信息 */
export interface ExtendedProviderMeta {
  id: string;
  name: string;
  authType: "api-key" | "oauth" | "aws";
  defaultModel: string;
  models: string[];
  description: string;
}

/** 所有扩展 Provider 元信息列表 */
export const EXTENDED_PROVIDERS: ExtendedProviderMeta[] = [
  {
    authType: "api-key",
    defaultModel: "anthropic/claude-sonnet-4",
    description: "统一 API 网关，支持 100+ 模型",
    id: "openrouter",
    models: [
      "anthropic/claude-sonnet-4",
      "anthropic/claude-3.5-haiku",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.5-pro",
      "meta-llama/llama-3.3-70b-instruct",
      "mistralai/mistral-large",
      "deepseek/deepseek-chat",
    ],
    name: "OpenRouter",
  },
  {
    authType: "api-key",
    defaultModel: "gpt-4o",
    description: "Azure 托管的 OpenAI 服务",
    id: "azure",
    models: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini"],
    name: "Azure OpenAI",
  },
  {
    authType: "aws",
    defaultModel: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    description: "AWS 托管的 LLM 服务（Claude/Llama/Mistral）",
    id: "bedrock",
    models: [
      "anthropic.claude-3-5-sonnet-20241022-v2:0",
      "anthropic.claude-3-5-haiku-20241022-v1:0",
      "anthropic.claude-3-opus-20240229-v1:0",
      "meta.llama3-3-70b-instruct-v1:0",
      "mistral.mistral-large-2407-v1:0",
      "amazon.nova-pro-v1:0",
    ],
    name: "AWS Bedrock",
  },
  {
    authType: "api-key",
    defaultModel: "grok-3",
    description: "xAI 的 Grok 模型",
    id: "xai",
    models: ["grok-3", "grok-3-mini", "grok-2", "grok-2-vision"],
    name: "xAI Grok",
  },
  {
    authType: "oauth",
    defaultModel: "gpt-4o",
    description: "GitHub Copilot Chat API（OAuth 认证）",
    id: "github-copilot",
    models: ["gpt-4o", "gpt-4o-mini", "claude-3.5-sonnet", "o1", "o1-mini", "gemini-2.0-flash"],
    name: "GitHub Copilot",
  },
];

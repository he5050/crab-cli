/**
 * API 配置辅助 — 提供商默认值与模型列表。
 *
 * 职责:
 *   - 定义各 AI 提供商的默认配置
 *   - 管理可用模型列表
 *   - 提供提供商元信息查询
 *
 * 模块功能:
 *   - getProvider: 获取提供商元信息
 *   - listProviders: 获取所有已注册的提供商列表
 *   - getDefaultModel: 获取提供商的默认模型
 *   - getEnvKey: 获取提供商的环境变量 Key 名
 *   - ProviderMeta: 提供商元信息接口
 *   - PROVIDERS: 提供商注册表
 *
 * 使用场景:
 *   - 配置 AI 提供商
 *   - 获取模型列表
 *   - 环境变量提示
 *
 * 边界:
 *   1. 仅提供配置查询，不涉及 API 调用
 *   2. 提供商配置为静态定义
 *   3. 支持 OpenAI、Anthropic、Google、Ollama 和自定义提供商
 *
 * 流程:
 *   1. 查询提供商配置
 *   2. 获取默认模型和可用模型列表
 *   3. 获取环境变量 Key
 */
import type { ApiProvider } from "@/schema/api";

/** 提供商元信息 */
export interface ProviderMeta {
  id: ApiProvider;
  name: string;
  defaultModel: string;
  models: string[];
  envKey: string;
  baseUrl?: string;
}

/** 提供商注册表 */
const PROVIDERS: Record<string, ProviderMeta> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-20250514",
    envKey: "ANTHROPIC_API_KEY",
    id: "anthropic",
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3.5-haiku-20241022"],
    name: "Anthropic",
  },
  custom: {
    defaultModel: "",
    envKey: "CUSTOM_API_KEY",
    id: "custom",
    models: [],
    name: "自定义",
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-pro",
    envKey: "GOOGLE_API_KEY",
    id: "google",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
    name: "Google",
  },
  ollama: {
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.1",
    envKey: "",
    id: "ollama",
    models: ["llama3.1", "codellama", "mistral", "qwen2", "deepseek-r1"],
    name: "Ollama",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    envKey: "OPENAI_API_KEY",
    id: "openai",
    models: ["gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3", "o3-mini", "o4-mini"],
    name: "OpenAI",
  },
};

/**
 * 获取提供商元信息。
 *
 * @param providerId - 提供商 ID
 * @returns 提供商配置，未找到返回 undefined
 */
export function getProvider(providerId: string): ProviderMeta | undefined {
  return PROVIDERS[providerId];
}

/**
 * 获取所有已注册的提供商列表。
 */
export function listProviders(): ProviderMeta[] {
  return Object.values(PROVIDERS);
}

/**
 * 获取提供商的默认模型。
 */
export function getDefaultModel(providerId: string): string {
  return PROVIDERS[providerId]?.defaultModel ?? "";
}

/**
 * 获取提供商的环境变量 Key 名。
 */
export function getEnvKey(providerId: string): string {
  return PROVIDERS[providerId]?.envKey ?? "";
}

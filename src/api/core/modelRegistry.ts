/**
 * 模型注册表 — 管理模型信息、能力声明与查询。
 *
 * 职责:
 *   - 维护模型能力（vision / tools / reasoning / jsonMode）的内置覆盖表
 *   - 提供模型列表、搜索、默认模型等查询接口
 *   - 聚合所有已配置 Provider 的模型信息并附带能力标注
 *
 * 模块功能:
 *   - ModelInfo / ModelCapabilities / ModelInfoWithCapabilities 类型定义
 *   - DEFAULT_CAPABILITIES: 默认模型能力
 *   - MODEL_OVERRIDES: 特定模型能力覆盖
 *   - getCapabilities: 根据模型 ID 获取能力（内部）
 *   - listAllModels: 列出所有已配置 Provider 的模型（附带能力）
 *   - listModelsByProvider: 列出指定 Provider 的模型（附带能力）
 *   - getDefaultModel: 获取默认模型（附带能力）
 *   - searchModels: 按关键词搜索模型
 *   - getModelCapabilities: 公开获取模型能力
 *
 * 使用场景:
 *   - CLI 列出可用模型（`crab models`）
 *   - 模型选择菜单展示
 *   - 判断模型是否支持 vision / tools 等能力
 *   - 模型搜索与过滤
 *
 * 边界:
 *   1. 仅负责模型信息聚合与能力查询，不负责 Provider 实例创建
 *   2. 依赖 ./provider 模块的 listConfiguredProviders 和 getProviderModels
 *   3. 能力覆盖表为静态内置数据，不支持运行时动态扩展
 */
import type { AppConfigSchema } from "@/schema/config";
import { listConfiguredProviders, getProviderModels } from "./provider";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("modelRegistry");

// ─── 类型定义 ─────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  providerId: string;
  isDefault: boolean;
}

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  reasoning: boolean;
  jsonMode: boolean;
  maxOutputTokens?: number;
}

export interface ModelInfoWithCapabilities extends ModelInfo {
  capabilities: ModelCapabilities;
}

// ─── 能力覆盖表 ───────────────────────────────────────────────

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  vision: true,
  tools: true,
  reasoning: true,
  jsonMode: true,
};

const MODEL_OVERRIDES: Record<string, ModelCapabilities> = {
  "gpt-4o-mini": { vision: true, tools: true, reasoning: false, jsonMode: true },
  "gpt-4o": { vision: true, tools: true, reasoning: false, jsonMode: true },
  "o1-mini": { vision: false, tools: false, reasoning: true, jsonMode: false },
  "o1-preview": { vision: false, tools: false, reasoning: true, jsonMode: false },
  "o3-mini": { vision: false, tools: true, reasoning: true, jsonMode: true },
  "claude-3-5-haiku-latest": { vision: true, tools: true, reasoning: false, jsonMode: true },
  "claude-3-5-sonnet-latest": { vision: true, tools: true, reasoning: false, jsonMode: true },
  "claude-3-opus-latest": { vision: true, tools: true, reasoning: false, jsonMode: true },
  "gemini-2.0-flash-exp": { vision: true, tools: true, reasoning: false, jsonMode: true },
  "gemini-2.0-flash-thinking-exp": { vision: true, tools: true, reasoning: true, jsonMode: true },
};

// ─── 内部工具 ─────────────────────────────────────────────────

function getCapabilities(modelId: string): ModelCapabilities {
  const lower = modelId.toLowerCase();
  for (const [pattern, caps] of Object.entries(MODEL_OVERRIDES)) {
    if (lower.includes(pattern.toLowerCase())) {
      return caps;
    }
  }
  return { ...DEFAULT_CAPABILITIES };
}

// ─── 公开 API ─────────────────────────────────────────────────

export function listAllModels(config: AppConfigSchema): ModelInfoWithCapabilities[] {
  const models: ModelInfoWithCapabilities[] = [];
  const defaultProvider = config.defaultProvider.provider;
  const defaultModel = config.defaultProvider.model;

  for (const providerId of listConfiguredProviders(config)) {
    const modelList = getProviderModels(config, providerId);
    for (const modelId of modelList) {
      models.push({
        id: modelId,
        isDefault: providerId === defaultProvider && modelId === defaultModel,
        providerId,
        capabilities: getCapabilities(modelId),
      });
    }
  }

  log.debug(`可用模型列表: ${models.length} 个(默认: ${defaultProvider}/${defaultModel})`);
  return models;
}

export function listModelsByProvider(config: AppConfigSchema, providerId: string): ModelInfoWithCapabilities[] {
  // 直接遍历目标 provider 的 modelList，O(M) 而非 listAllModels 的 O(N)
  const modelList = getProviderModels(config, providerId);
  const defaultProvider = config.defaultProvider.provider;
  const defaultModel = config.defaultProvider.model;
  const models: ModelInfoWithCapabilities[] = modelList.map((modelId) => ({
    id: modelId,
    isDefault: providerId === defaultProvider && modelId === defaultModel,
    providerId,
    capabilities: getCapabilities(modelId),
  }));
  log.debug(`Provider [${providerId}] 模型: ${models.length} 个`);
  return models;
}

export function getDefaultModel(config: AppConfigSchema): ModelInfoWithCapabilities {
  const modelId = config.defaultProvider.model;
  return {
    id: modelId,
    isDefault: true,
    providerId: config.defaultProvider.provider,
    capabilities: getCapabilities(modelId),
  };
}

export function searchModels(config: AppConfigSchema, query: string): ModelInfoWithCapabilities[] {
  const q = query.toLowerCase();
  const results = listAllModels(config).filter((m) => m.id.toLowerCase().includes(q));
  log.debug(`搜索模型 "${query}": 匹配 ${results.length} 个`);
  return results;
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  return getCapabilities(modelId);
}

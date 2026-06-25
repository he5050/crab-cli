/**
 * Vision 路由 — 多模态请求的 Provider / 模型自动切换。
 *
 * 职责:
 *   - 检测消息中是否包含多模态内容（图片、文件等）
 *   - 根据配置自动选择 Vision 专用 Provider、模型或端点
 *   - 构建运行时配置，使下游流处理对 Vision 路由透明
 *
 * 模块功能:
 *   - hasVisionContent: 检测消息是否包含多模态内容
 *   - hasDedicatedVisionConfig: 判断 Provider 是否配置了独立的 Vision 参数
 *   - buildVisionProviderConfig: 构建合并后的 Vision Provider 配置
 *   - buildVisionRuntimeConfig: 构建包含 Vision 路由的完整运行时配置
 *   - resolveStreamRuntime: 综合决策，返回最终运行时路由结果
 *
 * 使用场景:
 *   - 用户发送包含图片的对话消息时，自动切换到支持视觉的模型/Provider
 *   - 同一 Provider 配置了独立的 Vision 端点（不同 baseURL / API Key）时自动路由
 *   - 仅需切换模型（同一 Provider 不同模型）的轻量 Vision 路由
 *
 * 边界:
 *   1. 纯路由决策，不执行实际的 LLM 调用（由 streamHandler 负责）
 *   2. 不处理降级重试（由调用方处理）
 *   3. 仅在检测到多模态内容时才触发路由逻辑
 *   4. Vision 配置缺失时静默回退到原始 Provider/模型，不抛出错误
 *
 * 路由决策优先级:
 *   1. 有独立的 Vision 配置（visionProvider / visionBaseURL 等）→ 使用专用 Provider
 *   2. 仅配置了 visionModel → 同 Provider 切换模型
 *   3. 无 Vision 配置 → 保持原始 Provider/模型不变
 */
import type { AppConfigSchema, RequestMethod, SingleProviderConfig } from "@/schema/config";
import type { ModelMessage } from "ai";
import { getVerifiedMethod } from "../resilience/fallback";

/**
 * 检测消息中是否包含多模态内容（图片、文件等）
 *
 * 支持的类型:
 * - image: 图片内容
 * - file: 文件内容
 * - tool-result: 工具执行结果（可能包含复杂数据）
 */
export function hasVisionContent(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      continue;
    }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        // 检查所有可能的多模态类型
        if (part.type === "image" || part.type === "file" || part.type === "tool-result") {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * 流式运行时路由结果
 *
 * 描述经过 Vision 路由决策后的实际调用参数，
 * 下游 streamHandler 直接使用这些参数发起 LLM 请求。
 */
export interface StreamRuntime {
  config: AppConfigSchema;
  providerId: string;
  modelId: string;
  requestMethod: RequestMethod;
  providerCfg?: SingleProviderConfig;
  usingVision: boolean;
}

/**
 * 判断 Provider 配置中是否包含独立的 Vision 参数
 *
 * 检查字段: visionProvider, visionBaseURL, visionApiKey,
 * visionRequestMethod, visionCustomHeaders
 */
export function hasDedicatedVisionConfig(providerCfg: SingleProviderConfig | undefined): boolean {
  return Boolean(
    providerCfg?.visionProvider ||
    providerCfg?.visionBaseURL ||
    providerCfg?.visionApiKey ||
    providerCfg?.visionRequestMethod ||
    providerCfg?.visionCustomHeaders,
  );
}

/**
 * 构建合并后的 Vision Provider 配置
 *
 * 将 Provider 配置中的 Vision 专用字段合并到基础配置中，
 * 生成可直接使用的 Provider 配置。
 */
export function buildVisionProviderConfig(providerCfg: SingleProviderConfig): SingleProviderConfig {
  return {
    ...providerCfg,
    apiKey: providerCfg.visionApiKey ?? providerCfg.apiKey,
    baseURL: providerCfg.visionBaseURL ?? providerCfg.baseURL,
    customHeaders: {
      ...providerCfg.customHeaders,
      ...providerCfg.visionCustomHeaders,
    },
    defaultModel: providerCfg.visionModel ?? providerCfg.defaultModel,
    requestMethod: providerCfg.visionRequestMethod ?? providerCfg.requestMethod,
  };
}

/**
 * 构建包含 Vision 路由的完整运行时配置
 *
 * 当 sourceProvider 和 targetProvider 不同时，
 * 将 source 的 Vision 专用参数合并到 target Provider 配置中；
 * 当两者相同时，直接使用 buildVisionProviderConfig 构建。
 */
export function buildVisionRuntimeConfig(
  config: AppConfigSchema,
  sourceProviderId: string,
  targetProviderId: string,
  sourceProviderCfg: SingleProviderConfig,
): AppConfigSchema {
  const targetProviderCfg = config.providerConfig[targetProviderId] ?? sourceProviderCfg;
  const mergedProviderCfg: SingleProviderConfig = {
    ...targetProviderCfg,
    ...(targetProviderId === sourceProviderId
      ? {}
      : {
          apiKey: sourceProviderCfg.visionApiKey ?? targetProviderCfg.apiKey,
          baseURL: sourceProviderCfg.visionBaseURL ?? targetProviderCfg.baseURL,
          customHeaders: {
            ...targetProviderCfg.customHeaders,
            ...sourceProviderCfg.visionCustomHeaders,
          },
          requestMethod: sourceProviderCfg.visionRequestMethod ?? targetProviderCfg.requestMethod,
        }),
  };

  const visionProviderCfg =
    targetProviderId === sourceProviderId ? buildVisionProviderConfig(sourceProviderCfg) : mergedProviderCfg;

  return {
    ...config,
    providerConfig: {
      ...config.providerConfig,
      [targetProviderId]: visionProviderCfg,
    },
  };
}

/**
 * 综合决策：根据消息内容和 Provider 配置，返回最终的流式运行时路由
 *
 * 决策流程:
 * 1. 检测消息是否包含多模态内容
 * 2. 若无多模态内容，直接返回原始配置
 * 3. 若有独立 Vision 配置，切换到专用 Provider/模型
 * 4. 若仅配置了 visionModel，同 Provider 切换模型
 * 5. 兜底：保持原始配置不变
 */
export function resolveStreamRuntime(
  config: AppConfigSchema,
  providerId: string,
  modelId: string,
  messages: ModelMessage[],
): StreamRuntime {
  const providerCfg = config.providerConfig[providerId];
  const hasImage = hasVisionContent(messages);
  if (!hasImage || !providerCfg) {
    const requestMethod = getVerifiedMethod(config, providerId, modelId);
    return {
      config,
      modelId,
      providerCfg,
      providerId,
      requestMethod,
      usingVision: false,
    };
  }

  if (hasDedicatedVisionConfig(providerCfg)) {
    const visionProviderId = providerCfg.visionProvider ?? providerId;
    const runtimeConfig = buildVisionRuntimeConfig(config, providerId, visionProviderId, providerCfg);
    const runtimeProviderCfg = runtimeConfig.providerConfig[visionProviderId];
    const runtimeModel = providerCfg.visionModel ?? runtimeProviderCfg?.defaultModel ?? modelId;
    const requestMethod = getVerifiedMethod(runtimeConfig, visionProviderId, runtimeModel);
    return {
      config: runtimeConfig,
      modelId: runtimeModel,
      providerCfg: runtimeProviderCfg,
      providerId: visionProviderId,
      requestMethod,
      usingVision: true,
    };
  }

  if (providerCfg.visionModel) {
    const requestMethod = getVerifiedMethod(config, providerId, providerCfg.visionModel);
    return {
      config,
      modelId: providerCfg.visionModel,
      providerCfg,
      providerId,
      requestMethod,
      usingVision: true,
    };
  }

  const requestMethod = getVerifiedMethod(config, providerId, modelId);
  return {
    config,
    modelId,
    providerCfg,
    providerId,
    requestMethod,
    usingVision: false,
  };
}

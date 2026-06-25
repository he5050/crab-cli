/**
 * Embedding API — 文本向量化(多 Provider 路由)。
 *
 * 职责:
 *   - 根据 config.codebase.embedding.type 路由到对应 Provider
 *   - 支持单条和批量文本 Embedding 生成
 *   - 提供 getEmbeddingConfig() 读取归一化配置
 *
 * 支持的 Provider 类型:
 *   - openai: OpenAI 兼容接口(含 Jina、Mistral 等兼容服务)
 *   - ollama: Ollama 本地模型(/api/embed)
 *   - gemini: Google Gemini Embedding API
 *
 * 边界:
 *   1. ollama/gemini 类型不经过 AI SDK，直接 fetch
 *   2. openai/jina/mistral 走 AI SDK 的 OpenAI 兼容接口
 *   3. 未配置 API Key 时 ollama 仍可工作(本地服务)
 */
import { type EmbeddingModel, embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import { toApiAppError } from "../core/errorHandler";
import { fetchWithTimeout } from "../utils/fetchTimeout";

const log = createLogger("embedding");

// ─── 默认 Provider 配置 ──────────────────────────────────────

export const EMBEDDING_PROVIDER_DEFAULTS: Readonly<Record<string, { baseUrl?: string; defaultModel: string }>> = {
  gemini: { baseUrl: "https://generativelanguage.googleapis.com", defaultModel: "text-embedding-004" },
  jina: { baseUrl: "https://api.jina.ai/v1", defaultModel: "jina-embeddings-v3" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-embed" },
  ollama: { baseUrl: "http://localhost:11434", defaultModel: "nomic-embed-text" },
  openai: { defaultModel: "text-embedding-3-small" },
};

/** @internal 内部别名，保持模块内引用不变（指向导出的只读常量） */
const PROVIDER_DEFAULTS = EMBEDDING_PROVIDER_DEFAULTS;

/**
 * 透传 dimensions 到 provider options。
 * 仅 OpenAI 的 text-embedding-3-* 系列原生支持自定义维度，
 * 其他 Provider 会忽略该字段。
 */
function dimensionsProviderOptions(embCfg: NormalizedEmbeddingConfig): Parameters<typeof embed>[0]["providerOptions"] {
  if (!embCfg.dimensions || embCfg.type !== "openai") {
    return undefined;
  }
  return { openai: { dimensions: embCfg.dimensions } } as Parameters<typeof embed>[0]["providerOptions"];
}

// ─── 配置读取 ─────────────────────────────────────────────────

export interface NormalizedEmbeddingConfig {
  type: string;
  model: string;
  dimensions: number;
  apiKey: string;
  baseUrl: string;
}

export function getEmbeddingConfig(config: AppConfigSchema): NormalizedEmbeddingConfig {
  const emb = config.codebase?.embedding ?? {
    dimensions: 1536,
    model: "text-embedding-3-small",
    type: "openai" as const,
  };
  const type = emb.type ?? "openai";
  const defaults = PROVIDER_DEFAULTS[type] ?? PROVIDER_DEFAULTS.openai!;

  // Ollama/gemini 有自己的 baseUrl 和 api，不回退到主 provider
  // Jina/mistral 虽走 OpenAI 兼容接口，但默认用各自 provider 的 baseUrl
  const useProviderFallback = type === "openai";
  const pConfig = useProviderFallback ? config.providerConfig[config.defaultProvider.provider] : null;

  return {
    apiKey: emb.apiKey || pConfig?.apiKey || "",
    baseUrl: emb.baseUrl || pConfig?.baseURL || defaults.baseUrl || "",
    dimensions: emb.dimensions || 1536,
    model: emb.model || defaults.defaultModel,
    type,
  };
}

export function getEmbeddingConfigForProvider(config: AppConfigSchema, providerId: string): NormalizedEmbeddingConfig {
  const emb = config.codebase?.embedding ?? {
    dimensions: 1536,
    model: "text-embedding-3-small",
    type: "openai" as const,
  };
  const pConfig = config.providerConfig[providerId];
  const type = emb.type ?? "openai";
  const defaults = PROVIDER_DEFAULTS[type] ?? PROVIDER_DEFAULTS.openai!;

  return {
    apiKey: emb.apiKey || pConfig?.apiKey || "",
    baseUrl: emb.baseUrl || pConfig?.baseURL || defaults.baseUrl || "",
    dimensions: emb.dimensions || 1536,
    model: emb.model || pConfig?.defaultModel || defaults.defaultModel,
    type,
  };
}

// ─── 选项类型 ────────────────────────────────────────────────

export interface EmbeddingOptions {
  providerId?: string;
  model?: string;
  maxRetries?: number;
}

export interface EmbeddingResult {
  text: string;
  embedding: number[];
}

// ─── Provider 创建 ─────────────────────────────────────────────

export function createEmbeddingModel(embCfg: NormalizedEmbeddingConfig, overrideModel?: string): EmbeddingModel {
  const model = overrideModel || embCfg.model;

  if (embCfg.type === "ollama") {
    return createOllamaModel(embCfg, model);
  }
  if (embCfg.type === "gemini") {
    return createGeminiModel(embCfg, model);
  }

  const openai = createOpenAI({
    apiKey: embCfg.apiKey,
    baseURL: embCfg.baseUrl || undefined,
  });
  return openai.embedding(model);
}

function createOllamaModel(embCfg: NormalizedEmbeddingConfig, model: string): EmbeddingModel {
  return {
    async doEmbed(options: { values: string[] }) {
      const res = await fetchWithTimeout(`${embCfg.baseUrl}/api/embed`, {
        body: JSON.stringify({ input: options.values, model }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        timeoutMs: 30_000,
      });
      if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Ollama embed 失败: ${res.status} ${body}`) as Error & { status?: number };
        err.status = res.status;
        throw toApiAppError(err, { providerId: "ollama", modelId: model });
      }
      let data: { embeddings: number[][] };
      try {
        data = (await res.json()) as { embeddings: number[][] };
      } catch {
        throw toApiAppError(new Error("Ollama embed 响应 JSON 解析失败"), {
          providerId: "ollama",
          modelId: model,
        });
      }
      return { embeddings: data.embeddings, warnings: [] };
    },
    maxEmbeddingsPerCall: 512,
    modelId: model,
    provider: "ollama",
    specificationVersion: "v3",
    supportsParallelCalls: true,
  } satisfies EmbeddingModel;
}

function createGeminiModel(embCfg: NormalizedEmbeddingConfig, model: string): EmbeddingModel {
  return {
    async doEmbed(options: { values: string[] }) {
      const url = `${embCfg.baseUrl}/v1beta/models/${model}:batchEmbedContents`;
      const requests = options.values.map((text) => ({
        content: { parts: [{ text }] },
        model: `models/${model}`,
      }));
      const res = await fetchWithTimeout(url, {
        body: JSON.stringify({ requests }),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": embCfg.apiKey,
        },
        method: "POST",
        timeoutMs: 30_000,
      });
      if (!res.ok) {
        const body = await res.text();
        const err = new Error(`Gemini embed 失败: ${res.status} ${body}`) as Error & { status?: number };
        err.status = res.status;
        throw toApiAppError(err, { providerId: "gemini", modelId: model });
      }
      let data: { embeddings: { values: number[] }[] };
      try {
        data = (await res.json()) as { embeddings: { values: number[] }[] };
      } catch {
        throw toApiAppError(new Error("Gemini embed 响应 JSON 解析失败"), {
          providerId: "gemini",
          modelId: model,
        });
      }
      return { embeddings: data.embeddings.map((e) => e.values), warnings: [] };
    },
    maxEmbeddingsPerCall: 512,
    modelId: model,
    provider: "gemini",
    specificationVersion: "v3",
    supportsParallelCalls: true,
  } satisfies EmbeddingModel;
}

// ─── 公共 API ───────────────────────────────────────────────────

export async function embedText(
  config: AppConfigSchema,
  text: string,
  options: EmbeddingOptions = {},
): Promise<EmbeddingResult> {
  // 边界条件：空文本检查
  if (!text || text.trim().length === 0) {
    throw new Error("embedText: 文本不能为空");
  }

  // 边界条件：超长文本警告（大多数 embedding 模型限制在 8192 tokens）
  const MAX_TEXT_LENGTH = 50000; // 约 12500 tokens（保守估计）
  if (text.length > MAX_TEXT_LENGTH) {
    log.warn(`文本过长 (${text.length} 字符)，可能被截断或拒绝`, {
      eventType: "embedding.text-too-long",
      length: text.length,
      maxLength: MAX_TEXT_LENGTH,
    });
  }

  const embCfg = options.providerId
    ? getEmbeddingConfigForProvider(config, options.providerId)
    : getEmbeddingConfig(config);
  const model = createEmbeddingModel(embCfg, options.model);

  log.debug(`生成 Embedding: "${text.slice(0, 40)}..." provider=${embCfg.type} model=${embCfg.model}`);
  const result = await embed({
    maxRetries: options.maxRetries ?? 2,
    model,
    providerOptions: dimensionsProviderOptions(embCfg),
    value: text,
  });

  return { embedding: result.embedding, text };
}

export async function embedTexts(
  config: AppConfigSchema,
  texts: string[],
  options: EmbeddingOptions = {},
): Promise<EmbeddingResult[]> {
  // 边界条件：过滤空字符串，避免 API 报错
  const validTexts = texts.filter((t) => t && t.trim().length > 0);
  if (validTexts.length === 0) {
    return [];
  }

  const embCfg = options.providerId
    ? getEmbeddingConfigForProvider(config, options.providerId)
    : getEmbeddingConfig(config);
  const model = createEmbeddingModel(embCfg, options.model);

  log.debug(`批量 Embedding: ${validTexts.length} 条, provider=${embCfg.type} model=${embCfg.model}`);
  const result = await embedMany({
    maxRetries: options.maxRetries ?? 2,
    model,
    providerOptions: dimensionsProviderOptions(embCfg),
    values: validTexts,
  });

  return validTexts.map((text, i) => ({
    embedding: result.embeddings[i] ?? [],
    text,
  }));
}

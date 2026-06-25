# API Module — AI 调用基础设施

## 整体定位

API 模块是系统的 AI 调用基础设施层，负责封装所有与大模型 Provider 的交互逻辑。它位于业务逻辑（`@agent`、`@conversation`、`@compress` 等）与底层 AI SDK（`@ai-sdk`）之间，提供统一的调用入口、容错策略、流式处理和辅助工具。

## 核心功能

1. **统一 LLM 调用** — 流式对话（`streamLlm`）、单次补全（`completeLlm`）、高层语义化接口（`chat`）
2. **Provider 路由** — 根据配置自动选择 Provider（OpenAI / Anthropic / Gemini），支持实例缓存
3. **自动降级探测** — 请求失败时按降级链（chat → responses → claude → gemini）自动切换方法
4. **容错保护** — 熔断器（Circuit Breaker）、健康检查、错误分类与友好提示
5. **流式处理** — 流事件分发、流中间件管道、SSE 兼容归一化
6. **专用 API** — 文本向量化（Embedding）、搜索结果重排序（Rerank）
7. **通用工具** — 内存缓存（TTL/LRU）、请求去重、Token 预算控制

## 目录结构

```
src/api/
├── index.ts              # 统一出入口，所有外部引用必须通过此文件
├── type.ts               # 纯类型 re-export barrel（type-only imports 使用）
│
├── core/                 # 核心调用层
│   ├── llm.ts            # 流式对话引擎（streamLlm / completeLlm）
│   ├── chat.ts           # 高层语义化对话接口（chat / chatComplete，含参数校验和 usage 聚合）
│   ├── provider.ts       # Provider 工厂、路由、实例缓存
│   ├── modelRegistry.ts   # 模型信息、能力声明与查询（listAllModels / searchModels 等）
│   └── errorHandler.ts   # 错误分类、友好提示、可恢复性判断（统一关键词规则）
│
├── stream/               # 流式处理基础设施
│   ├── streamHandler.ts  # 单次 streamText 调用执行、超时控制
│   ├── visionRouter.ts   # Vision 路由（多模态请求的 Provider/模型自动切换）
│   ├── streamMiddleware.ts # 流中间件管道（文本过滤、事件日志等）
│   └── sseCompat.ts      # SSE 兼容性归一化（OpenAI 兼容 API）
│
├── resilience/           # 容错与弹性策略
│   ├── circuitBreaker.ts # 熔断器（CLOSED → OPEN → HALF_OPEN）
│   ├── fallback.ts       # 降级探测引擎（自动切换 requestMethod）
│   └── providerHealth.ts # Provider 健康检查
│
├── specialized/          # 专用 AI 端点
│   ├── embedding.ts      # 文本向量化（多 Provider 路由）
│   └── rerank.ts         # 搜索结果重排序
│
└── utils/                # 通用工具
    ├── cache.ts          # 通用内存缓存（TTL、LRU、批量操作）
    ├── requestDedup.ts   # 请求去重（防止并发重复请求）
    ├── tokenBudget.ts    # Token 预算控制器（多层级预算跟踪）
    ├── retry.ts          # 指数退避重试工具（Exponential Backoff）
    ├── fetchTimeout.ts   # 带超时的 fetch 封装（AbortController + setTimeout）
    └── tokenEstimator.ts # Token 估算工具（中英文混合文本估算）
```

## 子模块说明

| 子模块                      | 职责                | 核心导出                                                                                                                                            |
| --------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/llm`                  | 流式对话引擎        | `streamLlm`, `completeLlm`, `LlmOptions`, `LlmStreamEvent`                                                                                          |
| `core/chat`                 | 高层语义化门面      | `chat`, `chatComplete`, `ChatResult`（内部委托 `completeLlm`，提供参数校验与日志；当前为便捷API预留，外部模块直接使用 `streamLlm` / `completeLlm`） |
| `core/provider`             | Provider 工厂与路由 | `createProvider`, `getDefaultModelId`, `listConfiguredProviders`                                                                                    |
| `core/modelRegistry`        | 模型信息与能力查询  | `listAllModels`, `listModelsByProvider`, `getDefaultModel`, `searchModels`, `getModelCapabilities`                                                  |
| `core/errorHandler`         | 错误处理            | `toApiAppError`, `getFriendlyError`, `isRecoverableError`, `classifyError`                                                                          |
| `stream/streamHandler`      | 流式调用执行        | `doStreamCall`                                                                                                                                      |
| `stream/visionRouter`       | Vision 路由         | `resolveStreamRuntime`, `StreamRuntime`, `hasVisionContent`, `buildVisionProviderConfig`                                                            |
| `stream/streamMiddleware`   | 流中间件            | `StreamMiddlewarePipeline`, `createSensitiveWordFilter`                                                                                             |
| `stream/sseCompat`          | SSE 兼容            | `_sseCompat`                                                                                                                                        |
| `resilience/circuitBreaker` | 熔断器              | `CircuitBreaker`, `getCircuitBreaker`, `clearCircuitBreakers`                                                                                       |
| `resilience/fallback`       | 降级探测            | `getVerifiedMethod`, `probeFallback`, `setVerifiedMethod`, `stopFallbackCleanup`                                                                    |
| `resilience/providerHealth` | 健康检查            | `checkProviderHealth`, `checkAllProvidersHealth`                                                                                                    |
| `specialized/embedding`     | 文本向量化          | `embedTexts`, `getEmbeddingConfig`, `createEmbeddingModel`                                                                                          |
| `specialized/rerank`        | 重排序              | `rerank`, `fitDocumentsToContext`                                                                                                                   |
| `utils/cache`               | 通用缓存            | `Cache`, `getOrCreateCache`                                                                                                                         |
| `utils/requestDedup`        | 请求去重            | `withRequestDedup`, `clearRequestDedup`, `stopDedupCleanup`                                                                                         |
| `utils/tokenBudget`         | Token 预算          | `TokenBudgetController`, `getOrCreateBudget`                                                                                                        |
| `utils/retry`               | 指数退避重试        | `retryWithBackoff`, `createRetryWrapper`                                                                                                            |
| `utils/fetchTimeout`        | 超时 fetch          | `fetchWithTimeout`                                                                                                                                  |
| `utils/tokenEstimator`      | Token 估算          | `estimateTextTokens`, `estimateMessagesTokens`                                                                                                      |

## 使用方法

### 从外部模块引用

所有外部模块应通过 `@api` 统一入口引用，**禁止**直接引用子目录路径：

```typescript
import {
  // LLM 调用
  streamLlm,
  completeLlm,
  chat,
  chatComplete,

  // Provider
  createProvider,
  getDefaultModelId,

  // 错误处理
  getFriendlyError,
  isRecoverableError,

  // 容错
  CircuitBreaker,
  getVerifiedMethod,
  probeFallback,

  // 专用 API
  embedTexts,
  rerank,

  // 工具
  Cache,
  getOrCreateCache,
  withRequestDedup,
  TokenBudgetController,

  // 类型
  type LlmOptions,
  type LlmStreamEvent,
  type LlmTokenUsage,
  type ChatResult,
} from "@api";
```

### 流式对话

```typescript
import { streamLlm } from "@api";

const stream = streamLlm(config, messages, {
  maxTokens: 4096,
  temperature: 0.7,
});

for await (const event of stream) {
  switch (event.type) {
    case "text-delta":
      process.stdout.write(event.text);
      break;
    case "done":
      console.log("\nUsage:", event.usage);
      break;
    case "error":
      console.error("Error:", event.error);
      break;
  }
}
```

### 单次补全

```typescript
import { completeLlm } from "@api";

const result = await completeLlm(config, messages, {
  maxTokens: 1024,
});
console.log(result.text); // 完整文本内容
console.log(result.reasoning); // 推理内容（如有）
console.log(result.usage); // Token 用量统计
```

### 非流式对话（chatComplete）

```typescript
import { chatComplete } from "@api";

const result = await chatComplete(config, messages, {
  maxTokens: 4096,
});
console.log("文本:", result.text);
console.log("推理:", result.reasoning);
console.log("用量:", result.usage);
```

### Provider 管理

```typescript
import { createProvider, getDefaultModelId, listConfiguredProviders } from "@api";

// 获取默认模型
const modelId = getDefaultModelId(config);

// 列出可用 Provider
const providers = listConfiguredProviders(config);

// 创建 Provider 工厂
const providerFactory = createProvider(config, "openai");
const model = providerFactory(modelId);
```

### 降级探测

```typescript
import { getVerifiedMethod, probeFallback } from "@api";

// 获取已验证可用的方法
const method = getVerifiedMethod(config, "openai", "gpt-4");

// 手动触发降级探测
const newMethod = await probeFallback(config, "openai", "chat", "gpt-4");
```

### 熔断器

```typescript
import { getCircuitBreaker } from "@api";

const breaker = getCircuitBreaker("openai", "gpt-4");
// 熔断器保护通过 withCircuitBreaker 包装异步生成器
for await (const event of withCircuitBreaker(breaker, () => doStreamCall(...))) {
  // 处理事件
}
```

### 文本向量化

```typescript
import { embedTexts, getEmbeddingConfig } from "@api";

const embConfig = getEmbeddingConfig(config);
const embeddings = await embedTexts(config, ["Hello", "World"]);
```

### 缓存

```typescript
import { getOrCreateCache } from "@api";

const cache = getOrCreateCache("my-cache", { capacity: 1000, defaultTtlMs: 60000 });
cache.set("key", "value");
const value = cache.get("key");
```

## 与外部系统的交互

| 外部模块                 | 交互方式 | 说明                                      |
| ------------------------ | -------- | ----------------------------------------- |
| `@ai-sdk`                | 调用 LLM | `streamText`、`createProvider` 等底层调用 |
| `@schema/config`         | 读取配置 | Provider 配置、模型配置、降级链配置       |
| `@core/logger`           | 日志记录 | 调用日志、错误日志                        |
| `@core/errors/appError`  | 错误创建 | 结构化错误载荷                            |
| `@bus/eventBus`          | 事件分发 | Provider 状态、LLM 重试事件               |
| `@session/sessionStatus` | 会话状态 | 设置会话状态（streamLlm 内部使用）        |
| `@agent`                 | 调用 LLM | 所有 Agent 通过 `@api` 调用 LLM           |
| `@conversation`          | 调用 LLM | 对话循环通过 `@api` 调用 LLM              |
| `@compress`              | 调用 LLM | 压缩 Agent 通过 `@api` 调用 LLM           |

## 降级链

```
chat → responses → claude → gemini
```

当某个方法失败时，`fallback.ts` 按此顺序依次探测，找到可用方法后回写配置并缓存。

## 配置项

通过 `AppConfigSchema`（定义在 `@schema/config`）控制 API 行为：

| 配置项                             | 说明                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `defaultProvider`                  | 默认 Provider 配置（providerId、modelId）                            |
| `providers`                        | 所有 Provider 配置列表                                               |
| `fallbackChain`                    | 自定义降级链顺序                                                     |
| `codebase.embedding.type`          | Embedding Provider 类型                                              |
| `providerConfig.*.visionProvider`  | Vision 专用 Provider ID（可选）                                      |
| `providerConfig.*.visionModel`     | Vision 专用模型 ID（可选）                                           |
| `providerConfig.*.visionBaseURL`   | Vision 专用 baseURL（可选）                                          |
| `providerConfig.*.thinking`        | 思考模式配置（enabled、budgetTokens）                                |
| `providerConfig.*.modelThinking`   | 按模型细粒度思考模式配置，优先级高于 `thinking`                      |
| `providerConfig.*.requestThinking` | 按 requestMethod 细粒度思考模式配置                                  |
| `providerConfig.*.reasoningEffort` | 推理强度（仅 chat/responses 模式，影响 OpenAI reasoningEffort 参数） |
| `providerConfig.*.promptCaching`   | 提示缓存配置（`{ enabled: boolean }`，默认启用）                     |
| `providerConfig.*.customHeaders`   | 自定义 HTTP 请求头（键值对，透传到 Provider）                        |
| `rerank.maxContextTokens`          | Rerank 最大上下文 Token 数                                           |
| `rerank.maxDocumentRatio`          | Rerank 单文档最大占比（默认 0.3）                                    |

## 废弃模块清理

| 模块             | 状态      | 说明                                                                          |
| ---------------- | --------- | ----------------------------------------------------------------------------- |
| `core/models.ts` | ✅ 已移除 | 重新导出链 `models → provider → modelRegistry`，现直接从 `modelRegistry` 导入 |

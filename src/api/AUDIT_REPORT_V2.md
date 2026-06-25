# src/api 模块全面代码审计报告（第二轮）

**审计日期**: 2026-06-17  
**审计范围**: `/src/api` 全部 18 个 TS 文件 + index.ts + type.ts + README.md  
**审计方法**: 逐文件全量阅读 + Grep 交叉验证 + 依赖链追踪

---

## 📊 总体评价

**整体质量**: ⭐⭐⭐⭐ (4/5) — 模块架构清晰、职责划分合理、容错机制完善、注释规范度高。经过首轮修复后，关键安全漏洞和闭包陷阱已消除，新增了 retry、tokenEstimator 等独立工具模块。但仍存在若干可改进点。

---

## 1. 运行稳定性与可靠性

### 🔴 Critical — 无

### 🟠 High

**H-1: `streamHandler.ts` 中 `normalizeUsage` 使用 `Record<string, any>` — 类型安全漏洞**

- **位置**: `stream/streamHandler.ts:122-130`
- **描述**: `normalizeUsage` 函数将 `raw` 对象断言为 `Record<string, any>`，并在内部多处使用 `as Record<string, any>`。虽然 `asNumber()` 对每个字段做了类型窄化，但中间变量仍为 `any`，违反项目"无 any 滥用"原则。
- **影响**: 静态分析无法捕获拼写错误或结构变更。
- **方案**: 定义 `RawUsage` 接口（所有字段为 `unknown`），统一 `as Record<string, unknown>` 斿换，由 `asNumber()` 做最终窄化。

**H-2: `sseCompat.ts` 中 `wrapOpenAICompatibleChatFetch` 的 `as any` 斿换**

- **位置**: `stream/sseCompat.ts:205`
- **描述**: `(baseFetch as any).preconnect?.bind(baseFetch)` — `as any` 绕过了类型检查。
- **影响**: 如果 `baseFetch` 没有 `preconnect` 属性，TypeScript 不会报错。
- **方案**: 定义 `ExtendedFetch` 类型 `typeof fetch & { preconnect?: (url: string) => void }`，或使用类型窄化 `if ("preconnect" in baseFetch)`。

**H-3: `requestDedup.ts` 中 `withRequestDedup` 的 Promise 链缺少错误隔离**

- **位置**: `utils/requestDedup.ts:49-75`
- **描述**: 当 `factory()` 抛出错误时，`pending.reject(error)` 被调用，但所有等待相同 key 的消费者都会收到同一个 Error 对象。如果其中一个消费者已经处理了该 Error（如添加了额外属性），其他消费者可能收到被污染的 Error。
- **影响**: 多消费者场景下可能导致意外行为。
- **方案**: 在 `catch` 块中创建新的 Error 对象传递给 reject，保留原始 message 和 stack。

### 🟡 Medium

**M-1: `fallback.ts` 中 `probeOnce` 的 streamText 结果未完全消费**

- **位置**: `resilience/fallback.ts:248-266`
- **描述**: `probeOnce` 在收到第一个 `text-delta` 或 `tool-call` 后立即 `break` 退出循环，但 `result` 对象（streamText 返回值）可能持有未释放的资源（如网络连接、AbortController）。
- **影响**: 可能导致连接泄漏。
- **方案**: 在 break 后显式调用 `result.text` 或类似方法消费剩余流，或在 break 后调用 controller.abort() 释放连接。

**M-2: `cache.ts` 中 `dispose()` 方法未被任何外部调用方使用**

- **位置**: `utils/cache.ts:79-85`
- **描述**: `Cache` 类新增了 `dispose()` 方法用于停止后台定时清理，但 `getOrCreateCache()` 返回的实例被存入 `globalCaches`，没有任何调用方在移除缓存时调用 `dispose()`。`removeCache()` 和 `clearAllCaches()` 只删除了 Map 引用，未停止定时器。
- **影响**: 即使调用 `clearAllCaches()`，所有 Cache 实例的后台清理定时器仍在运行（虽然有 `.unref()`，但语义上不一致）。
- **方案**: 在 `removeCache()` 中先调用 `cache.dispose()`，在 `clearAllCaches()` 中遍历所有 cache 调用 `dispose()`。

**M-3: `tokenBudget.ts` 中 `console.warn` 应改为结构化日志**

- **位置**: `utils/tokenBudget.ts:84`
- **描述**: 溢出保护使用了 `console.warn` 而非项目标准的 `createLogger`。
- **影响**: 日志不统一，无法通过日志系统收集和分析。
- **方案**: 引入 `createLogger("token-budget")` 并使用 `log.warn()` 替代 `console.warn`。

**M-4: `sseCompat.ts` 中 `console.warn` 应改为结构化日志**

- **位置**: `stream/sseCompat.ts:153,161`
- **描述**: SSE 缓冲区溢出警告使用了 `console.warn` 而非项目标准的 `createLogger`。
- **影响**: 同 M-3。
- **方案**: 引入 `createLogger("sse-compat")` 并使用 `log.warn()` 替代 `console.warn`。

**M-5: `requestDedup.ts` 中 `console.warn` 应改为结构化日志**

- **位置**: `utils/requestDedup.ts:64`
- **描述**: pending request 过期警告使用了 `console.warn`。
- **方案**: 引入 `createLogger("request-dedup")` 并使用 `log.warn()`。

**M-6: `streamHandler.ts` 中 `retryWithBackoff` 与 `utils/retry.ts` 的 `retryWithBackoff` 名称冲突**

- **位置**: `stream/streamHandler.ts:168-196` vs `utils/retry.ts`
- **描述**: `streamHandler.ts` 内部定义了一个局部 `retryWithBackoff` 函数（Codex 风格 5 次重试），与 `utils/retry.ts` 导出的同名公共函数完全不同。虽然作用域不冲突（一个是局部函数、一个是导出），但代码阅读时容易混淆。
- **影响**: 维护时可能误用错误的版本。
- **方案**: 将 `streamHandler.ts` 中的局部函数重命名为 `retryStreamWithBackoff` 或 `streamRetryWithBackoff`，明确区分语义。

**M-7: `provider.ts` 中 Provider 缓存使用 WeakMap + Map 二级结构，但无主动过期清理**

- **位置**: `core/provider.ts:60-82`
- **描述**: `providerCache` 使用 `WeakMap<AppConfigSchema, Map<string, ...>>` 结构。虽然 `isCacheExpired()` 在每次 `createProvider` 时检查 TTL，但过期条目只是被跳过（重新创建），不会从 Map 中删除。随着配置热更新，旧 Map 中可能积累大量过期条目。
- **影响**: 内存浪费（虽然量级很小，每个条目仅一个工厂函数引用）。
- **方案**: 在检测到过期时，调用 `cache.delete(key)` 主动移除过期条目。

**M-8: `fallback.ts` 中 `cleanupExpiredVerifiedMethods` 未被任何调用方自动触发**

- **位置**: `resilience/fallback.ts:317-330`
- **描述**: 新增的 `cleanupExpiredVerifiedMethods()` 函数虽然已导出，但没有在任何地方被自动调用（没有定时器、没有在 `getVerifiedMethod` 中主动触发）。
- **影响**: 过期缓存仅在下次 `getVerifiedMethod` 调用时才被惰性删除，大量过期条目可能长期驻留内存。
- **方案**: 在 `getVerifiedMethod` 入口处调用 `cleanupExpiredVerifiedMethods()`，或添加后台定时清理。

---

## 2. 模块设计与职责边界

### 🟠 High

**H-4: `streamHandler.ts` 职责过重 — 承担了 6+ 个不同职责**

- **位置**: `stream/streamHandler.ts` (全文约 350 行)
- **描述**: 该文件承担了以下职责：
  1. Vision 内容检测与路由 (`hasVisionContent`, `resolveStreamRuntime`, `buildVisionRuntimeConfig`)
  2. SSE/流式调用执行 (`doStreamCall`)
  3. Token usage 归一化 (`normalizeUsage`, `asNumber`)
  4. Thinking/reasoning 配置构建 (`resolveThinkingConfig`, `buildAnthropicOptions`, `buildGoogleOptions`)
  5. Prompt caching key 构建 (`buildPromptCacheKey`)
  6. 重试逻辑 (`retryWithBackoff` 局部函数)
- **影响**: 修改任何一个职责都可能影响其他职责，测试和审查困难。
- **方案**: 拆分为：
  - `stream/visionRouter.ts` — Vision 检测与路由
  - `stream/usageNormalizer.ts` — Token usage 归一化
  - `stream/thinkingConfig.ts` — Thinking/reasoning 配置构建
  - `streamHandler.ts` 仅保留 `doStreamCall` 核心流程编排

### 🟡 Medium

**M-9: `provider.ts` 同时承担 Provider 工厂 + 模型列表查询 + 模型能力查询**

- **位置**: `core/provider.ts` (全文约 330 行)
- **描述**: `provider.ts` 包含：
  1. Provider 实例创建与缓存 (`createProvider`, `createModelFactory`, 各 Provider 工厂函数)
  2. 模型列表查询 (`listAllModels`, `listModelsByProvider`, `searchModels`, `getDefaultModel`)
  3. 模型能力查询 (`getCapabilities`, `getModelCapabilities`, `MODEL_OVERRIDES`)
  4. SSE 兼容性引用 (`_sseCompat`, `normalizeOpenAICompatibleBaseURL`)
- **影响**: 模型查询和能力映射与 Provider 创建无直接关系，混合在一起增加了理解成本。
- **方案**: 将模型列表和能力查询移回 `models.ts`（当前 `models.ts` 仅做转发），让 `provider.ts` 专注 Provider 工厂。

**M-10: `models.ts` 仅做转发，成为空壳模块**

- **位置**: `core/models.ts`
- **描述**: `models.ts` 标注 `@deprecated` 并仅从 `provider.ts` 转发所有导出。但 `provider.ts` 本身已经过重（M-9），而 `models.ts` 的原始职责（模型列表和能力查询）反而在 `provider.ts` 中实现。
- **影响**: `@deprecated` 标注与实际代码分布矛盾 — 用户被引导去用更重的 `provider.ts`。
- **方案**: 如 M-9 所述，将模型相关逻辑迁回 `models.ts`，取消 `@deprecated` 标注。

**M-11: `fallback.ts` 中 `fallbackDeps` 对象的可变性问题**

- **位置**: `resilience/fallback.ts:46-55`
- **描述**: `fallbackDeps` 是一个普通对象，`__setFallbackDepsForTesting` 使用 `Object.assign` 修改它。虽然仅用于测试，但生产代码中 `fallbackDeps` 的属性是可变的，理论上任何代码都可以修改。
- **影响**: 降低了代码的可信赖度。
- **方案**: 将 `fallbackDeps` 的生产属性设为不可写（`Object.defineProperty` + `writable: false`），仅测试覆写函数临时解锁。

---

## 3. 类型安全与注释规范

### 🟠 High

**H-5: `streamHandler.ts` 中 `normalizeUsage` 的 `Record<string, any>` 滥用**

- 详见 H-1。

**H-6: `sseCompat.ts` 中 `as any` 斿换**

- 详见 H-2。

### 🟡 Medium

**M-12: `rerank.ts` 中 `doRerank` 返回值类型使用了 `as unknown as Awaited<...>` 强制断言**

- **位置**: `specialized/rerank.ts:193-199`
- **描述**: `createRerankingModel` 返回的 `doRerank` 结果经过多层 `as unknown as` 斿换才匹配 `RerankingModelV3` 接口。这表明接口定义与实际实现之间存在结构不匹配。
- **影响**: 类型断言掩盖了真实的不匹配，未来 SDK 升级可能导致运行时错误而编译无警告。
- **方案**: 定义 `RerankResponse` 中间类型，逐步窄化而非一次性 `as unknown as`。

**M-13: `tokenBudget.ts` 中 `createBudgetMiddleware` 的导入类型使用字符串路径**

- **位置**: `utils/tokenBudget.ts:120-130`
- **描述**: `createBudgetMiddleware` 内部使用 `import("../core/llm").LlmStreamEvent` 字符串导入类型。虽然 TypeScript 支持，但这种写法不如顶层 `import type` 清晰。
- **影响**: 代码风格不一致（其他文件都使用顶层导入）。
- **方案**: 在文件顶部添加 `import type { LlmStreamEvent } from "../core/llm"`。

**M-14: `retry.ts` 中 `RetryResult` 接口未导出**

- **位置**: `utils/retry.ts:38-44`
- **描述**: `RetryResult<T>` 是 `interface`（非 `type`），但未在 `index.ts` 或 `type.ts` 中导出。用户无法在类型位置引用它。
- **影响**: `createRetryWrapper` 返回 `Promise<RetryResult<T>>`，但调用方无法声明变量类型。
- **方案**: 在 `type.ts` 中添加 `export type { RetryResult } from "./utils/retry"`，并在 `index.ts` 中导出。

**M-15: `providerHealth.ts` 中 `checkAllProvidersHealth` 返回结果的 `providerId` 映射可能错误**

- **位置**: `resilience/providerHealth.ts:82-92`
- **描述**: `results.map()` 中使用 `providers[results.indexOf(r)]` 获取 providerId。当 `Promise.allSettled` 返回的结果顺序与输入顺序一致时这没问题，但 `indexOf` 在有重复值时可能返回错误索引。
- **影响**: 虽然 `providers` 列表通常无重复，但逻辑不够健壮。
- **方案**: 使用 `results.map((r, i) => ...)` 直接用索引 `i` 对应 `providers[i]`。

### 🟢 Low

**L-1: `errorHandler.ts` 中 `extractErrorDetail` 的 `as unknown as Record<string, unknown>` 模式**

- **位置**: `core/errorHandler.ts:170-180`
- **描述**: 使用 `const anyErr = err as unknown as Record<string, unknown>` 访问非标准属性。虽然注释说明了原因，但 `as unknown as` 是双重断言，风险高于单次断言。
- **影响**: 低风险 — 函数仅做读取操作，不修改对象。
- **方案**: 可接受，但建议添加 `// SAFETY: 仅读取已知可能存在的非标准属性，不做修改` 注释。

**L-2: `streamMiddleware.ts` 中 `createEventCounter` 的计数器无法外部读取**

- **位置**: `stream/streamMiddleware.ts:135-145`
- **描述**: `createEventCounter` 返回的中间件内部维护 `counts` 对象，但没有提供读取接口。用户无法获取计数结果。
- **影响**: 功能不完整。
- **方案**: 在返回的中间件对象上添加 `getCounts()` 方法，或返回 `{ middleware, getCounts }` 组合。

---

## 4. 依赖关系与调用链路

### 🟡 Medium

**M-16: `llm.ts` → `fallback.ts` → `provider.ts` 的三层跨模块调用链**

- **描述**: 调用链路为：

  ```
  llm.ts → fallback.ts (getVerifiedMethod, probeFallback, setVerifiedMethod)
  llm.ts → circuitBreaker.ts (getCircuitBreaker, withCircuitBreaker)
  llm.ts → streamHandler.ts (doStreamCall)
  llm.ts → tokenEstimator.ts (estimateMessagesTokens)
  llm.ts → errorHandler.ts (extractErrorDetail, isRecoverableError, toApiAppError)

  fallback.ts → provider.ts (createProvider, getProviderConfig)
  streamHandler.ts → provider.ts (createProvider)
  streamHandler.ts → fallback.ts (getVerifiedMethod)
  streamHandler.ts → errorHandler.ts (isRecoverableError)
  streamHandler.ts → streamMiddleware.ts (getGlobalMiddlewarePipeline, wrapStreamWithMiddleware)

  provider.ts → sseCompat.ts (_sseCompat)
  providerHealth.ts → provider.ts (listConfiguredProviders)
  ```

- **分析**:
  - ✅ **无循环依赖**: 所有依赖方向一致（core → resilience → stream → utils）
  - ⚠️ **跨层调用**: `streamHandler.ts` 同时依赖 `core/provider`、`resilience/fallback`、`core/errorHandler`，跨越了三个子模块层级
  - ⚠️ **hub 依赖**: `provider.ts` 被 4 个模块依赖（llm, fallback, streamHandler, providerHealth），是依赖枢纽
- **方案**: 考虑将 `provider.ts` 的查询函数（`listConfiguredProviders`, `getProviderConfig`）提取到独立的 `providerQuery.ts`，减少 hub 模块重量。

**M-17: `rerank.ts` 依赖 `@/session/token/tokenCounterRef` — 跨层依赖**

- **位置**: `specialized/rerank.ts:37`
- **描述**: `rerank.ts` 导入了 `estimateTokens` from `@/session/token/tokenCounterRef`，这是 `api` 模块对 `session` 模块的跨层依赖。
- **影响**: `api` 模块本应是底层基础设施，不应依赖上层 `session` 模块。`tokenEstimator.ts` 已经在 `api/utils` 中提供了本地估算，但 `rerank.ts` 未使用它。
- **方案**: 将 `rerank.ts` 的 `estimateTokens` 替换为 `api/utils/tokenEstimator.ts` 的 `estimateTextTokens`，消除跨层依赖。

**M-18: `tokenBudget.ts` 重新导出 `estimateTokens` from `@/session/token/tokenCounterRef`**

- **位置**: `utils/tokenBudget.ts:113`
- **描述**: `export { estimateTokens } from "@/session/token/tokenCounterRef"` — `api` 的 `utils` 子模块重新导出了 `session` 层的函数。
- **影响**: 同 M-17，跨层依赖。
- **方案**: 移除此重新导出。如果外部需要 `estimateTokens`，应直接从 `@/session` 导入。

---

## 5. README.md 与实际代码一致性

### 🟠 High

**H-7: README.md 目录结构缺少 `utils/retry.ts` 和 `utils/tokenEstimator.ts`**

- **位置**: `README.md` 目录结构部分
- **描述**: README 的目录树只列出了 `cache.ts`、`requestDedup.ts`、`tokenBudget.ts`，缺少新增的 `retry.ts` 和 `tokenEstimator.ts`。
- **影响**: 文档与实际不一致，新用户无法发现这些工具。
- **方案**: 在目录树和子模块说明表中添加：
  ```
  utils/
  ├── cache.ts          # 通用内存缓存
  ├── requestDedup.ts   # 请求去重
  ├── tokenBudget.ts    # Token 预算控制
  ├── retry.ts          # 指数退避重试
  └── tokenEstimator.ts # Token 估算
  ```

**H-8: README.md 子模块说明表缺少 `utils/retry` 和 `utils/tokenEstimator`**

- **位置**: README.md 子模块说明表
- **描述**: 表格中缺少 `utils/retry`（`retryWithBackoff`, `createRetryWrapper`）和 `utils/tokenEstimator`（`estimateTextTokens`, `estimateMessageTokens`, `estimateMessagesTokens`）的条目。
- **方案**: 在表格中添加对应行。

### 🟡 Medium

**M-19: README.md 使用示例中 `embedTexts` 的签名与实际不一致**

- **位置**: README.md "文本向量化" 部分
- **描述**: 示例写法为 `embedTexts(embConfig, ["Hello", "World"])`，但实际签名是 `embedTexts(config, texts, options)` — 第一个参数是 `AppConfigSchema` 而非 `NormalizedEmbeddingConfig`。
- **影响**: 用户按文档写代码会编译报错。
- **方案**: 修正为 `embedTexts(config, ["Hello", "World"])`。

**M-20: README.md 缓存示例中 `getOrCreateCache` 的选项名与实际不一致**

- **位置**: README.md "缓存" 部分
- **描述**: 示例写法为 `getOrCreateCache("my-cache", { ttl: 60000, maxSize: 1000 })`，但实际 `CacheOptions` 的字段名为 `defaultTtlMs` 和 `capacity`。
- **影响**: 用户按文档写代码会编译报错。
- **方案**: 修正为 `getOrCreateCache("my-cache", { defaultTtlMs: 60000, capacity: 1000 })`。

**M-21: README.md 熔断器示例中 `breaker.execute()` 方法不存在**

- **位置**: README.md "熔断器" 部分
- **描述**: 示例写法为 `breaker.execute(async () => { ... })`，但 `CircuitBreaker` 类没有 `execute` 方法。实际使用方式是 `withCircuitBreaker(breaker, genFactory)`。
- **影响**: 用户按文档写代码会运行报错。
- **方案**: 修正为使用 `withCircuitBreaker` 的正确示例。

**M-22: README.md "与外部系统的交互" 表中 `@session/sessionStatus` 描述不准确**

- **位置**: README.md 外部交互表
- **描述**: 表格称 `streamLlm` 内部使用 `@session/sessionStatus`，但实际代码已改为通过 EventBus 发布 `AppEvent.LlmRetry` 事件，不再直接调用 `setSessionStatus`。
- **影响**: 文档描述了已移除的耦合关系。
- **方案**: 更新描述为"通过 EventBus 发布 LlmRetry 事件，由 conversationHandler 订阅后设置会话状态"。

---

## 6. 问题汇总与优先级

| ID   | 严重度    | 类别     | 位置                | 简述                         |
| ---- | --------- | -------- | ------------------- | ---------------------------- |
| H-1  | 🟠 High   | 类型安全 | streamHandler.ts    | `Record<string, any>` 滥用   |
| H-2  | 🟠 High   | 类型安全 | sseCompat.ts        | `as any` 斿换                |
| H-3  | 🟠 High   | 可靠性   | requestDedup.ts     | Promise 错误隔离不足         |
| H-4  | 🟠 High   | 架构设计 | streamHandler.ts    | 职责过重(6+职责)             |
| H-5  | 🟠 High   | 类型安全 | streamHandler.ts    | 同 H-1                       |
| H-6  | 🟠 High   | 类型安全 | sseCompat.ts        | 同 H-2                       |
| H-7  | 🟠 High   | 文档一致 | README.md           | 缺少 retry/tokenEstimator    |
| H-8  | 🟠 High   | 文档一致 | README.md           | 子模块表缺少新模块           |
| M-1  | 🟡 Medium | 可靠性   | fallback.ts         | probeOnce 流未完全消费       |
| M-2  | 🟡 Medium | 可靠性   | cache.ts            | dispose() 未被调用           |
| M-3  | 🟡 Medium | 规范     | tokenBudget.ts      | console.warn 应改为 log.warn |
| M-4  | 🟡 Medium | 规范     | sseCompat.ts        | console.warn 应改为 log.warn |
| M-5  | 🟡 Medium | 规范     | requestDedup.ts     | console.warn 应改为 log.warn |
| M-6  | 🟡 Medium | 设计     | streamHandler.ts    | retryWithBackoff 名称冲突    |
| M-7  | 🟡 Medium | 可靠性   | provider.ts         | 缓存过期条目未主动删除       |
| M-8  | 🟡 Medium | 可靠性   | fallback.ts         | cleanupExpired 未自动触发    |
| M-9  | 🟡 Medium | 设计     | provider.ts         | 职责混合(工厂+查询+能力)     |
| M-10 | 🟡 Medium | 设计     | models.ts           | 空壳转发模块                 |
| M-11 | 🟡 Medium | 设计     | fallback.ts         | fallbackDeps 可变性          |
| M-12 | 🟡 Medium | 类型安全 | rerank.ts           | `as unknown as` 强制断言     |
| M-13 | 🟡 Medium | 规范     | tokenBudget.ts      | 字符串导入类型               |
| M-14 | 🟡 Medium | 类型安全 | retry.ts            | RetryResult 未导出           |
| M-15 | 🟡 Medium | 可靠性   | providerHealth.ts   | indexOf 可能错误映射         |
| M-16 | 🟡 Medium | 依赖     | 多文件              | 跨层调用链                   |
| M-17 | 🟡 Medium | 依赖     | rerank.ts           | 跨层依赖 session             |
| M-18 | 🟡 Medium | 依赖     | tokenBudget.ts      | 跨层重新导出                 |
| M-19 | 🟡 Medium | 文档     | README.md           | embedTexts 签名不一致        |
| M-20 | 🟡 Medium | 文档     | README.md           | 缓存选项名不一致             |
| M-21 | 🟡 Medium | 文档     | README.md           | 熔断器示例错误               |
| M-22 | 🟡 Medium | 文档     | README.md           | sessionStatus 描述过时       |
| L-1  | 🟢 Low    | 类型安全 | errorHandler.ts     | 双重断言可接受               |
| L-2  | 🟢 Low    | 设计     | streamMiddleware.ts | 计数器无法外部读取           |

---

## 7. 具体优化方案（按优先级排序）

### 第一优先级：立即修复（1-3 天）

**1. 修复 README.md 文档不一致** (H-7, H-8, M-19, M-20, M-21, M-22)

- 添加 `retry.ts` 和 `tokenEstimator.ts` 到目录树和说明表
- 修正 `embedTexts`、缓存、熔断器的使用示例
- 更新外部交互表中 sessionStatus 的描述

**2. 消除 `any` 类型滥用** (H-1, H-2)

- `streamHandler.ts`: 定义 `RawUsage` 接口，替换 `Record<string, any>` 为 `Record<string, unknown>`
- `sseCompat.ts`: 定义 `ExtendedFetch` 类型或使用类型窄化替代 `as any`

**3. 统一日志输出** (M-3, M-4, M-5)

- `tokenBudget.ts`: 引入 `createLogger("token-budget")`
- `sseCompat.ts`: 引入 `createLogger("sse-compat")`
- `requestDedup.ts`: 引入 `createLogger("request-dedup")`

**4. 导出 `RetryResult` 类型** (M-14)

- 在 `type.ts` 和 `index.ts` 中添加导出

### 第二优先级：短期优化（1-2 周）

**5. 修复 `cache.ts` 的 `dispose()` 调用链** (M-2)

- `removeCache()` 中先调用 `cache.dispose()`
- `clearAllCaches()` 中遍历调用 `dispose()`

**6. 修复 `requestDedup.ts` 的错误隔离** (H-3)

- 在 catch 块中创建新 Error 对象传递给 reject

**7. 消除跨层依赖** (M-17, M-18)

- `rerank.ts`: 替换 `estimateTokens` 为本地 `estimateTextTokens`
- `tokenBudget.ts`: 移除 `estimateTokens` 的重新导出

**8. 修复 `fallback.ts` 的缓存清理** (M-8)

- 在 `getVerifiedMethod` 入口处调用 `cleanupExpiredVerifiedMethods()`

**9. 修复 `providerHealth.ts` 的索引映射** (M-15)

- 使用 `results.map((r, i) => ...)` 替代 `indexOf`

**10. 重命名 `streamHandler.ts` 的局部 `retryWithBackoff`** (M-6)

- 改名为 `streamRetryWithBackoff`

### 第三优先级：中期重构（2-4 周）

**11. 拆分 `streamHandler.ts` 职责** (H-4)

- 提取 `visionRouter.ts`、`usageNormalizer.ts`、`thinkingConfig.ts`

**12. 重构 `provider.ts` 职责** (M-9, M-10)

- 将模型查询和能力映射迁回 `models.ts`
- 取消 `models.ts` 的 `@deprecated` 标注

**13. 修复 `rerank.ts` 的类型断言** (M-12)

- 定义中间类型，逐步窄化

**14. 修复 `probeOnce` 的流消费** (M-1)

- break 后 abort 释放连接

**15. 修复 `provider.ts` 缓存过期清理** (M-7)

- 检测过期时主动 `cache.delete(key)`

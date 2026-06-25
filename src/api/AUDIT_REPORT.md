# src/api 模块全面代码审计报告 v2

> **审计日期**: 2026-06-17  
> **审计范围**: `src/api/` 全部 20 个源文件（~5320 行）  
> **审计方法**: 5 维度并行深度审计（5 agent, 365k tokens）  
> **前序**: 基于上一轮 38 个发现修复后的二次审计

---

## 1. 问题汇总

| 严重度           | 数量   | 占比 |
| ---------------- | ------ | ---- |
| 🔴 Critical      | 8      | 7%   |
| 🟠 High          | 22     | 20%  |
| 🟡 Medium        | 42     | 37%  |
| 🟢 Low           | 21     | 19%  |
| ℹ️ 重复/已覆盖   | 19     | 17%  |
| **合计（去重）** | **93** | —    |

### 与上轮对比

| 指标     | 上轮 | 本轮 | 变化                        |
| -------- | ---- | ---- | --------------------------- |
| Critical | 3    | 8    | +5（深入发现更多深层问题）  |
| High     | 9    | 22   | +13（含类型安全和设计维度） |
| 总发现   | 38   | 93   | 审计深度大幅提升            |
| 已修复   | 21   | 21   | —                           |

---

## 2. 🔴 Critical 级问题（8 个）

### C01: SSE Buffer 溢出静默丢数据

- **维度**: 稳定性 | **文件**: `src/api/stream/sseCompat.ts:151`
- **描述**: `bufferOverflowWarningCount` 从不重置，持续增长。更严重的是，`buffer.slice(-keepSize)` 静默丢弃数据，可能将 SSE 事件从中间截断，产生畸形 SSE 数据。没有机制通知消费者数据丢失。
- **修复**: 溢出时调用 `controller.error(new Error('SSE buffer overflow'))` 终止流，而非静默截断。

### C02: streamLlm 349 行上帝函数

- **维度**: 设计 | **文件**: `src/api/core/llm.ts:163`
- **描述**: 混合 7+ 职责：配置解析、token 预算、模型验证、熔断器、性能监控、主流程、fallback 重试。单个 try 块 246 行。
- **修复**: 拆分为 `resolveCallContext()`、`executePrimaryStream()`、`handleFallback()` 三个辅助函数。

### C03: doStreamCall 221 行上帝函数

- **维度**: 设计/共享 | **文件**: `src/api/stream/streamHandler.ts:415`
- **描述**: 混合 9+ 职责：vision 路由、provider 创建、超时、thinking 配置、流处理、中间件、空响应检测。
- **修复**: 拆分为 `buildStreamParams()`、`buildProviderOptions()`、`createRawStreamProcessor()` 组合管线。

### C04: provider.ts 职责混合

- **维度**: 设计 | **文件**: `src/api/core/provider.ts:122`
- **描述**: 混合 Provider 工厂创建+缓存、模型工厂路由、查询/模型列表、模型能力系统、健康检查重导出 5 个不同职责。
- **修复**: 拆分为 `provider.ts`（工厂+缓存）、`modelRegistry.ts`（模型列表+能力）。

### C05: normalizeUsage 使用 `Record<string, any>`

- **维度**: 类型安全 | **文件**: `src/api/stream/streamHandler.ts:118`
- **描述**: 4 处 `as Record<string, any>` 类型断言绕过类型检查。
- **修复**: 改为 `Record<string, unknown>` 并用 typeof guard 保护属性访问。

### C06: sseCompat.ts `as any` 访问 preconnect

- **维度**: 类型安全 | **文件**: `src/api/stream/sseCompat.ts:205`
- **描述**: `(baseFetch as any).preconnect?.bind(baseFetch)` 绕过类型安全。
- **修复**: 定义 `{ preconnect?: (...args: unknown[]) => void }` 接口。

### C07: retryWithBackoff 重复实现

- **维度**: 共享 | **文件**: `src/api/stream/streamHandler.ts:367`（已被 linter 自动移除）
- **描述**: streamHandler.ts 的 `retryWithBackoff` 与 `utils/retry.ts` 实现了相同的指数退避+抖动逻辑，两个独立实现。
- **修复**: 扩展 `retry.ts` 支持 AsyncGenerator 重试变体。

### C08: withFetchTimeout 模式重复 3 处

- **维度**: 共享 | **文件**: `embedding.ts:133`, `rerank.ts:210`, `providerHealth.ts:76`
- **描述**: AbortController + setTimeout + fetch + cleanup 在 3 个模块中重复。
- **修复**: 提取 `withFetchTimeout<T>(url, options, timeoutMs)` 到 `utils/`。

---

## 3. 🟠 High 级问题（22 个）

### 稳定性（5 个）

| ID  | 文件                    | 描述                                                                         |
| --- | ----------------------- | ---------------------------------------------------------------------------- |
| H01 | `cache.ts:253`          | `removeCache()` 未调用 `cache.dispose()`，孤立 interval timer 累积           |
| H02 | `streamHandler.ts:367`  | `retryWithBackoff` 前一个 generator 未显式关闭（abort 路径资源泄漏）         |
| H03 | `circuitBreaker.ts:115` | breakers Map 无界增长，无 TTL/上限                                           |
| H04 | `fallback.ts:85`        | verifiedMethods 无自动清理定时器，`cleanupExpiredVerifiedMethods` 从未被调用 |
| H05 | `requestDedup.ts:133`   | pendingRequests 无周期性清理，冷 key 永久挂起                                |

### 设计（9 个）

| ID  | 文件                   | 描述                                                                                    |
| --- | ---------------------- | --------------------------------------------------------------------------------------- |
| H06 | `models.ts:1`          | 已废弃但仍有 ~10 测试+4 生产文件导入，应彻底移除                                        |
| H07 | `index.ts:94`          | barrel 包含 9 个测试/内部导出（`_`/`__`前缀），污染公共 API                             |
| H08 | `type.ts:1`            | 与 index.ts 类型导出完全重复，零外部消费者                                              |
| H09 | `fallback.ts:374`      | `cleanupExpiredVerifiedMethods` 死代码，从未被调用                                      |
| H10 | `chat.ts:27`           | 3 行空壳函数，日志已被 llm.ts 内部覆盖，零生产消费者                                    |
| H11 | `streamHandler.ts:367` | retryWithBackoff 与 retry.ts 重复（已被 linter 移除）                                   |
| H12 | `llm.ts:163`           | streamLlm 14 字段 LlmOptions + 4 参数，耦合面巨大                                       |
| H13 | `errorHandler.ts:420`  | `classifyError` 与分散的 `toApiAppError/extractErrorDetail/isRecoverableError` 重复调用 |

### 类型安全（6 个）

| ID  | 文件                   | 描述                                                              |
| --- | ---------------------- | ----------------------------------------------------------------- |
| H14 | `rerank.ts:259`        | 三重 `as unknown as` 断言绕过 RerankingModelV3 类型检查           |
| H15 | `rerank.ts:348`        | catch 块 `err as Record<string, unknown>` 未检查 instanceof Error |
| H16 | `sseCompat.ts:20`      | null 检查依赖 `!payload` 但 `typeof null === 'object'` 为 true    |
| H17 | `provider.ts:122`      | `createProvider` 缺少显式返回类型注解                             |
| H18 | `streamHandler.ts:415` | `doStreamCall` 缺少显式返回类型 `AsyncGenerator<LlmStreamEvent>`  |
| H19 | `fallback.ts:141`      | `probeFallback` 缺少显式返回类型 `Promise<RequestMethod \| null>` |

### 依赖关系（2 个）

| ID  | 文件             | 描述                                                        |
| --- | ---------------- | ----------------------------------------------------------- |
| H20 | `provider.ts:49` | core/ → stream/ 层级违规，provider.ts 导入 stream/sseCompat |
| H21 | `rerank.ts:37`   | api/specialized → session/token 跨层耦合，潜在循环依赖      |

---

## 4. 🟡 Medium 级问题（精选 top 20）

### 稳定性

| ID  | 文件                   | 描述                                                                           |
| --- | ---------------------- | ------------------------------------------------------------------------------ |
| M01 | `embedding.ts:139`     | fetch 异常后 response body 未显式 cancel，TCP 连接泄漏                         |
| M02 | `rerank.ts:120`        | `truncateToTokenBudget` 二分查找 O(log N) 调用 estimateTokens，大文档 CPU 开销 |
| M03 | `streamHandler.ts:534` | abort 后 textParts 继续累积被丢弃的数据                                        |
| M04 | `tokenEstimator.ts:71` | `estimateTextTokens` 每次调用创建 RegExp+match 分配大数组                      |
| M05 | `sseCompat.ts:164`     | totalBufferSize 重置为 keepSize 而非实际 buffer.length，追踪不同步             |
| M06 | `provider.ts:57`       | providerCache 内部 Map 过期条目仅在 createProvider 惰性检查时清理              |

### 共享方法

| ID  | 文件                      | 描述                                                                   |
| --- | ------------------------- | ---------------------------------------------------------------------- |
| M07 | `embedding.ts:59,82`      | getEmbeddingConfig 与 getEmbeddingConfigForProvider 几乎相同逻辑重复   |
| M08 | `llm.ts:514`              | buildEffectiveConfig 与 provider.ts 的 WeakMap+Map+TTL 缓存模式重复    |
| M09 | `llm.ts:314`              | 错误处理分散调用 classifyError 应统一                                  |
| M10 | `circuitBreaker.ts:115`   | 4 个模块各自实现 Map 注册表 get/set/delete/clear 模式重复              |
| M11 | `streamHandler.ts:193`    | provider-specific options builder 应提取到 stream/providerOptions.ts   |
| M12 | `rerank.ts:120`           | truncateToTokenBudget 应移到 utils/tokenEstimator.ts 作为共享工具      |
| M13 | `streamMiddleware.ts:142` | createSensitiveWordFilter 每个 chunk 重新编译 RegExp，应在闭包外预编译 |

### 类型/文档

| ID  | 文件                 | 描述                                                               |
| --- | -------------------- | ------------------------------------------------------------------ |
| M14 | `errorHandler.ts:52` | FRIENDLY_ERRORS 使用 `Record<ApiErrorType \| string>` 过于宽泛     |
| M15 | `fallback.ts:263`    | catch 块 `(error as Error).message` 未检查 instanceof Error        |
| M16 | `llm.ts:48`          | performanceMonitor 硬依赖，虽有 perfCallbacks 但默认路径仍引用全局 |
| M17 | 多文件               | 20+ 个公共函数缺少 @param/@returns JSDoc                           |
| M18 | `rerank.ts:148`      | fitDocumentsToContext 公共导出无 JSDoc                             |
| M19 | `index.ts`           | ~70+ 导出的宽 barrel 面增加编译时间，tree-shaking 抵抗             |

---

## 5. 🟢 Low 级问题（精选 top 10）

| ID  | 文件                      | 描述                                                      |
| --- | ------------------------- | --------------------------------------------------------- |
| L01 | `llm.ts:514`              | configCache 内部 Map 无大小上限                           |
| L02 | `tokenBudget.ts:149`      | globalBudgets Map 无自动清理                              |
| L03 | `llm.ts:355`              | fallback 探测期间用户可能等待 30s                         |
| L04 | `requestDedup.ts:39`      | hashMessages 用 JSON.stringify 序列化大消息，阻塞事件循环 |
| L05 | `provider.ts:368`         | getCapabilities 每次调用 toLowerCase 创建临时字符串       |
| L06 | `errorHandler.ts:162`     | pickLocale 与 getFriendlyEntry 功能重复                   |
| L07 | `llm.ts:569`              | completeLlm 的流事件收集模式可提取为共享工具              |
| L08 | `tokenBudget.ts:173`      | estimateTokens 跨模块依赖，与 tokenEstimator 两套估算体系 |
| L09 | `rerank.ts:259`           | doRerank 返回值双 as 断言，接口变更时静默破坏             |
| L10 | `streamMiddleware.ts:138` | escapeRegExp 通用工具定义在中间件模块内                   |

---

## 6. 优先级修复路线图

### P0 — 立即修复（安全/数据完整性）

1. C01: SSE buffer 溢出改为 `controller.error()` 终止流
2. C05/C06: 消除 `as any`，使用类型安全替代
3. H01: `removeCache()` 调用 `cache.dispose()`
4. H05: requestDedup 添加 pending 定期清理
5. M05: 修复 totalBufferSize 追踪不同步

### P1 — 短期（1-2 周）

6. C02/C03: 拆分 streamLlm 和 doStreamCall 上帝函数
7. C08: 提取 withFetchTimeout 共享工具
8. H02: circuitBreaker 添加上限
9. H04: fallback 添加自动清理定时器
10. M13: 预编译 sensitive word RegExp

### P2 — 中期重构（2-4 周）

11. C04: 拆分 provider.ts 为 provider + modelRegistry
12. H06-H13: 清理 models.ts/type.ts/chat.ts 等废弃代码
13. M07-M12: 提取共享方法（config 缓存、registry、config override）
14. H20: 移除 provider.ts 对 stream/sseCompat 的层级违规

### P3 — 长期规划

15. H14-H19: 类型安全强化（显式返回类型、JSDoc 补全）
16. L01-L10: 低优先级优化

---

## 7. 五维度评估总结

| 维度          | 评级        | 核心发现                                              |
| ------------- | ----------- | ----------------------------------------------------- |
| 🔴 运行稳定性 | ⚠️ 需关注   | 1 个 critical 数据丢失风险，5 个 High 资源泄漏        |
| 🟠 模块设计   | 🔴 需重构   | 2 个 Critical 上帝函数，大量职责混合和废弃代码        |
| 🟡 类型安全   | ⚠️ 需关注   | 2 个 Critical any 滥用，6 个 High 缺失类型注解        |
| 🔵 依赖关系   | ✅ 基本健康 | 1 个 High 层级违规，其余为可注入的耦合                |
| 🟢 共享方法   | ⚠️ 需关注   | 缓存模式、fetch timeout、config override 3 处核心重复 |

### 整体架构评价

**✅ 改进（相比上轮）：**

1. SSE 流处理：已添加残余 buffer 保留 + overflow 警告（C01 仍需改进为 error 终止）
2. 类型声明：LlmOptions 已添加 budget 字段，隐式契约消除
3. 超时保护：embedding/rerank 已添加 AbortController 超时
4. Barrel 清理：测试导出已标记 @internal，models.ts 已标记 @deprecated
5. 依赖解耦：getToolsForAiSdk 已改为动态 import
6. 并行化：健康检查已改为 Promise.allSettled
7. 安全防护：regex injection 已添加 escapeRegExp

**⚠️ 待改进：**

1. 上帝函数问题未解决（streamLlm 349 行、doStreamCall 221 行）
2. 缓存/注册表模式在 4 个模块中重复实现
3. core → stream 层级违规未修复
4. 类型安全仍有 any 残留和缺失返回类型

---

_报告生成时间: 2026-06-17 | 审计方法: 5 维度并行深度审计（5 agent, 365k tokens consumed）_

# Compress Module — 上下文压缩引擎

## 整体定位

Compress 模块是系统的上下文压缩引擎，负责在会话消息历史超过 Token 限制时，通过多种压缩策略减少 Token 使用量，同时保留关键上下文信息。它与对话循环（`@conversation/llmLoop`）联动，可自动或手动触发压缩。

## 核心功能

1. **Token 溢出检测** — 实时监测上下文窗口使用率，判断是否需要压缩
2. **多策略压缩** — 支持 AI 摘要、工具结果截断、混合压缩、子代理压缩
3. **增量压缩** — 跟踪每轮对话的压缩状态，避免重复压缩
4. **自动触发** — 基于阈值的自动压缩机制，无需人工干预
5. **内存保护** — 监控系统内存，防止压缩过程导致 OOM
6. **流式压缩** — 支持大文本的分块流式处理，支持暂停/取消
7. **分布式锁协调** — 避免同一会话的并发压缩冲突

## 目录结构

```
src/compress/
├── index.ts              # 统一出入口，所有外部引用通过此文件
├── README.md             # 本文档
│
├── types/                # 类型定义
│   ├── index.ts          # 统一导出
│   ├── compression.ts    # 压缩结果类型（AI摘要/子代理压缩）
│   ├── config.ts         # 压缩配置类型
│   ├── state.ts          # 压缩状态类型（条目、增量状态）
│   └── strategy.ts       # 策略选择类型（阈值、配置）
│
├── core/                 # 核心压缩器
│   ├── index.ts          # 统一导出
│   ├── compressor.ts     # 主压缩器（消息清理、截断、压缩执行）
│   ├── compressService.ts # 压缩服务入口（compactSession/hybridCompactSession）
│   ├── compressionCoordinator.ts # 分布式锁协调器（避免并发压缩）
│   └── errors.ts         # 错误处理（失败原因枚举、错误载荷）
│
├── strategies/           # 压缩策略实现
│   ├── index.ts          # 统一导出
│   ├── compactStrategy.ts # 策略工厂和选择器（标准/混合/增量）
│   ├── hybridCompress.ts # 混合压缩策略（AI摘要 + 工具截断）
│   └── incrementalCompressor.ts # 增量压缩策略（逐轮压缩）
│
├── runtime/              # 运行时调度
│   ├── index.ts          # 统一导出
│   ├── autoCompress.ts   # 自动压缩触发（阈值检测、事件发布）
│   ├── subAgentCompressor.ts # 子代理压缩（使用轻量Agent）
│   ├── compressionQueue.ts # 压缩任务队列（排队、取消）
│   └── compressionRuntime.ts # LLM循环注入（createConversationCompressor）
│
├── overflow/             # Token 溢出检测
│   ├── index.ts          # 统一导出
│   ├── overflow.ts       # 溢出判断、窗口计算、自适应轮次
│   └── prompt.ts         # 压缩提示词模板（AI摘要/子代理）
│
├── protection/           # 内存保护和流式处理
│   ├── index.ts          # 统一导出
│   ├── memoryProtection.ts # 内存监控（阈值告警、级别判断、自适应分块）
│   └── streamingCompress.ts # 流式压缩（分块迭代、进度追踪、暂停/取消）
│
└── utils/                # 辅助工具
    └── index.ts          # CompactAgent 轻量级压缩 Agent（最小化AI调用）
```

## 子模块说明

| 子模块        | 职责                                      | 主要导出                                                                            |
| ------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `types/`      | 类型定义                                  | `CompressionResult`, `CompressConfig`, `CompactStrategy`, `DEFAULT_COMPRESS_CONFIG` |
| `core/`       | 核心压缩器 + 服务入口 + 锁协调 + 错误处理 | `Compressor`, `compactSession`, `compressionCoordinator`, `createCompressionError`  |
| `strategies/` | 标准/混合/增量三种压缩策略                | `createCompactStrategy`, `performHybridCompression`, `selectCompactStrategyKind`    |
| `runtime/`    | 自动压缩触发 + 子代理 + 队列              | `shouldAutoCompress`, `SubAgentCompressor`, `compressionQueue`                      |
| `overflow/`   | Token 溢出检测 + 提示词                   | `isOverflow`, `getTokenPercentage`, `getAdaptiveKeepRounds`, `COMPRESSION_PROMPT`   |
| `protection/` | 内存监控 + 流式压缩                       | `MemoryMonitor`, `AdaptiveChunker`, `StreamingCompressor`, `memoryMonitor`          |
| `utils/`      | 轻量级 Agent 压缩工具                     | `CompactAgent`, `compactAgent`                                                      |

## 完整 API 导出

以下为 `index.ts` 导出的完整清单，所有外部模块应通过 `@compress` 统一入口引用：

### 类型导出

```typescript
import type {
  // 压缩结果
  CompressionResult, // AI 摘要压缩结果（summary、usage、preservedMessages）
  SubAgentCompressionResult, // 子代理压缩结果（compressed、messages、beforeTokens）
  CompressionStatus, // 压缩状态机（preparing/compressing/completed/failed/retrying）

  // 配置
  CompressConfig, // 压缩模块配置
  StrategySelectionConfig, // 策略选择配置

  // 策略
  CompactStrategyKind, // 策略类型："standard" | "hybrid" | "incremental"
  CompactStrategySelectionInput, // 策略选择输入
  CompactStrategyInput, // 策略执行输入
  CompactStrategyResult, // 策略执行结果
  CompactStrategy, // 策略接口

  // 状态
  CompressionEntry, // 已压缩条目记录
  IncrementalCompressionState, // 增量压缩状态

  // 错误
  CompressionErrorReason, // 失败原因："too_few_messages" | "empty_result" | "exception"
  CompressionErrorContext, // 错误上下文
  CompressionFailure, // 错误载荷

  // 服务
  CompactResult, // 压缩服务结果
  CompactSessionOptions, // 压缩服务选项

  // 内存保护
  MemoryStatus, // 内存状态（heapUsed、level 等）
  MemoryLevel, // 内存等级："safe" | "warning" | "danger" | "critical"
  MemoryMonitorConfig, // 内存监控配置

  // 流式压缩
  StreamingCompressConfig, // 流式压缩配置
  StreamingProgress, // 流式压缩进度
  StreamingCompressResult, // 流式压缩结果

  // 运行时
  MessageCompressor, // LLM 循环注入的压缩器接口
} from "@compress";
```

### 值导出

```typescript
import {
  // ─── 常量 ──────────────────────────────────────────────
  DEFAULT_COMPRESS_CONFIG, // 默认压缩配置
  DEFAULT_STRATEGY_SELECTION_CONFIG, // 默认策略选择配置

  // ─── 核心压缩器 ────────────────────────────────────────
  Compressor, // 主压缩器类
  defaultCompressor, // 默认压缩器实例
  cleanOrphanedToolCalls, // 清理孤立工具调用
  findPreserveStartIndex, // 查找保留消息起始索引
  findRecentRoundsStartIndex, // 查找近期轮次起始索引
  truncateOversizedToolResults, // 截断过大的工具结果

  // ─── 压缩服务 ──────────────────────────────────────────
  compactSession, // 标准压缩（AI摘要）
  hybridCompactSession, // 混合压缩（AI摘要 + 工具截断）

  // ─── 协调器 ────────────────────────────────────────────
  compressionCoordinator, // 分布式锁协调器

  // ─── 错误处理 ──────────────────────────────────────────
  createCompressionError, // 创建压缩错误
  toCompressionFailure, // 转换为错误载荷

  // ─── 策略 ──────────────────────────────────────────────
  createCompactStrategy, // 策略工厂（自动选择）
  selectCompactStrategyKind, // 选择策略类型

  // ─── 混合压缩 ──────────────────────────────────────────
  performHybridCompression, // 执行混合压缩

  // ─── 自动压缩（@internal — 仅供运行时内部使用）──────
  shouldAutoCompress, // 判断是否需要自动压缩
  performAutoCompression, // 执行自动压缩

  // ─── 子代理压缩 ────────────────────────────────────────
  SubAgentCompressor, // 子代理压缩器类
  subAgentCompressor, // 默认子代理压缩器实例

  // ─── 压缩队列（@internal — 规划中功能）────────────────
  compressionQueue, // 压缩任务队列实例

  // ─── 溢出检测 ──────────────────────────────────────────
  getContextWindowSize, // 获取上下文窗口大小
  isOverflow, // 判断是否溢出
  getTokenPercentage, // 获取 Token 使用百分比
  getCompressionAdvice, // 获取压缩建议
  getAdaptiveKeepRounds, // 获取自适应保留轮次

  // ─── 提示词 ────────────────────────────────────────────
  COMPRESSION_PROMPT, // AI 摘要压缩提示词模板
  SUB_AGENT_COMPRESSION_PROMPT, // 子代理压缩提示词模板
  serializeMessagesForCompression, // 序列化消息用于压缩

  // ─── 内存保护（@internal — 通用基础设施预留）───────────
  MemoryMonitor, // 内存监控器类
  AdaptiveChunker, // 自适应分块器类
  memoryMonitor, // 默认内存监控器实例
  createMemoryMonitor, // 创建内存监控器
  createAdaptiveChunker, // 创建自适应分块器

  // ─── 流式压缩（@internal — 通用基础设施预留）───────────
  StreamingCompressor, // 流式压缩器类
  createStreamingCompress, // 创建流式压缩任务
  chunkIterator, // 分块迭代器

  // ─── Compact Agent（@internal — 轻量 AI 调用封装）───────
  CompactAgent, // 轻量压缩 Agent 类
  compactAgent, // 默认 Agent 实例
} from "@compress";
```

## 使用方法

> **注**: 标记为 `@internal` 的导出仅供模块内部使用，当前无外部消费者。
> 外部模块应使用未标记的导出（如 `compactSession`、`createCompactStrategy` 等）。

### 压缩服务调用

```typescript
import { compactSession, hybridCompactSession } from "@compress";

// 标准压缩（AI摘要）
const result = await compactSession("session-123", appConfig);

// 混合压缩（AI摘要 + 工具结果截断）
const hybridResult = await hybridCompactSession("session-123", appConfig, {
  keepRecentTurns: 3,
});
```

### 溢出检测

```typescript
import { isOverflow, getTokenPercentage, getAdaptiveKeepRounds } from "@compress";

const tokens = estimateMessagesTokens(messages);
const percentage = getTokenPercentage(tokens, modelId);
if (isOverflow(tokens, modelId)) {
  const keepRounds = getAdaptiveKeepRounds(percentage, 3);
  // 触发压缩，保留 keepRounds 轮历史
}
```

### 自动压缩

```typescript
import { shouldAutoCompress, performAutoCompression } from "@compress";

const percentage = getTokenPercentage(tokensBefore, modelId);
if (shouldAutoCompress(percentage)) {
  await performAutoCompression(messages, config, modelId, sessionId);
}
```

### 策略选择

```typescript
import { createCompactStrategy, selectCompactStrategyKind } from "@compress";

// 自动选择策略（根据消息量、Token 预算等参数自动判断）
const kind = selectCompactStrategyKind({
  tokensBefore: 90000,
  tokenBudget: 100000,
  messageCount: 85,
  hasLargeToolResults: true,
});
// → "hybrid"（Token 压力高 + 大量工具结果 → 混合策略）

// 通过工厂创建策略并执行
const strategy = createCompactStrategy(kind);
const result = await strategy.compact({
  messages,
  appConfig,
  sessionId: "session-123",
});
```

### 内存保护

```typescript
import { createMemoryMonitor, createAdaptiveChunker, memoryMonitor } from "@compress";

// 使用默认监控器
const status = memoryMonitor.getStatus();
if (status.level === "critical") {
  // 内存紧张，降级处理或暂停新任务
}

// 自定义监控器
const monitor = createMemoryMonitor({
  warningThreshold: 0.6, // 堆使用率 60% 警告
  dangerThreshold: 0.75, // 75% 危险
  criticalThreshold: 0.9, // 90% 临界
  autoGC: true, // 自动触发 GC
});

// 自适应分块（根据内存状态动态调整处理块大小）
const chunker = createAdaptiveChunker<string>(monitor, 100);
chunker.setItems(largeDataArray);
for (const chunk of chunker.iterateChunks()) {
  await processChunk(chunk);
}
```

### 流式压缩

```typescript
import { createStreamingCompress, chunkIterator } from "@compress";

// 创建流式压缩任务
const streaming = createStreamingCompress<string, string>({
  items: largeMessageList,
  baseChunkSize: 100,
  adaptiveChunking: true,
  maxConcurrency: 2,
  onProgress: (progress) => {
    console.log(`进度: ${progress.percentage}% (${progress.currentChunk}/${progress.totalChunks})`);
  },
  processChunk: async (chunk, index) => {
    return await compressChunk(chunk);
  },
});

// 执行并获取结果
const result = await streaming.execute();
if (result.success) {
  console.log("压缩完成:", result.results);
}

// 支持暂停/取消
streaming.pause(); // 暂停
streaming.resume(); // 恢复
streaming.cancel(); // 取消

// 简单分块迭代器
for (const chunk of chunkIterator(items, 50, true)) {
  await processChunk(chunk);
}
```

### 错误处理

```typescript
import { createCompressionError, toCompressionFailure } from "@compress";

// 创建结构化压缩错误
const error = createCompressionError(
  "too_few_messages", // 原因：消息过少
  "消息数量不足以执行压缩",
  { sessionId: "session-123", messageCount: 2 },
);

// 转换为错误载荷（用于事件传递）
const failure = toCompressionFailure(error);
// → { error: "消息数量不足以执行压缩", errorCode: "INVALID_INPUT" }
```

## 策略选择指南

| 策略          | 适用场景             | 特点                                                      |
| ------------- | -------------------- | --------------------------------------------------------- |
| `standard`    | 一般对话，消息量适中 | 仅 AI 摘要，保留关键信息，压缩比适中                      |
| `hybrid`      | 工具调用多、结果长   | AI 摘要 + 工具输出截断，压缩比高，适合 Token 压力大的场景 |
| `incremental` | 超长对话，需逐步压缩 | 逐轮压缩历史消息，避免一次性处理过多数据                  |

**自动选择逻辑**（`selectCompactStrategyKind`）：

- Token 预算压力 ≥ 90% → `hybrid`
- 消息数 ≥ 80 条 → `hybrid`
- 消息数 ≥ 12 条且允许增量 → `incremental`
- 其他情况 → `standard`

## 压缩流程

```
1. 检测上下文是否溢出 (overflow/isOverflow)
   ↓
2. 根据配置选择合适的压缩策略 (strategies/compactStrategy)
   ↓
3. 执行压缩:
   - AI 摘要: 调用 LLM 生成压缩摘要
   - 工具截断: 截断过长的工具执行结果
   - 混合压缩: 先 AI 摘要，再截断剩余
   - 增量压缩: 逐轮压缩历史消息
   ↓
4. 通过 compressionCoordinator 加锁，避免并发冲突
   ↓
5. 更新会话消息历史
   ↓
6. 发布压缩完成事件 (eventBus.publish)
```

## 配置项

> **配置分层说明**：模块存在两套配置类型，分属不同层级：
>
> - **CompressConfig**（`types/config.ts`）— 压缩**执行层**配置，控制 Compressor、SubAgentCompressor、策略的行为参数
> - **CompactionConfig**（`conversation/compaction.ts`）— 会话**触发层**配置，控制 `maybeCompact` 何时触发、保留多少轮次
>
> 两者共享 `tokenThreshold`/`keepRecentTurns`/`toolOutputTruncateLength` 字段名但语义不同：
> `CompressConfig` 定义压缩器的执行参数，`CompactionConfig` 定义对话循环的触发阈值。
> `CompactionConfig` 额外包含 `targetRatio`（压缩后目标 token 占比），用于 `maybeCompact` 的摘要生成。

### CompressConfig（压缩执行层配置）

| 配置项                     | 类型     | 默认值  | 说明                             |
| -------------------------- | -------- | ------- | -------------------------------- |
| `tokenThreshold`           | `number` | `80000` | Token 阈值，超过此值触发压缩     |
| `keepRecentTurns`          | `number` | `4`     | 压缩后保留的近期消息轮次         |
| `toolOutputTruncateLength` | `number` | `2000`  | 工具输出截断长度（字符）         |
| `autoCompressThreshold`    | `number` | `80`    | 自动压缩百分比阈值（窗口使用率） |
| `maxRetries`               | `number` | `3`     | 最大重试次数                     |
| `retryBaseDelay`           | `number` | `1000`  | 重试基础延迟（毫秒）             |

> 完整默认值见 `DEFAULT_COMPRESS_CONFIG`。

### CompactionConfig（会话触发层配置）

| 配置项                     | 类型     | 默认值  | 说明                                               |
| -------------------------- | -------- | ------- | -------------------------------------------------- |
| `tokenThreshold`           | `number` | `80000` | Token 阈值，超过此值触发压缩                       |
| `keepRecentTurns`          | `number` | `4`     | 压缩后保留的近期消息轮次                           |
| `toolOutputTruncateLength` | `number` | `2000`  | 工具输出截断长度（字符）                           |
| `targetRatio`              | `number` | `0.3`   | 压缩后目标 token 占比（仅用于会话级 maybeCompact） |

> 完整默认值见 `DEFAULT_COMPACTION_CONFIG`。

### StrategySelectionConfig（策略选择配置）

| 配置项                       | 类型     | 默认值 | 说明                      |
| ---------------------------- | -------- | ------ | ------------------------- |
| `highBudgetPressureRatio`    | `number` | `0.9`  | 高 Token 预算压力比例阈值 |
| `largeMessageCount`          | `number` | `80`   | 大消息数量阈值            |
| `incrementalMinMessageCount` | `number` | `12`   | 增量压缩最小消息数        |

> 完整默认值见 `DEFAULT_STRATEGY_SELECTION_CONFIG`。

### MemoryMonitorConfig（内存监控配置）

| 配置项                     | 类型      | 默认值 | 说明                     |
| -------------------------- | --------- | ------ | ------------------------ |
| `warningThreshold`         | `number`  | `0.6`  | 警告阈值（堆使用率 60%） |
| `dangerThreshold`          | `number`  | `0.75` | 危险阈值（堆使用率 75%） |
| `criticalThreshold`        | `number`  | `0.9`  | 临界阈值（堆使用率 90%） |
| `sampleIntervalMs`         | `number`  | `5000` | 监控采样间隔（毫秒）     |
| `autoGC`                   | `boolean` | `true` | 是否自动触发 GC          |
| `gcPressureReductionRatio` | `number`  | `0.5`  | GC 触发时降压比例        |

## 错误处理

### 压缩失败原因

| 原因     | 枚举值             | 说明                                   |
| -------- | ------------------ | -------------------------------------- |
| 消息过少 | `too_few_messages` | 消息数量不足以执行压缩（用户错误）     |
| 空结果   | `empty_result`     | 压缩执行后返回空结果（内部状态不一致） |
| 异常     | `exception`        | 压缩过程中抛出未预期异常（未知错误）   |

### 错误处理模式

```typescript
import { createCompressionError, type CompressionErrorReason } from "@compress";

// 所有错误都会被结构化为 AppError，携带 context 信息
try {
  await compactSession({ sessionId, messages, config });
} catch (error) {
  // error.code → "INVALID_INPUT" (too_few_messages) | "STATE_INCONSISTENT" (empty_result) | "UNKNOWN_ERROR"
  // error.context.compressionReason → 压缩失败原因
  // error.context.sessionId → 会话ID
}
```

## 与外部系统的交互

| 外部模块                | 交互方式                    | 说明                                                                    |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `@conversation/llmLoop` | 注入 `MessageCompressor`    | 在对话循环中自动触发压缩                                                |
| `@bus/eventBus`         | 发布结构化事件 + Toast 通知 | `CompressEvents`（started/completed/failed/retrying）+ `AppEvent.Toast` |
| `@monitor/telemetry`    | 上报遥测指标                | 通过 `recordCompressionBusinessTelemetry` 上报压缩结果                  |
| `@schema/config`        | 读取压缩配置                | `CompressConfig` 从应用配置注入                                         |
| `@core/logger`          | 日志记录                    | 压缩过程的日志输出                                                      |
| `@ai-sdk`               | 调用 LLM                    | AI 摘要压缩时使用                                                       |
| `@core/errors/appError` | 错误创建                    | 结构化错误载荷                                                          |

## 边界与限制

1. **两条路径对原始消息处理不同** — `maybeCompact`（对话触发层）原地修改传入的消息数组；`compactSession`（手动/命令层）从数据库加载副本执行压缩，通过 `addTextMessage` 追加摘要，不修改原始 DB 记录
2. **压缩策略可配置** — 支持 standard/hybrid/incremental 三种策略，可自动选择
3. **自动压缩有阈值** — 低于阈值不会触发，避免频繁压缩影响体验
4. **子代理压缩需额外资源** — 使用独立 Agent 上下文，有额外的 LLM 调用开销
5. **内存监控仅限 V8 堆** — 不包括外部内存（如 ArrayBuffer、C++ 分配）
6. **保护机制是被动式** — 需要主动调用 `getStatus()` 检查，不会自动中断正在执行的任务
7. **分布式锁为进程内实现** — 当前协调器在同一进程内生效，跨进程场景需扩展

## 设计决策

### 架构决策记录

| 决策                                              | 原因                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `conversation/compaction.ts` 位于 compress 模块内 | compaction 是对话压缩的核心实现，与 compress 的溢出检测、策略选择紧密耦合。虽然它深度依赖 conversation 生态（summaryGenerator、session、hooks），但将其保留在 compress 中可保持压缩逻辑的内聚性。消费者通过 `@/compress/conversation` 统一引用。 |
| `protection/` 和 `utils/` 位于 compress 模块内    | `MemoryMonitor`、`StreamingCompressor`、`CompactAgent` 是通用基础设施，当前标记为 `@internal` 且无外部消费者。保留在 compress 中作为预留能力，未来可迁移至 `@/core/` 独立模块。                                                                  |
| CompressEvents 发布点覆盖全部三条压缩路径         | `compactSession`（手动）、`maybeCompact`（自动对话触发）、`performAutoCompression`（自动运行时触发）均发布 `CompressStarted/Completed/Failed` 事件，agent 模块可通过 `agentEvents.compressCompleted` 订阅。                                      |

| 决策                                     | 原因                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| 采用分布式锁（`compressionCoordinator`） | 同一会话可能被多个路径触发压缩，锁保证串行执行避免消息丢失       |
| 增量压缩按轮次追踪                       | 避免对已压缩内容重复压缩，节省 LLM 调用开销                      |
| 内存保护与流式压缩解耦                   | 内存监控可独立使用（如其他大内存操作），流式压缩自动集成内存感知 |
| 策略工厂模式                             | 支持运行时动态切换策略，便于 A/B 测试和配置化选择                |
| 提示词模板外置                           | 便于调优压缩效果，无需修改核心逻辑                               |

### 两条压缩路径的选择

模块存在两条独立的压缩路径，分属不同层级：

| 路径                              | 入口                                            | 适用场景                            | 特点                                           |
| --------------------------------- | ----------------------------------------------- | ----------------------------------- | ---------------------------------------------- |
| **maybeCompact**（对话触发层）    | `conversation/compaction.ts` → `maybeCompact()` | 对话循环内部自动触发                | 原地修改消息数组 + 持久化到数据库 + 保存分支点 |
| **compactSession**（手动/命令层） | `core/compressService.ts` → `compactSession()`  | 用户手动触发（`/compact`、UI、API） | 通过 session 消息加载 → 压缩 → 追加摘要消息    |

选择指南：

- **自动场景**（对话循环中）→ 使用 `maybeCompact`，它直接操作内存中的消息数组并持久化
- **手动场景**（命令/API）→ 使用 `compactSession`，它从数据库加载、执行压缩、保存摘要
- 两者共享 `findPreserveStartIndex`、`estimateMessagesTokens`、`getAdaptiveKeepRounds` 等工具函数

## 故障排查

| 现象                      | 可能原因               | 排查步骤                                                           |
| ------------------------- | ---------------------- | ------------------------------------------------------------------ |
| 压缩未触发                | 阈值未达到             | 检查 `getTokenPercentage()` 返回值是否超过 `autoCompressThreshold` |
| 压缩后 Token 仍超标       | `targetRatio` 设置过高 | 降低 `targetRatio`，或检查是否有过多的 `keepRecentTurns`           |
| 压缩报 `too_few_messages` | 消息数不足             | 确认消息数组长度 >= 最小压缩要求                                   |
| 压缩报 `empty_result`     | LLM 返回空摘要         | 检查 `COMPRESSION_PROMPT` 是否正确、模型是否可用                   |
| 并发压缩冲突              | 同一会话多处触发       | 确认 `compressionCoordinator` 锁是否正常获取/释放                  |
| 内存告警频繁              | 堆使用率高             | 调整 `MemoryMonitorConfig` 阈值，或启用 `autoGC`                   |
| 流式压缩卡住              | 未调用 `resume()`      | 检查是否 `pause()` 后忘记恢复，或检查 `processChunk` 是否阻塞      |

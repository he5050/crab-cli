# Core Module — 核心基础设施

## 整体定位

Core 模块是系统的核心基础设施层，提供全局共享的工具函数、数据类型、常量定义和基础服务。它不依赖任何业务逻辑，被所有其他模块（session、conversation、config、search、tool、monitor 等）广泛引用。

## 核心功能

1. **日志系统** — 分级日志、内存缓冲、文件持久化、调试脱敏
2. **错误处理** — 结构化错误码体系（AppError + ErrorCode 注册表）
3. **并发原语** — 超时、重试、熔断器、实例锁
4. **生命周期管理** — 应用启动/关闭清理、临时文件管理、进程管理
5. **数据队列** — 环形缓冲区、LRU 缓存（TTL + 命中率统计）
6. **流量控制** — 背压监控、优先级节流队列、Token 限制器
7. **身份标识** — ULID 前缀化 ID 生成器
8. **图标常量** — 373 个 emoji/Unicode 图标常量 + 75 个派生函数
9. **工具函数** — Unicode 处理、敏感信息脱敏、文件 I/O、LaTeX 渲染
10. **I/O 操作** — 跨平台剪贴板读写
11. **存储** — 像素画持久化
12. **扫描** — 项目 TODO/FIXME/HACK 扫描
13. **更新检查** — npm 注册表版本检测
14. **流保护** — ReadableStream 类型守卫

## 目录结构

```
src/core/
├── index.ts              # 统一出入口（值 + 类型）
├── type.ts               # 统一类型导出
├── error.ts              # 兼容层（CrabError，旧版错误 API）
├── tokenCounter.ts       # Token 估算（高频引用，保留在根目录）
├── README.md             # 本文档
│
├── logging/              # 日志系统
│   ├── index.ts
│   ├── logger.ts         # 分级日志、内存缓冲、事件注入
│   ├── logStore.ts       # 日志文件持久化（~/.crab/logs/）
│   └── debugLogger.ts    # 调试脱敏（API Key、Token、密码）
│
├── config/               # 应用配置
│   ├── index.ts
│   ├── version.ts        # 版本号（从 package.json 加载）
│   ├── isDevMode.ts      # 纯函数：判断开发模式
│   └── devMode.ts        # 开发模式设置（持久化 userId、配置 I/O）
│
├── utilities/            # 工具函数
│   ├── index.ts
│   ├── textUtils.ts      # Unicode 码点、视觉宽度、截断、格式化
│   ├── pickFirstDefined.ts # 第一个非 undefined 值 / 第一个 truthy 值
│   ├── sanitize.ts       # 敏感信息检测/脱敏、提示词注入检测
│   ├── fileUtils.ts      # Bun.file 封装（读写文本/JSON、存在性检查）
│   └── latexRender.ts    # LaTeX → Unicode 映射渲染
│
├── identity/             # 身份标识
│   ├── index.ts
│   └── id.ts             # ULID 前缀化生成器（ses_、msg_、prt_、evt_ 等）
│
├── icons/                # 图标常量
│   ├── index.ts
│   ├── icon.ts           # 373 个图标常量
│   └── iconDerived.ts    # 75 个图标派生函数
│
├── io/                   # I/O 操作
│   ├── index.ts
│   ├── clipboard.ts      # 跨平台剪贴板（pbcopy/pbxclip/xclip/xsel）
│   └── useClipboard.ts   # Solid.js hook
│
├── storage/              # 存储
│   ├── index.ts
│   └── pixelStore.ts     # 像素画持久化（~/.crab/draw/）
│
├── scanning/             # 扫描
│   ├── index.ts
│   └── todoScanner.ts    # 项目 TODO/FIXME/HACK 扫描
│
├── update/               # 更新检查
│   ├── index.ts
│   └── updateCheck.ts    # npm 注册表版本检测、定时检查
│
├── streams/              # 流保护
│   ├── index.ts
│   └── streamGuards.ts   # ReadableStream 类型守卫
│
├── errors/               # 错误处理
│   ├── index.ts
│   ├── appError.ts       # AppError 基类 + 7 个子类 + 工厂函数
│   └── errorCodes.ts     # ERROR_CODES 注册表 + 域/严重性类型
│
├── concurrency/          # 并发原语
│   ├── index.ts
│   ├── promiseUtils.ts   # withTimeout / withTimeoutAndSignal
│   ├── retry.ts          # 指数退避重试
│   ├── circuitBreaker.ts # 熔断器（CLOSED→OPEN→HALF_OPEN）
│   └── instanceLock.ts   # 文件锁（防止多实例启动）
│
├── lifecycle/            # 生命周期管理
│   ├── index.ts
│   ├── globalCleanup.ts  # LIFO 清理回调注册（应用关闭）
│   ├── tmpCleanup.ts     # 启动/退出临时文件清理
│   └── processManager.ts # Bun.spawn 封装（exec、commandExists）
│
├── queue/                # 数据队列
│   ├── index.ts
│   ├── ringBuffer.ts     # 泛型 RingBuffer<T>（O(1) FIFO）
│   └── cacheManager.ts   # LRU 缓存（TTL、命中率、自动清理）
│
└── throttle/             # 流量控制
    ├── index.ts
    ├── backpressure.ts   # Token bucket + 请求队列 + 背压监控
    ├── throttleQueue.ts  # 优先级节流队列（事件合并）
    └── tokenLimiter.ts   # 工具结果 Token 限制
```

## 子模块说明

| 子模块            | 职责       | 主要导出                                                                             |
| ----------------- | ---------- | ------------------------------------------------------------------------------------ |
| `logging/`        | 日志系统   | `createLogger`, `setLogEventSink`, `getLogDir`, `sanitizeString`                     |
| `config/`         | 应用配置   | `VERSION`, `isDevMode`, `initDevMode`, `getDevSettings`                              |
| `utilities/`      | 工具函数   | `formatBytes`, `truncate`, `sanitizeSensitiveInfo`, `readJsonFile`, `latexToUnicode` |
| `identity/`       | ID 生成    | `createId`, `extractPrefix`, `isIdPrefix`                                            |
| `icons/`          | 图标常量   | 373 个图标常量 + 75 个派生函数                                                       |
| `io/`             | I/O 操作   | `readClipboard`, `writeClipboard`, `useClipboard`                                    |
| `storage/`        | 存储       | `saveDrawing`, `loadDrawing`, `listDrawings`, `deleteDrawing`                        |
| `scanning/`       | 扫描       | `scanProjectTodos`, `formatTodoContext`                                              |
| `update/`         | 更新检查   | `checkForUpdate`, `startUpdateCheck`, `getUpdateNotice`                              |
| `streams/`        | 流保护     | `isStreamUsable`, `isStreamLocked`, `consumeStream`                                  |
| `errors/`         | 错误处理   | `AppError`, `throwAppError`, `ERROR_CODES`, `getErrorCodeInfo`                       |
| `concurrency/`    | 并发原语   | `withTimeout`, `retry`, `CircuitBreaker`, `instanceLock`                             |
| `lifecycle/`      | 生命周期   | `registerCleanup`, `runCleanup`, `exec`, `commandExists`                             |
| `queue/`          | 数据队列   | `RingBuffer`, `createCacheManager`, `getAllCacheStats`                               |
| `throttle/`       | 流量控制   | `acquireExecutionPermit`, `ThrottleQueue`, `validateAndTruncate`                     |
| `tokenCounter.ts` | Token 估算 | `estimateTokens`, `estimateMessagesTokens`, `formatTokenCount`                       |
| `error.ts`        | 兼容层     | `CrabError`, `throwError`, `safeExecute`, `toCrabError`                              |

## 使用方法

### 日志

```typescript
import { createLogger } from "@core";

const log = createLogger("myService");
log.info("Starting up", { config: { port: 3000 } });
log.warn("Deprecated API", { oldMethod: "v1" });
log.error("Failed to connect", { error: err.message });
```

### 错误处理

```typescript
import { AppError, ERROR_CODES, getErrorCodeInfo } from "@core";

// 使用标准错误码
if (!config.apiKey) {
  throw new AppError("CONFIG-300", "API key is missing", {
    context: { source: "env" },
    severity: "high",
  });
}

// 查询错误码信息
const info = getErrorCodeInfo("CONFIG-300");
// → { domain: "CONFIG", severity: "high", description: "..." }
```

### ID 生成

```typescript
import { createId } from "@core";

const sessionId = createId("ses"); // e.g. "ses_01J4K5M6N7P8Q9R0S1T2U3V4"
const messageId = createId("msg"); // e.g. "msg_01J4K5M6N7P8Q9R0S1T2U3V5"
```

### 并发原语

```typescript
import { withTimeout, retry, CircuitBreaker } from "@core";

// 超时
const result = await withTimeout(fetchData(), 5000);

// 重试
const data = await retry(() => fetchAPI(), {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
});

// 熔断器
const breaker = getCircuitBreaker("external-api", {
  threshold: 5, // 5 次失败后打开
  resetTimeout: 30000, // 30 秒后尝试半开
});
```

### 缓存管理

```typescript
import { createCacheManager } from "@core";

const cache = createCacheManager<string>({
  name: "search-results",
  ttl: 300_000, // 5 分钟
  maxSize: 1000, // 最多 1000 条
});

cache.set("query-1", "result");
const value = cache.get("query-1");
const stats = cache.getStats(); // { hits, misses, hitRate, size, ... }
```

### 流量控制

```typescript
import { acquireExecutionPermit, ThrottleQueue } from "@core";

// 背压监控
const permit = await acquireExecutionPermit();
if (permit.granted) {
  await executeTask();
  permit.release();
}

// 优先级节流队列
const queue = createThrottleQueue({
  maxConcurrent: 3,
  priority: "high",
});
queue.enqueue({ id: "task-1", execute: () => runTask() });
```

### 文件操作

```typescript
import { readJsonFile, writeJsonFile, fileExists } from "@core";

if (await fileExists("config.json")) {
  const config = await readJsonFile("config.json");
  await writeJsonFile("config.backup.json", config);
}
```

### Token 估算

```typescript
import { estimateTokens, estimateMessagesTokens } from "@core";

const count = estimateTokens("Hello, world! 你好世界");
// → ~8 (CJK 字符按 ~1.5 token/字符，英文按 ~0.75 token/词)

const total = estimateMessagesTokens(messages);
```

## 与外部系统的交互

| 外部模块                       | 交互方式     | 说明                                                     |
| ------------------------------ | ------------ | -------------------------------------------------------- |
| `@config`                      | 读取应用配置 | 日志级别、开发模式设置                                   |
| `@security/clipboardSanitizer` | 剪贴板消毒   | 粘贴前检查敏感信息                                       |
| `@monitor/metricsCollector`    | 指标采集     | performanceMonitor/resourceMonitor 已迁移至 monitor 模块 |
| `@bus/eventBus`                | 事件注入     | `setLogEventSink` 将日志事件转发到事件总线               |

## 设计决策

| 决策                                                     | 原因                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 按功能域划分 13 个子目录                                 | 避免根目录 40+ 文件混杂，每个目录职责单一                                                      |
| 高频引用文件保留在根目录                                 | `tokenCounter.ts` 被 9 个外部模块引用，减少路径深度                                            |
| 统一出入口 `index.ts` + `type.ts`                        | 外部模块只需 `import { ... } from "@core"`，无需记忆子路径                                     |
| 移除所有 pass-through 转发文件                           | 旧的 `ringBuffer.ts`、`backpressure.ts` 等 14 个单行转发文件全部删除，消费者直接引用子目录路径 |
| `error.ts` 兼容层保留                                    | 旧版 `CrabError` API 仍有消费者，逐步迁移而非强制断裂                                          |
| `performanceMonitor`/`resourceMonitor` 转发至 `@monitor` | 这两个模块已在 [P2-24] 合并到 monitor 模块，core 仅保留转发                                    |

## 迁移指南

> **注意**: 本项目已统一导入规范。深路径 alias（如 `@core/logging/logger`）已废弃，请使用 `@/` 前缀的深路径导入（如 `@/core/logging/logger`）或模块一级入口（如 `@core`）。详见 [导入边界规范](../../docs/architecture/import-boundary.md)。

如果你的代码中有以下旧导入路径，请按此表更新：

| 旧路径                     | 新路径                             |
| -------------------------- | ---------------------------------- |
| `@core/logger`             | `@core/logging/logger`             |
| `@core/logStore`           | `@core/logging/logStore`           |
| `@core/debugLogger`        | `@core/logging/debugLogger`        |
| `@core/version`            | `@core/config/version`             |
| `@core/isDevMode`          | `@core/config/isDevMode`           |
| `@core/devMode`            | `@core/config/devMode`             |
| `@core/textUtils`          | `@core/utilities/textUtils`        |
| `@core/pickFirstDefined`   | `@core/utilities/pickFirstDefined` |
| `@core/sanitize`           | `@core/utilities/sanitize`         |
| `@core/fileUtils`          | `@core/utilities/fileUtils`        |
| `@core/latexRender`        | `@core/utilities/latexRender`      |
| `@core/id`                 | `@core/identity/id`                |
| `@core/icon`               | `@core/icons/icon`                 |
| `@core/iconDerived`        | `@core/icons/iconDerived`          |
| `@core/clipboard`          | `@core/io/clipboard`               |
| `@core/useClipboard`       | `@core/io/useClipboard`            |
| `@core/pixelStore`         | `@core/storage/pixelStore`         |
| `@core/todoScanner`        | `@core/scanning/todoScanner`       |
| `@core/updateCheck`        | `@core/update/updateCheck`         |
| `@core/streamGuards`       | `@core/streams/streamGuards`       |
| `@core/ringBuffer`         | `@core/queue/ringBuffer`           |
| `@core/cacheManager`       | `@core/queue/cacheManager`         |
| `@core/promiseUtils`       | `@core/concurrency/promiseUtils`   |
| `@core/retry`              | `@core/concurrency/retry`          |
| `@core/circuitBreaker`     | `@core/concurrency/circuitBreaker` |
| `@core/instanceLock`       | `@core/concurrency/instanceLock`   |
| `@core/globalCleanup`      | `@core/lifecycle/globalCleanup`    |
| `@core/tmpCleanup`         | `@core/lifecycle/tmpCleanup`       |
| `@core/processManager`     | `@core/lifecycle/processManager`   |
| `@core/backpressure`       | `@core/throttle/backpressure`      |
| `@core/throttleQueue`      | `@core/throttle/throttleQueue`     |
| `@core/tokenLimiter`       | `@core/throttle/tokenLimiter`      |
| `@core/performanceMonitor` | `@monitor/metricsCollector`        |
| `@core/resourceMonitor`    | `@monitor/metricsCollector`        |

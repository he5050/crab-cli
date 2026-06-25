# LSP Module — Language Server Protocol 客户端

## 整体定位

LSP 模块是系统的语言智能核心，通过 Language Server Protocol 为代码搜索、符号提取、工具调用等场景提供精确的代码理解能力。它管理项目级 LSP Server 进程的生命周期，转发代码导航请求（跳转定义、查找引用、悬停信息等），并缓存诊断数据供 UI 层消费。

## 核心功能

1. **语言检测** — 根据文件扩展名自动识别编程语言，映射到对应的 LSP Server
2. **Server 注册表** — 内置 12+ 种语言的 LSP Server 定义（TypeScript、Python、Go、Rust、C/C++ 等）
3. **客户端管理** — 项目级 LSP 客户端懒启动、进程生命周期管理、请求路由与诊断缓存
4. **LSP 语义能力** — 跳转定义、查找引用、悬停信息、代码补全、文档符号、工作区符号、代码操作、重命名、格式化
5. **配置热更新** — 监听 `.claude/lsp.json` 配置变更，自动重启受影响的客户端
6. **配置验证** — 校验用户自定义 Server 配置的结构完整性和字段有效性
7. **性能优化** — 响应缓存、请求队列、并发控制、指标监控
8. **空闲清理** — 自动停止超时未使用的 LSP Server

## 目录结构

```
src/lsp/
├── index.ts              # 统一出入口，所有外部引用通过此文件
├── README.md             # 本文档
│
├── core/                 # LSP 客户端核心
│   ├── client.ts         # LSPClient 类：封装单个 LSP 客户端的完整通信逻辑
│   ├── clientMessageBuffer.ts  # JSON-RPC 消息缓冲与解析
│   └── clientProtocol.ts # LSP 协议类型定义（Location, Diagnostic, Symbol 等）+ 解析工具
│
├── manager/              # 管理器
│   ├── manager.ts        # LspManager 类：项目级客户端生命周期与请求路由
│   ├── managerTypes.ts   # 管理器内部类型（LspClient, LspClientEntry, LspClientState）
│   ├── managerProtocol.ts # 协议类型（LspLocation, LspDiagnostic, LspSymbol 等）+ path/uri 转换
│   └── managerFeatures.ts # 高级语义功能封装（requestLspLocations, requestLspHover 等）
│
├── config/               # 配置系统
│   ├── lspConfig.ts      # 配置加载与解析（从 .claude/config.json 或 .claude/lsp.json）
│   ├── configValidator.ts # 配置结构验证（字段类型、语言 ID、命令格式）
│   ├── configWatcher.ts  # 配置文件监听器（防抖、热更新通知）
│   └── configIntegration.ts # 配置与 Manager 集成（配置 diff 检测、客户端重启）
│
├── registry/             # Server 注册表
│   └── serverRegistry.ts # builtinServers 映射表（12+ Server 定义）+ 查找函数
│
├── language/             # 语言检测
│   └── language.ts       # 扩展名 → 语言 ID 映射 + detectLanguage() 函数
│
└── perf/                 # 性能优化
    └── performance.ts    # ResponseCache, RequestQueue, PerformanceMonitor
```

## 子模块说明

| 子模块      | 职责                             | 主要导出                                                                                          |
| ----------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `core/`     | LSP 客户端 + 消息缓冲 + 协议类型 | `LSPClient`, `extractJsonRpcMessages`, `parseDiagnostic`, `parseLocationResult`                   |
| `manager/`  | 管理器 + 类型 + 协议 + 高级功能  | `LspManager`, `lspManager`, `LspClient`, `requestLspLocations`, `requestLspHover`                 |
| `config/`   | 配置加载 + 验证 + 监听 + 集成    | `loadLspConfig`, `resolveLspConfig`, `validateLspConfig`, `ConfigWatcher`, `setupConfigHotReload` |
| `registry/` | Server 注册表                    | `builtinServers`, `findServerForLanguage`, `isServerInstalled`                                    |
| `language/` | 语言检测                         | `detectLanguage`, `getLspServerForFile`, `listSupportedLanguages`                                 |
| `perf/`     | 性能工具（已集成到 LspManager）  | `ResponseCache`, `RequestQueue`, `PerformanceMonitor`                                             |

## 完整 API 导出

以下为 `index.ts` 导出的完整清单，所有外部模块应通过 `@lsp` 统一入口引用：

### 类型导出

```typescript
import type {
  // 语言检测
  LanguageInfo,

  // Server 注册表
  LspServerDefinition,

  // 配置
  LspConfig,
  ResolvedLspConfig,
  UserLspServerConfig,

  // 诊断
  LspDiagnostic,
} from "@lsp";
```

### 值导出

```typescript
import {
  // ─── 语言检测 ──────────────────────────────────────────
  detectLanguage,
  getLspServerForFile,
  listSupportedLanguages,

  // ─── Server 注册表 ─────────────────────────────────────
  builtinServers,
  findServerForLanguage,
  isServerInstalled,

  // ─── 配置 ──────────────────────────────────────────────
  loadLspConfig,
  resolveLspConfig,
  getAvailableServerForLanguage,

  // ─── 管理器 ────────────────────────────────────────────
  LspManager,
  lspManager,
} from "@lsp";
```

## 使用方法

### 语言检测

```typescript
import { detectLanguage, getLspServerForFile } from "@lsp";

const lang = detectLanguage("src/main.ts");
// → { extension: ".ts", languageId: "typescript", label: "TypeScript", lspServer: "typescript-language-server" }

const server = getLspServerForFile("src/main.go");
// → { languageId: "go", serverId: "gopls", ... }
```

### 启动 LSP 管理器

```typescript
import { LspManager } from "@lsp";

const manager = new LspManager({
  projectRoot: "/path/to/project",
  maxConnections: 8,
  cacheTtl: 5000, // 响应缓存 TTL（毫秒，默认 5000）
  cacheMaxSize: 1000, // 缓存最大条数（默认 1000）
  maxConcurrentRequests: 10, // 最大并发请求数（默认 10）
  idleTimeout: 300_000, // 空闲客户端超时（毫秒，默认 5 分钟）
  enablePerformanceLogging: true, // 性能日志（默认 true）
});

// 为文件启动 LSP 客户端
const client = await manager.startForFile("src/main.ts", "file:///path/to/project");

// 使用 LSP 能力
const locations = await manager.gotoDefinition("src/main.ts", 10, 5);
const hover = await manager.hover("src/main.ts", 10, 5);
const symbols = await manager.documentSymbols("src/main.ts");

// 查看性能报告
const report = manager.getPerformanceReport();
console.log(`缓存命中率: ${(report.cacheHitRate * 100).toFixed(1)}%`);
console.log(`平均响应时间: ${report.monitor.avgResponseTime}ms`);
console.log(`队列: ${report.queue.activeRequests}/${report.queue.maxConcurrent}`);

// 清理空闲客户端（也可自动执行，默认每分钟）
const cleaned = await manager.cleanupIdle();

// 关闭客户端
await manager.stop("typescript");

// 或使用全局单例
import { lspManager } from "@lsp";
```

### 配置加载与验证

```typescript
import { loadLspConfig, resolveLspConfig, validateLspConfig } from "@lsp";

// 加载用户配置
const rawConfig = loadLspConfig("/path/to/project");

// 验证配置
const validation = validateLspConfig(rawConfig);
if (!validation.valid) {
  console.error("配置验证失败:", validation.errors);
}

// 解析完整配置（合并内置 + 自定义）
const resolved = resolveLspConfig("/path/to/project");
```

### 配置热更新

```typescript
import { setupConfigHotReload } from "@lsp/config/configIntegration";
import { lspManager } from "@lsp";

const integration = await setupConfigHotReload(lspManager, {
  projectRoot: "/path/to/project",
  enableHotReload: true,
});

// 手动重新加载
await integration.manualReload();
```

### 高级语义功能（依赖注入模式）

```typescript
import { requestLspLocations, requestLspHover, requestLspCompletion } from "@lsp/manager/managerFeatures";

const deps = {
  pathToUri: (filePath: string) => `file://${process.cwd()}/${filePath}`,
  sendRequest: async (languageId: string, method: string, params: unknown, timeoutMs: number) => {
    // 通过 manager 发送请求
  },
  sendNotification: (languageId: string, method: string, params?: unknown) => {
    // 通过 manager 发送通知
  },
  getRunningClients: () => manager.getClients().map((c) => ({ languageId: c.languageId, state: c.state })),
  getDiagnostics: (languageId: string, uri: string) => manager.getDiagnostics(uri),
};

const locations = await requestLspLocations(deps, "textDocument/definition", "src/main.ts", 10, 5);
```

## 与外部系统的交互

| 外部模块                      | 交互方式                             | 说明                                                |
| ----------------------------- | ------------------------------------ | --------------------------------------------------- |
| `@tool/lsp`                   | 调用 `lspManager`                    | LSP 工具通过 Manager 执行代码导航、补全等操作       |
| `@search/*`                   | 调用 `detectLanguage` + `lspManager` | 符号提取、索引分块、文件监控依赖语言检测和 LSP 能力 |
| `@ui/hooks/useLspDiagnostics` | 监听诊断变更                         | UI 侧边栏消费 Manager 的诊断缓存                    |
| `@core/logging/logger`        | 日志记录                             | 所有子模块的日志输出                                |
| `@core/errors/appError`       | 错误创建                             | 结构化错误载荷                                      |
| `@bus/eventBus`               | 诊断变更事件                         | Manager 通过事件总线通知诊断更新                    |

## 配置项

### LspConfig（用户配置文件）

配置文件路径（按优先级）：

1. `.claude/config.json` 中的 `lsp` 节
2. `.claude/lsp.json`
3. `.crab/config.json` 中的 `lsp` 节（向后兼容）
4. `.crab/lsp.json`（向后兼容）

| 配置项     | 类型                                      | 默认值 | 说明                      |
| ---------- | ----------------------------------------- | ------ | ------------------------- |
| `servers`  | `Record<string, UserLspServerConfig>`     | `{}`   | 自定义 LSP Server 定义    |
| `disabled` | `string[]`                                | `[]`   | 禁用的内置 Server ID 列表 |
| `settings` | `Record<string, Record<string, unknown>>` | `{}`   | 覆盖内置 Server 的设置    |

### UserLspServerConfig（单个 Server 配置）

| 配置项                  | 类型                      | 默认值    | 说明                |
| ----------------------- | ------------------------- | --------- | ------------------- |
| `command`               | `string`                  | 必需      | LSP Server 启动命令 |
| `args`                  | `string[]`                | `[]`      | 命令参数            |
| `languages`             | `string[]`                | 必需      | 支持的语言 ID 列表  |
| `transport`             | `"stdio" \| "socket"`     | `"stdio"` | 通信方式            |
| `initializationOptions` | `Record<string, unknown>` | `{}`      | LSP 初始化选项      |
| `settings`              | `Record<string, unknown>` | `{}`      | Server 额外设置     |

## 边界与限制

1. **仅支持 stdio 传输** — 当前实现仅支持通过 stdio 与 LSP Server 通信
2. **进程级隔离** — 每个语言 ID 对应独立的 LSP Server 进程
3. **诊断缓存仅内存** — 诊断数据不持久化，进程重启后丢失
4. **懒启动策略** — 客户端仅在首次请求时启动，不会预加载所有语言
5. **连接数限制** — 默认最大 8 个并发连接，超出时按 FIFO 淘汰
6. **请求超时** — 默认 5 秒超时，超时后自动清理 pending 请求
7. **配置热更新需文件存在** — ConfigWatcher 仅在配置文件存在时启动监听

## 设计决策

| 决策                                                  | 原因                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 双客户端架构（`LSPClient` + `LspManager` 内部客户端） | `LSPClient` 为独立封装，支持未来连接池复用；Manager 内部客户端为轻量级进程管理，满足当前工具调用场景 |
| 诊断通过事件通知而非轮询                              | 避免频繁请求，LSP Server 主动推送 `publishDiagnostics` 通知                                          |
| 配置验证与加载分离                                    | 验证不依赖文件系统，便于单元测试；加载合并内置与自定义配置                                           |
| 高级功能通过依赖注入                                  | `managerFeatures` 不直接依赖 Manager 类，便于测试和未来扩展                                          |
| 单一入口 `index.ts`                                   | 外部模块统一通过 `@lsp` 引用，内部子模块路径对外透明                                                 |

## 故障排查

| 现象              | 可能原因                        | 排查步骤                                                    |
| ----------------- | ------------------------------- | ----------------------------------------------------------- |
| LSP Server 未启动 | 命令未安装                      | 检查 `isServerInstalled()` 返回值，查看 `installHint`       |
| 请求超时          | Server 响应慢或卡死             | 检查日志中 `LSP 请求超时` 记录，尝试增加 `requestTimeout`   |
| 诊断为空          | 文件未通过 `didOpen` 同步       | 确认调用 `manager.didOpen()` 或 `notifyLspDidOpen()`        |
| 配置热更新不生效  | 配置文件路径错误或监听器未启动  | 检查 `.claude/lsp.json` 是否存在，查看 `ConfigWatcher` 状态 |
| 连接池已满        | 并发语言数超过 `maxConnections` | 增加 `maxConnections` 或检查是否有泄漏的连接未释放          |
| 语言检测失败      | 文件扩展名未注册                | 检查 `language.ts` 中的 `EXTENSION_MAP` 是否包含该扩展名    |

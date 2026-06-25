# MCP Module — Model Context Protocol 客户端

## 整体定位

MCP (Model Context Protocol) 模块是系统的外部工具集成核心，负责连接和管理外部 MCP Server，将第三方工具和服务以标准化的方式暴露给 AI 会话使用。它提供完整的 MCP 客户端生命周期管理、OAuth 认证支持、工具 Schema 转换、风险分级和权限控制，是 AI 扩展能力的关键入口。

## 核心功能

1. **MCP 客户端** — 与单个 MCP Server 建立 STDIO/SSE/HTTP 连接，发现工具、调用工具、管理 prompts 和 resources
2. **多 Server 管理** — 同时管理多个 MCP Server 的生命周期，自动重连、状态监控、工具聚合
3. **配置管理** — 从全局 (`~/.crab/mcp.json`) 和项目级 (`.crab/mcp.json`) 加载和合并配置，支持环境变量插值
4. **OAuth 认证** — 完整的 OAuth 2.0 支持，包括 PKCE、回调服务器、令牌持久化、自动刷新
5. **工具转换** — 将 MCP JSON Schema 转换为内部 Zod 类型，生成带命名空间前缀的工具名称
6. **风险分级** — 基于工具名称和描述模式识别高/中风险工具，映射到不同的权限命名空间
7. **命令解析** — 解析 STDIO 传输的命令配置，支持环境变量插值和 npx-to-bunx 自动回退
8. **运行时编排** — 单例模式管理 MCP 运行时，提供 OAuth 流程、快照聚合、服务器/工具启用控制

## 目录结构

```
src/mcp/
├── index.ts              # 统一出入口（值导出），所有外部引用通过此文件
├── types.ts              # 统一出入口（类型导出），避免循环依赖
├── README.md             # 本文档
│
├── client/               # 客户端核心
│   ├── mcpClient.ts      # MCP 客户端类：连接生命周期、工具发现、调用
│   └── transport.ts      # 传输层工厂：STDIO/SSE/HTTP 创建、OAuth 配置
│
├── manager/              # 管理器
│   ├── mcpManager.ts     # 多 Server 管理器：生命周期、重连、状态监控
│   ├── mcpConfig.ts      # 配置加载：全局+项目级合并、环境变量插值
│   └── runtime.ts        # 运行时编排：单例 facade、OAuth 流程、快照
│
├── tool/                 # 工具处理
│   ├── toolConverter.ts  # Schema 转换：JSON Schema → Zod、工具命名
│   └── riskClassification.ts # 风险分级：高/中风险模式匹配、权限映射
│
├── oauth/                # OAuth 认证
│   ├── oauthStore.ts     # 凭据存储：~/.crab/mcp-auth.json 读写
│   ├── oauthProvider.ts  # OAuth 提供者：MCP SDK OAuthClientProvider 实现
│   ├── oauthCallback.ts  # 回调服务器：本地 HTTP 监听授权码回调
│   └── oauthIntegration.ts # 测试集成：Mock OAuth 服务器
│
├── cmd/                  # 命令解析
│   └── commandResolution.ts # STDIO 命令解析：环境变量插值、命令查找
│
└── core/                 # 核心基础
    └── errors.ts         # 错误处理：MCP 错误分类、AppError 映射
```

## 子模块说明

| 子模块     | 职责                           | 主要导出                                                                                  |
| ---------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `client/`  | MCP 客户端 + 传输层            | `McpClient`, `createTransport`, `isConnectionError`, `shouldFallbackToSSE`                |
| `manager/` | 多 Server 管理 + 配置 + 运行时 | `McpManager`, `loadMcpConfig`, `ensureMcpRuntimeStarted`, `getMcpRuntimeSnapshot`         |
| `tool/`    | 工具转换 + 风险分级            | `mcpToolToToolDefinition`, `classifyMcpToolRisk`, `getMcpToolPermissionNamespace`         |
| `oauth/`   | OAuth 存储 + 提供者 + 回调     | `readOAuthStore`, `McpOAuthProvider`, `ensureOAuthCallbackServer`, `waitForOAuthCallback` |
| `cmd/`     | 命令解析                       | `resolveStdioCommand`, `interpolateEnvVars`                                               |
| `core/`    | 错误处理                       | `createMcpError`, `getMcpErrorMessage`, `toMcpLogPayload`                                 |

## 完整 API 导出

### index.ts 值导出

```typescript
import {
  // ─── 客户端 ──────────────────────────────────────────
  McpClient,
  isConnectionError,

  // ─── 管理器 ──────────────────────────────────────────
  McpManager,
  loadMcpConfig,
  getMcpServers,
  resetMcpConfigCache,
  getProjectMcpConfigPath,

  // ─── 运行时 ──────────────────────────────────────────
  getMcpRuntimeSnapshot,
  getMcpRuntimePrompts,
  getMcpRuntimeResources,
  getMcpRuntimePrompt,
  readMcpRuntimeResource,
  getMcpRuntimeAuthStatus,
  getMcpRuntimeAuthCapabilities,
  getMcpRuntimeBuiltinSnapshot,
  getMcpRuntimeDisplaySnapshot,
  startMcpRuntimeAuth,
  waitForMcpRuntimeAuthCode,
  finishMcpRuntimeAuth,
  finishMcpRuntimeAuthCode,
  cancelMcpRuntimeAuth,

  // ─── OAuth ───────────────────────────────────────────
  McpOAuthProvider,
  readOAuthStore,
  getOAuthEntry,
  setOAuthEntry,
  removeOAuthEntry,
  updateOAuthTokens,
  updateOAuthClientInfo,
  updateOAuthSession,
  clearOAuthSession,
  deriveMcpAuthStatus,
  supportsMcpOAuth,
  ensureOAuthCallbackServer,
  waitForOAuthCallback,
  cancelPendingOAuthCallback,
  stopOAuthCallbackServer,
  isOAuthCallbackServerRunning,
  parseOAuthRedirectUri,

  // ─── 命令解析 ────────────────────────────────────────
  interpolateEnvVars,
  interpolateEnvVarsInArray,
  interpolateEnvVarsInRecord,
} from "@mcp";
```

### types.ts 类型导出

```typescript
import type { McpServerStatusItem } from "@/mcp/types";
// 其他类型(McpConnectionState, McpClientOptions 等)通过 index.ts 的 inline type 导出使用
```

## 使用方法

### 启动 MCP 运行时

```typescript
import { ensureMcpRuntimeStarted, getMcpRuntimeSnapshot } from "@mcp";

// 应用启动时初始化
await ensureMcpRuntimeStarted();

// 获取所有 Server 状态
const snapshot = getMcpRuntimeSnapshot();
for (const server of snapshot.external) {
  console.log(`${server.name}: ${server.state} (${server.toolCount} tools)`);
}
```

### OAuth 认证流程

```typescript
import {
  getMcpRuntimeAuthStatus,
  getMcpRuntimeAuthCapabilities,
  startMcpRuntimeAuth,
  waitForMcpRuntimeAuthCode,
  finishMcpRuntimeAuthCode,
} from "@mcp";

// 检查认证状态
const status = getMcpRuntimeAuthStatus("my-mcp-server");
if (status === "not_authenticated") {
  // 检查是否支持 OAuth
  const caps = getMcpRuntimeAuthCapabilities("my-mcp-server");
  if (caps.supportsOAuth) {
    // 启动 OAuth 流程
    await startMcpRuntimeAuth("my-mcp-server");
    // 等待浏览器回调（自动处理）
    // 完成授权码交换
    await finishMcpRuntimeAuthCode("my-mcp-server", authCode);
  }
}
```

### 配置管理

```typescript
import { loadMcpConfig, setGlobalMcpServerEnabled } from "@mcp";

// 加载配置（自动合并全局 + 项目级）
const config = loadMcpConfig("/path/to/project");

// 启用/禁用 Server
await setGlobalMcpServerEnabled("github-mcp", false);
```

## 与外部系统的交互

| 外部模块                           | 交互方式                        | 说明                                          |
| ---------------------------------- | ------------------------------- | --------------------------------------------- |
| `@server/*`                        | 调用 `ensureMcpRuntimeStarted`  | 各 Server 入口点启动时初始化 MCP 运行时       |
| `@bus/events/mcpEvents`            | 消费 `McpServerStatusItem` 类型 | 事件总线发布 MCP Server 状态变更              |
| `@team/execution/teamLoopMessages` | 调用 `classifyMcpToolRisk`      | 工具执行前进行风险分级和权限检查              |
| `@ui/pages/mcp`                    | 消费运行时快照和 OAuth 流程     | MCP 管理 UI 页面                              |
| `@tool/registry/toolRegistry`      | 注册/注销 MCP 工具              | Manager 将发现的 MCP 工具同步到全局工具注册表 |
| `@core/logging/logger`             | 日志记录                        | 所有子模块的日志输出                          |
| `@schema/config`                   | 读取 MCP 配置 Schema            | 配置校验和数据类型定义                        |

## 配置项

### MCP 配置文件

配置文件路径（按优先级）：

1. `.crab/mcp.json`（项目级）
2. `~/.crab/mcp.json`（全局级）

配置格式支持两种形式：

**嵌套格式：**

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

**扁平格式：**

```json
{
  "github": {
    "command": "npx",
    "args": ["@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
  }
}
```

| 配置项          | 类型                         | 默认值    | 说明                           |
| --------------- | ---------------------------- | --------- | ------------------------------ |
| `command`       | `string`                     | 必需      | 启动命令（STDIO 传输）         |
| `args`          | `string[]`                   | `[]`      | 命令参数                       |
| `env`           | `Record<string, string>`     | `{}`      | 环境变量（支持 `${VAR}` 插值） |
| `type`          | `"stdio" \| "sse" \| "http"` | `"stdio"` | 传输类型                       |
| `url`           | `string`                     | -         | SSE/HTTP 传输的 URL            |
| `headers`       | `Record<string, string>`     | `{}`      | HTTP 请求头                    |
| `disabled`      | `boolean`                    | `false`   | 是否禁用该 Server              |
| `disabledTools` | `string[]`                   | `[]`      | 禁用的工具名称列表             |

## 边界与限制

1. **STDIO 仅支持单向通信** — 通过 stdin 发送请求，stdout 接收响应
2. **OAuth 回调仅本地 HTTP** — 监听 `127.0.0.1:19876`，不支持 HTTPS
3. **连接超时 30 秒** — 默认连接超时，可通过 `MCP_CONNECT_TIMEOUT_MS` 配置
4. **工具调用超时 300 秒** — 默认调用超时，可通过 `MCP_CALL_TIMEOUT_MS` 配置
5. **配置缓存** — 配置加载后有缓存，需调用 `resetMcpConfigCache()` 强制刷新
6. **自动重连上限 3 次** — 默认最大重试次数，使用指数退避策略
7. **风险分级基于模式匹配** — 不进行语义分析，可能有误报/漏报

## 设计决策

| 决策                 | 原因                                                           |
| -------------------- | -------------------------------------------------------------- |
| 单例运行时模式       | 全局只有一个 McpManager 实例，避免多 Server 重复连接和资源竞争 |
| 传输层与客户端分离   | `transport.ts` 独立封装传输创建逻辑，便于支持多种传输类型      |
| OAuth 回调独立服务器 | 独立的回调服务器避免阻塞主事件循环，支持多 Server 并发授权     |
| 风险分级模式匹配     | 基于工具名称和描述的正则模式匹配，轻量且可扩展                 |
| 配置合并策略         | 项目级覆盖全局级，支持不同项目使用不同的 MCP 配置              |
| 类型与值分离导出     | `types.ts` 单独作为类型入口，避免循环依赖和类型导入问题        |

## 故障排查

| 现象             | 可能原因             | 排查步骤                                                                   |
| ---------------- | -------------------- | -------------------------------------------------------------------------- |
| Server 连接失败  | 命令不存在或路径错误 | 检查 `command` 配置，确认命令在 PATH 中                                    |
| OAuth 回调超时   | 浏览器未正确重定向   | 检查 `redirect_uri` 配置是否为 `http://127.0.0.1:19876/mcp/oauth/callback` |
| 工具调用超时     | Server 响应慢或卡死  | 检查日志中 `MCP 请求超时` 记录，增加 `callTimeout`                         |
| 配置不生效       | 配置缓存未刷新       | 调用 `resetMcpConfigCache()` 或重启应用                                    |
| 环境变量未插值   | 语法错误或变量未设置 | 检查 `${VAR}` 语法，确认环境变量已设置                                     |
| 工具风险分级错误 | 模式匹配不准确       | 检查 `riskClassification.ts` 中的模式定义                                  |

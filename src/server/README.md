# Server 模块

crab-cli 的服务端核心层，提供 SSE 流式通信、ACP 协议（HTTP + stdio）、Headless 无头执行、SSH 远程命令、实时协作等能力。

## 子系统总览

```
src/server/
├── index.ts                  # 公共导出入口
├── type.ts                   # 公共类型导出（待合并入 index.ts）
├── errors.ts                 # 服务端错误分类与日志载荷
├── apiRoutes.ts              # REST API 路由（健康检查 / 会话 CRUD / 回滚点等）
├── apiDocs.ts                # OpenAPI 契约 + HTML 文档 + JS 客户端生成
│
├── sseServer.ts              # SSE 服务器（Bun.serve，流式响应 + WebSocket 协作）
├── sseModes.ts               # SSE 进程模式编排（前台 / 后台守护 / 停止 / 状态）
├── sseManager.ts             # SSE 进程管理（PID 文件 / 状态查询 / 端口检测）
├── sseSecurity.ts            # SSE 安全层（Origin 白名单 / Token 鉴权 / CORS）
│
├── acpServer.ts              # ACP HTTP 服务器（会话管理 + 消息处理）
├── acpStdio.ts               # ACP stdio 传输（JSON-RPC 2.0，stdin/stdout 桥接）
├── acpManager.ts             # ACP 进程管理（PID 文件 / 启动停止）
│
├── headless.ts               # HeadlessRunner（非交互式 Agent 执行）
├── taskRunner.ts             # 后台任务管理（持久化 / 进程协调 / 历史清理）
│
├── collaboration.ts          # 协作房间管理（WebSocket 消息路由 / 房间广播）
├── signalrCompat.ts          # SignalR 协议兼容层（帧转换 / negotiate / 握手）
│
├── shellManager.ts           # Shell 管理器（本地 + SSH 远程命令执行）
│
├── connection/               # 连接管理（local / ssh / docker / wsl）
│   ├── types/                #   Connection 类型定义
│   ├── manager/              #   ConnectionManager 单例（CRUD + 生命周期）
│
├── ssh/                      # SSH 子系统
│   ├── client/               #   SSHClient 类 + ssh2 连接池
│   ├── workspace/            #   RemoteWorkspace + WorkspaceManager
│   └── safety/               #   CWE-78 防护（sanitize / denylist / shellQuote）
│
└── logRotation.ts            # 日志轮转（SSE daemon 专用）
```

## 子系统职责

### SSE 服务（sseServer / sseModes / sseManager / sseSecurity）

**职责**：通过 HTTP Server-Sent Events 提供实时 AI 流式响应，同时通过 WebSocket 支持多客户端实时协作。

**启动流程**：

```
sseMode() → startSseServer()
    ├─ sseManager.registerSseServer(port)      # 注册 PID 文件
    ├─ initTaskRuntime(cwd)                     # 初始化任务运行时
    ├─ ensureMcpRuntimeStarted()                # 启动 MCP Runtime
    ├─ Bun.serve({
    │     routes: {
    │       "/sse"              → SSE 客户端连接
    │       "/api/message"      → 消息接收（异步处理）
    │       "/api/clients"      → 客户端列表
    │       "/api/recording"    → 会话录制管理
    │       "/api/collaboration" → 协作状态
    │       "/collaborationHub/negotiate" → SignalR 协商
    │       "/api/health"       → 健康检查
    │     },
    │     websocket: { open/message/close } → 协作 WebSocket
    │   })
    └─ startHeartbeat()            # 30s 心跳检测
```

**关键限制**：

- `MAX_SSE_CLIENTS = 50`：最大 SSE 客户端数
- `MAX_SESSION_HANDLERS = 50`：最大缓存的 ConversationHandler 数
- `SSE_MESSAGE_BODY_LIMIT_BYTES = 1MB`：请求体大小限制

**安全**：Origin 白名单 + `CRAB_API_TOKEN` 鉴权（时序安全比较）

### ACP 服务（acpServer / acpStdio / acpManager）

**职责**：实现 Agent Communication Protocol，提供两种传输通道：

- **HTTP 通道**（`acpServer.ts`）：RESTful API，会话管理 + 消息处理
- **stdio 通道**（`acpStdio.ts`）：JSON-RPC 2.0 over stdin/stdout，通过 `@agentclientprotocol/sdk` 桥接

**启动流程**：

```
ACP HTTP: startAcpServer() → Bun.serve({ routes: { "/acp/..." } })
ACP stdio: startAcpStdio() → AgentSideConnection → CrabCliAgent
```

**会话存储**：进程内 Map，重启后丢失。stdio 模式通过 `CrabCliAgent.sessions` 静态 Map 维护。

**安全**：非 localhost 绑定时强制要求 `CRAB_API_TOKEN`；`allowLocalWithoutToken` 选项用于开发环境。

### Headless（headless.ts）

**职责**：非交互式 Agent 执行，支持三种权限模式：

- **默认**：拒绝所有权限请求（非交互模式无法弹窗）
- **YOLO**：自动执行，拒绝高风险操作（`mcp.sensitive` / `__sensitive: true`）
- **Background**：通过外部权限审批桥接（`submitExternalPermissionRequest`）

**启动流程**：

```
HeadlessRunner.run(prompt, options)
    ├─ loadConfig()
    ├─ initTaskRuntime()
    ├─ ensureMcpRuntimeStarted()（可选，mcp: "disabled" 可跳过）
    ├─ 创建 ConversationHandler
    ├─ 订阅 globalBus（token / toolCall / toolResult）
    ├─ sendMessage(prompt)（支持 AbortController 超时）
    └─ 输出结果到 stdout（text 或 json 格式）
```

**依赖**：依赖 `@/ui/contexts/chatHelpers` 的 `buildChatRuntimeOverrides`，这是已知的技术债务（Headless 不应依赖 UI 模块）。

### 任务管理（taskRunner.ts）

**职责**：后台任务的生命周期管理，通过 `.crab/tasks/` 目录实现跨进程可见性。

**关键机制**：

- **文件锁**：`tasks.lock` 目录 + `owner.json`，防止并发写冲突
- **进程协调**：`isProcessAlive(pid)` 检测，僵尸进程自动标记为 failed
- **历史清理**：保留最近 200 个已完成任务 + 30 天内的任务

### 协作（collaboration.ts + signalrCompat.ts）

**职责**：基于 sessionId 的多客户端实时协作房间。

**协议**：

- **原生协议**：`{ type: "join" | "leave" | "cursor" | "typing" | "ping" }`
- **SignalR 兼容**：通过 `signalrCompat.ts` 转换 SignalR 帧格式，支持 .NET 客户端接入

**消息流**：

```
globalBus → CollaborationManager.broadcastToRoom() → WebSocket 客户端
```

### SSH 子系统（ssh/）

**职责**：远程命令执行 + 工作空间管理 + CWE-78 防护。

**三层结构**：

```
SSHClient（client.ts）        → 命令执行 + SFTP 操作
    ↓ 依赖
SSHConnectionPool（pool.ts）  → 连接复用 + 空闲清理
    ↓ 依赖
RemoteWorkspace（workspace.ts） → 路径解析 + 验证
```

**安全**：

- `sanitizeSSHCommand()`：拒绝 shell 元字符
- `checkSSHDenylist()`：拒绝危险命令模式（rm -rf /, curl|sh 等）
- `makeSSHCommandSafe()`：sanitize + denylist 一步完成
- `dangerousAllow`：逃逸口（仅限受信任来源）

### 连接管理（connection/）

**职责**：统一管理多种连接类型（local / ssh / docker / wsl），单例模式。

**当前状态**：docker / wsl 为实验性 stub，抛出 `NOT_IMPLEMENTED` 错误。

## 启动顺序与进程模型

### 前台模式（`--sse`）

```
主进程 → startSseServer() → Bun.serve() → 阻塞直到 Ctrl+C
```

### 后台守护模式（`--sse-daemon`）

```
父进程 → Bun.spawn(子进程) → 写入 PID 文件 → 父进程退出
子进程 → startSseServer() → 注册 ready → 后台运行
```

### ACP 独立进程

```
主进程 → startAcpServer() → Bun.serve() → 阻塞
        或 startAcpStdio() → AgentSideConnection → 阻塞 stdin
```

### Headless 模式

```
主进程 → HeadlessRunner.run() → 执行完成 → 退出
```

## 环境变量

| 变量                | 说明                                    | 默认值 |
| ------------------- | --------------------------------------- | ------ |
| `CRAB_API_TOKEN`    | API 鉴权 Token，非 localhost 绑定时必填 | 无     |
| `CRAB_HEADLESS_MCP` | Headless 模式是否启动 MCP Runtime       | `"1"`  |
| `CRAB_SSE_PORT`     | SSE 服务器端口                          | `3000` |
| `CRAB_ACP_PORT`     | ACP HTTP 服务器端口                     | `3001` |

## 模块间依赖

```
外部模块 → src/server/
├── src/tool/bash/          → shellManager, sshClient
├── src/tool/codebaseSearch/ → sshClient
├── src/cli/                → sseModes types
└── src/ide/                → (间接通过 apiRoutes)

src/server/ 内部依赖
├── sseServer → sseSecurity, errors, collaboration, signalrCompat, apiRoutes
├── acpServer → errors, session, conversation, mcp, bus
├── headless  → errors, session, conversation, mcp, bus, ui/chatHelpers ⚠️
├── taskRunner → config, utilities, mission/types
└── apiRoutes → config, mcp, monitor, session, rollback
```

## 已知技术债务

| 问题                                                                | 影响                  | 计划                                                                               |
| ------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------- | ---- |
| `shellQuote` 重复定义                                               | 维护风险              | ✅ 已合并到 `ssh/safety/index.ts`                                                  |
| `acpStdio.ts` 缺少 `crypto` import                                  | TypeScript 编译错误   | ✅ 已修复                                                                          |
| Auth 逻辑三处重复                                                   | 策略变更遗漏风险      | ✅ 已修复 — `authGuard.ts` 作为单一真相源，三处鉴权统一使用 `extractBearerToken()` |
| 无 README                                                           | 新成员上手困难        | ✅ 本文档                                                                          |
| Headless 依赖 `@/ui`                                                | 模块边界污染          | ✅ 已解耦 — `buildChatRuntimeOverrides` 迁移至 `@/agent/prompt/runtimeOverrides`   |
| `Bun.sleepSync` 阻塞事件循环                                        | 高负载下 SSE 心跳暂停 | ✅ 已修复 — `sseManager` 改为 `await Bun.sleep()`                                  |
| `type.ts` 与 `index.ts` 重复导出                                    | 类型维护双份          | ✅ 已删除 `type.ts`，`connection/types` 已合并                                     |
| `recorder["recordingId"]` 私有字段访问                              | 类型安全风险          | ✅ 已添加 `currentRecordingId` 公共 getter                                         |
| `readJsonBody` 无请求体大小限制                                     | 内存耗尽风险          | ✅ 已添加 1MB 上限                                                                 |
| `shellManager` `as any` 类型转换                                    | 类型安全              | ✅ 已使用非参数化 `Subprocess` 类型                                                |
| SSH denylist `rm -rf *` 正则不匹配                                  | 安全绕过              | ✅ 已修复为 `/(?:\s                                                                | $)/` |
| `logRotation` close 后仍可写入                                      | 数据一致性            | ✅ 已添加 `closed` 标志                                                            |
| `connection/type.ts` + `connection/types/index.ts` 重复             | 维护双份              | ✅ 已合并为 `connection/types.ts`                                                  |
| `ssh/type.ts` 中间层 barrel re-export                               | 类型入口不统一        | ✅ 已删除，类型统一通过 `ssh/index.ts` 导出                                        |
| `shellManager` sshSearch 命令注入（query 未转义）                   | CWE-78 安全漏洞       | ✅ 已使用 `shellQuote` + `escapeFindGlob` 防护                                     |
| `shellManager` 进程 ID 使用 `Date.now()` 存在碰撞风险               | 并发安全              | ✅ 已改用 `crypto.randomUUID()`                                                    |
| sseServer `/api/recording` 端点 body 无大小限制                     | 内存耗尽风险          | ✅ 已改用 `readJsonBodyWithLimit` + 413 响应                                       |
| acpServer `/acp/sessions/:id/msg` body 无大小限制                   | 内存耗尽风险          | ✅ 已添加 `ACP_MESSAGE_BODY_LIMIT_BYTES` + 413 响应                                |
| sseSecurity/acpServer/apiRoutes 内联 Bearer 提取逻辑                | 维护双份              | ✅ 已统一使用 `extractBearerToken()`                                               |
| sseServer `(ws as any).data` / `(server as any).upgrade` 类型不安全 | 类型安全              | ✅ 已通过 `bun-serve.d.ts` 模块增强移除所有 `as any`                               |

## 测试覆盖

| 模块          | 测试文件                                 | 状态 |
| ------------- | ---------------------------------------- | ---- |
| sseServer     | `test/unit/server/sseDaemon.test.ts`     | ✅   |
| acpServer     | `test/unit/server/acpServer.test.ts`     | ✅   |
| acpStdio      | `test/unit/server/acpStdio.test.ts`      | ✅   |
| headless      | `test/unit/server/headless.test.ts`      | ✅   |
| apiRoutes     | `test/unit/server/apiRoutes.test.ts`     | ✅   |
| taskRunner    | `test/unit/server/taskRunner*.test.ts`   | ✅   |
| ssh/safety    | `test/unit/server/sshSafety.test.ts`     | ✅   |
| ssh/client    | `test/unit/server/sshClient.test.ts`     | ✅   |
| ssh/workspace | `test/unit/server/sshWorkspace.test.ts`  | ✅   |
| shellManager  | `test/unit/server/shellManager.test.ts`  | ✅   |
| collaboration | `test/unit/server/collaboration.test.ts` | ✅   |
| signalrCompat | `test/unit/server/signalrCompat.test.ts` | ✅   |
| connection    | `test/helpers/connectionManagerSuite.ts` | 部分 |
| logRotation   | `test/unit/server/logRotation.test.ts`   | ✅   |
| sseSecurity   | `test/unit/server/sseSecurity.test.ts`   | ✅   |
| authGuard     | `test/unit/server/authGuard.test.ts`     | ✅   |

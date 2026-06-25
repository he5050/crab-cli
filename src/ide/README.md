# IDE Module — IDE 集成交互引擎

## 整体定位

IDE 模块是系统与开发环境（VSCode、JetBrains 等）的集成交互引擎，负责建立和维护与 IDE 的双向通信通道，获取编辑器上下文（活动文件、选区、光标位置），接收诊断信息，并向 IDE 发送交互指令（显示 diff、代码导航等）。它与对话系统（`@conversation/llmLoop`）联动，将编辑器上下文注入到 AI 提示词中，提升 AI 对当前开发环境的感知能力。

## 核心功能

1. **IDE 检测** — 通过环境变量和端口文件检测当前终端所属的 IDE 及可用实例
2. **WebSocket 服务端** — 接收 IDE 扩展的入站连接，管理多客户端生命周期
3. **WebSocket 客户端** — 主动连接 VSCode 扩展，支持自动重连和指数退避
4. **编辑器上下文同步** — 实时接收并聚合多 IDE 客户端的编辑器状态
5. **诊断数据获取** — 请求和接收文件编译错误、警告、lint 诊断
6. **IDE 交互代理** — 向 IDE 发送 diff 展示、代码导航、符号查询等请求
7. **扩展安装管理** — 通过 CLI 安装和检测 VSCode 扩展
8. **JetBrains 集成** — 通过 REST API 与 JetBrains IDE 通信
9. **Token 认证** — 可选的 WebSocket 连接认证机制
10. **能力面文档** — 静态描述 VSIX 扩展的实现能力

## 目录结构

```
src/ide/
├── index.ts              # 统一出入口，所有外部引用通过此文件
├── type.ts               # 类型专用入口（仅导出类型，不含运行时值）
├── README.md             # 本文档
│
├── types/                # 核心类型定义
│   └── index.ts          # IDE 名称、诊断、编辑器上下文、连接状态等类型
│
├── errors/               # 错误处理
│   └── index.ts          # IDE 错误工厂、日志载荷提取
│
├── detection/            # IDE 检测
│   ├── index.ts          # 统一导出
│   └── detector.ts       # 环境变量检测、端口文件扫描
│
├── client/               # IDE 客户端
│   ├── index.ts          # 统一导出
│   ├── vscodeConnection.ts  # VSCode WebSocket 客户端（主动连接）
│   └── jetbrains.ts      # JetBrains REST API 客户端
│
├── extension/            # 扩展管理
│   ├── index.ts          # 统一导出
│   └── installer.ts      # VSCode 扩展安装器
│
├── context/              # 编辑器上下文
│   ├── index.ts          # 统一导出
│   └── editorContext.ts  # 向后兼容的上下文 facade
│
├── connection/           # 连接管理（内部模块）
│   ├── index.ts          # 统一导出
│   ├── wsServer.ts       # WebSocket 服务端（接收 IDE 扩展连接）
│   ├── stateManager.ts   # 聚合连接状态管理
│   ├── contextManager.ts # 上下文聚合与提示生成
│   ├── interactionManager.ts # IDE 交互请求路由器
│   └── wsMessageAdapters.ts  # JSON-RPC ↔ 内部数据适配器
│
├── shared/               # 共享工具
│   └── pathUtils.ts      # 路径规范化、IDE 常量
│
└── vsix/                 # VSIX 能力面
    └── index.ts          # 扩展能力静态描述
```

## 子模块说明

### `types/` — 核心类型定义

定义 IDE 集成相关的所有类型，包括：

- `IDEName` / `IDEInfo` — IDE 元信息
- `Diagnostic` / `DiagnosticSeverity` — 诊断负载
- `EditorContext` / `CursorPosition` — 编辑器上下文
- `ConnectionStatus` — 连接状态枚举
- `WSMessageType` — WebSocket 消息类型枚举
- `ExtensionInstallResult` — 扩展安装结果

### `errors/` — 错误处理

提供 IDE 相关错误的标准化处理：

- `IdeErrorReason` — 错误原因枚举（callback / client_missing / handler / unsupported_request）
- `createIdeError()` — 将任意异常包装为 `AppError`
- `getIdeErrorMessage()` — 从 unknown 提取错误消息
- `toIdeLogPayload()` — 提取日志用的最小载荷

### `detection/` — IDE 检测

检测当前环境和可用 IDE 实例：

- `detectIDE()` — 通过 `TERM_PROGRAM` 和 `GIT_ASKPASS` 环境变量检测 IDE
- `isExtensionInstalled()` — 通过 `CRAB_CALLER` 环境变量检测扩展
- `getAvailableIDEs()` — 扫描 `~/.crab/tmp/ide/crab-ide-ports.json` 获取可用实例
- `hasMatchingIDE()` — 检查当前工作目录是否有匹配的 IDE

### `client/` — IDE 客户端

主动连接 IDE 的客户端实现：

- `VSCodeConnection` — VSCode WebSocket 客户端（单例）
  - 自动扫描并连接匹配的 VSCode 端口
  - 接收编辑器上下文推送
  - 请求诊断数据
  - 断线自动重连（指数退避）
  - Diff 展示和关闭
- `vscodeConnection` — 全局单例实例
- JetBrains REST API 客户端：
  - `detectJetBrainsInstances()` — 扫描 `/tmp/.jetbrains.*` 文件
  - `getJetBrainsEditorState()` — 获取编辑器状态
  - `getJetBrainsDiagnostics()` — 获取诊断信息
  - `openInJetBrains()` — 在 JetBrains IDE 中打开文件

### `extension/` — 扩展管理

VSCode 扩展安装和检测：

- `installExtension()` — 通过 `code --install-extension` 安装扩展
- `isExtensionInstalledCli()` — 通过 `code --list-extensions` 检测安装状态
- 发布 `AppEvent.IDEExtensionInstalled` 事件通知安装结果

### `context/` — 编辑器上下文

提供向后兼容的编辑器上下文接口：

- `buildEditorContextPrompt()` — 构建编辑器上下文的文本表示，注入到 AI 提示词
- `hasEditorContext()` — 检查是否有可用的编辑器上下文
- `getEditorContextSummary()` — 获取上下文摘要（用于日志）
- `onEditorContextChange()` — 注册上下文变更监听器
- `startEditorContextWatch()` — 自动启动上下文监听

### `connection/` — 连接管理（内部模块）

WebSocket 服务端和状态管理，通常不直接从外部引用：

- `IDEWebSocketServer` / `ideWsServer` — WebSocket 服务端（接收 IDE 扩展连接）
- `IDEStateManager` / `ideStateManager` — 聚合多客户端状态
- `getAggregatedContext()` / `getAggregatedContextPrompt()` — 上下文聚合
- `wireInteractionManager()` / `registerInteractionHandler()` / `sendToIDE()` — IDE 交互
- `editorContextFromParams()` / `diagnosticsFromParams()` — 消息格式适配

### `shared/` — 共享工具

跨子模块共享的工具函数和常量：

- `normalizePath()` — 跨平台路径规范化（反斜杠→正斜杠、Windows 盘符小写）
- `IDE_CLI_COMMANDS` — IDE 名称到 CLI 命令的映射

### `vsix/` — VSIX 能力面

静态描述 VSCode 扩展的实现能力：

- `getVsixSurface()` — 返回扩展能力快照
- 列出已实现（implemented）、计划中（planned）、未规划（not_planned）的命令和能力

## 使用方法

### 基本引用

```typescript
// 完整引用（推荐）
import {
  detectIDE,
  vscodeConnection,
  buildEditorContextPrompt,
  hasEditorContext,
  type IDEName,
  type EditorContext,
  type Diagnostic,
} from "@ide";

// 仅类型引用（零运行时开销）
import type { IDEName, EditorContext, Diagnostic } from "@ide/type";
```

### 检测 IDE

```typescript
import { detectIDE, hasMatchingIDE, getAvailableIDEs } from "@ide";

const ide = detectIDE(); // "VSCode" | "VSCode Insiders" | "Cursor" | "unknown"
if (hasMatchingIDE()) {
  const { matched, unmatched } = getAvailableIDEs();
  console.log(`找到 ${matched.length} 个匹配的 IDE 实例`);
}
```

### 连接 VSCode

```typescript
import { vscodeConnection } from "@ide";

await vscodeConnection.start(); // 自动扫描并连接
console.log(vscodeConnection.getStatus()); // "connected"
console.log(vscodeConnection.getContext()); // EditorContext

// 监听上下文变更
const unsubscribe = vscodeConnection.onContextUpdate((ctx) => {
  console.log("编辑器上下文已更新:", ctx);
});
```

### 获取诊断

```typescript
import { vscodeConnection } from "@ide";

const diagnostics = await vscodeConnection.requestDiagnostics("/path/to/file.ts");
for (const diag of diagnostics) {
  console.log(`${diag.severity}: ${diag.message} (${diag.line}:${diag.character})`);
}
```

### 构建编辑器上下文提示

```typescript
import { buildEditorContextPrompt, hasEditorContext } from "@ide";

if (hasEditorContext()) {
  const prompt = buildEditorContextPrompt();
  // 注入到 AI 系统提示词中
  systemPrompt += prompt;
}
```

### 监听编辑器上下文变更

```typescript
import { onEditorContextChange } from "@ide";

const unsubscribe = onEditorContextChange((ctx) => {
  console.log("编辑器上下文变更:", ctx.activeFile);
});
```

### 安装扩展

```typescript
import { installExtension, isExtensionInstalledCli } from "@ide";

const result = await installExtension("VSCode");
if (result.success) {
  console.log("扩展安装成功");
}

const installed = await isExtensionInstalledCli("VSCode");
```

## 与外部系统的交互

### 与对话系统（`@conversation`）

- `buildEditorContextPrompt()` 被 `systemPrompt.ts` 调用，将编辑器上下文注入到 AI 提示词
- `hasEditorContext()` 用于判断是否需要注入上下文

### 与工具系统（`@tool`）

- `vscodeConnection.requestDiagnostics()` 被 `ideDiagnostics` 工具调用
- `Diagnostic` 类型被 `diagnostics.ts`、`editTools.ts`、`messageFormat.ts` 引用

### 与 UI 系统（`@ui`）

- `vscodeConnection` 和 `ConnectionStatus` 被 `ideStatus.tsx` 使用，显示连接状态
- `AppEvent.IDEConnected` / `AppEvent.IDEDisconnected` 驱动 UI 状态更新

### 与事件总线（`@bus`）

- 发布 `AppEvent.IDEConnected` — IDE 连接建立
- 发布 `AppEvent.IDEDisconnected` — IDE 连接断开
- 发布 `AppEvent.EditorContextChanged` — 编辑器上下文变更
- 发布 `AppEvent.IDEDiagnostics` — 诊断数据更新
- 发布 `AppEvent.IDEExtensionInstalled` — 扩展安装完成

## 架构说明

```
┌─────────────────┐          ┌──────────────────┐
│  VSCode 扩展     │◄────────►│  WebSocket 服务端 │
│  (vsix/)        │          │  (wsServer.ts)   │
└─────────────────┘          └────────┬─────────┘
                                      │
                                      ▼
                             ┌──────────────────┐
                             │  状态管理器       │
                             │  (stateManager)  │
                             └────────┬─────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  上下文管理器    │      │  交互管理器      │      │  VSCode 客户端   │
│  (contextMgr)   │      │  (interactionMgr)│      │  (vscodeConn)   │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                        全局事件总线 (globalBus)                  │
└─────────────────────────────────────────────────────────────────┘
```

1. **入站路径**：VSCode 扩展 → WebSocket 服务端 → 状态管理器 → 上下文管理器 → 全局事件总线
2. **出站路径**：业务代码 → VSCode 客户端 → WebSocket 连接 → VSCode 扩展
3. **交互路径**：业务代码 → 交互管理器 → WebSocket 服务端 → VSCode 扩展 → 用户操作 → 结果返回
4. **客户端路径（向后兼容）**：VSCode 客户端 → WebSocket 连接 → VSCode 扩展（已合并到服务端模式，客户端仅作向后兼容保留）

## 注意事项

1. **单例模式** — `vscodeConnection`、`ideWsServer`、`ideStateManager` 均为全局单例，不要重复创建
2. **工作区匹配** — 多工作区场景下，只有工作区路径匹配当前 `cwd` 的消息才会被处理
3. **Token 认证** — WebSocket 服务端默认生成随机 token 并写入文件，扩展需携带 token 连接
4. **自动重连** — VSCode 客户端断线后自动重连，最多尝试 10 次，指数退避（2s ~ 30s）
5. **向后兼容** — `editorContext.ts` 提供旧版 API 兼容，`buildEditorContextPrompt()` 委托到 `connection/contextManager`，`onEditorContextChange()` 仅订阅聚合上下文
6. **JetBrains 支持** — JetBrains 集成通过 REST API 实现，不依赖 WebSocket，功能相对有限
7. **JetBrains 支持** — JetBrains 集成为实验性功能（@experimental），通过 REST API 实现，需要 JetBrains 插件配合

## 测试

IDE 模块测试位于 `test/unit/ide/`，使用 bun:test 框架：

| 测试文件                     | 覆盖子模块           |
| ---------------------------- | -------------------- |
| `errors.test.ts`             | 错误处理工厂         |
| `detector.test.ts`           | IDE 检测             |
| `wsMessageAdapters.test.ts`  | WebSocket 消息适配器 |
| `contextManager.test.ts`     | 上下文聚合与提示生成 |
| `interactionManager.test.ts` | IDE 交互请求路由     |
| `jetbrains.test.ts`          | JetBrains 客户端     |
| `installer.test.ts`          | 扩展安装器           |
| `pathUtils.test.ts`          | 共享路径工具         |

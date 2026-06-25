# CLI 模块 — 命令行界面

## 整体定位

CLI 模块是 `crab-cli` 应用的入口层，负责解析命令行参数、路由到对应的运行模式（TUI / 无头 / SSE / ACP / 任务等），管理进程生命周期（信号处理 + 优雅关闭），并提供统一的 CLI 错误处理机制。

它不包含具体的业务逻辑实现，而是作为**编排层**协调各子系统的启动顺序和资源清理。具体的命令实现分散在 `@command/*`、`@server/*` 等模块中，CLI 模块仅负责路由和调度。

## 核心功能

1. **参数解析与路由** — 基于 `node:util.parseArgs` 解析 CLI 参数，识别 18 种运行模式
2. **多模式执行** — 支持 TUI、无头（headless）、SSE 服务器、ACP 协议、后台任务等模式
3. **进程生命周期管理** — SIGINT/SIGTERM/SIGBREAK 信号处理，优雅关闭流程
4. **依赖注入** — 通过 `CliOrchestratorDeps` 接口解耦编排器与具体实现
5. **统一错误处理** — CLI 错误分类（参数错误/路径错误/资源冲突等）+ 格式化输出
6. **帮助文本** — 用法部分从命令注册表动态生成，选项部分静态维护
7. **实例锁** — 防止同一项目目录下多个 crab-cli 实例并发运行

## 目录结构

```
src/cli/
├── index.ts              # 值导出入口（函数、常量），通过 @cli 引用
├── type.ts               # 类型导出入口（interface、type），通过 @cli/type 引用
├── README.md             # 本文档
├── errors.ts             # 错误处理（createCliError, writeCliError, CliErrorKind）
├── help.ts               # 帮助文本生成（用法部分从注册表动态生成，getHelpText, printHelp）
│
└── core/                 # 核心编排逻辑
    ├── index.ts          # 子模块统一导出（导入 commands 触发注册）
    ├── orchestrator.ts   # CLI 编排器（参数解析 + 命令路由 + safeImport）
    ├── lifecycle.ts      # 生命周期管理（信号处理 + 优雅关闭 + 依赖注入）
    ├── commands.ts       # 命令实现（16 个注册命令 + registerAllCommands）
    ├── commandRegistry.ts # 命令注册表（register/get/has/clear Map API）
    └── tuiRunner.ts      # TUI 运行器（TUI 启动流程封装）
```

## 子模块说明

| 子模块                    | 职责                                                               | 主要导出                                                                          |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `type.ts`                 | CLI 类型定义                                                       | `CliMode`, `ParsedCliArgs`, `CliOrchestratorDeps`                                 |
| `errors.ts`               | 错误处理                                                           | `createCliError`, `writeCliError`, `formatCliError`, `CliErrorKind`               |
| `help.ts`                 | 帮助文本（用法部分从注册表动态生成）                               | `getHelpText`, `printHelp`                                                        |
| `core/orchestrator.ts`    | 参数解析 + 命令路由 + safeImport                                   | `parseCliArgs`, `executeMode`, `safeImport`                                       |
| `core/lifecycle.ts`       | 进程生命周期                                                       | `installSignalHandlers`, `shutdown`, `setOrchestratorDeps`, `getOrchestratorDeps` |
| `core/commands.ts`        | 命令实现（16 个注册命令，help/version 由 orchestrator 硬编码拦截） | `setupCommand`, `headlessCommand`, `sseCommand` 等                                |
| `core/commandRegistry.ts` | 命令注册表                                                         | `registerCommand`, `getCommand`, `getAllCommands`, `__clearCommandRegistry`       |
| `core/tuiRunner.ts`       | TUI 启动流程                                                       | `runTui`                                                                          |

## 完整 API 导出

CLI 模块提供两个出入口文件：`index.ts`（值导出）和 `type.ts`（类型导出）。

### 类型导出（@cli/type）

```typescript
import type {
  CliMode, // 运行模式枚举（18 种模式）
  ParsedCliArgs, // 解析后的 CLI 参数
  CliOrchestratorDeps, // 编排器依赖注入接口
  CliErrorKind, // 错误分类类型
  CliErrorOptions, // 错误创建选项
  TuiRunOptions, // TUI 运行选项
} from "@cli/type";
```

### 值导出（@cli）

```typescript
import {
  // ─── 编排器 ──────────────────────────────────────────
  parseCliArgs, // 解析 CLI 参数
  executeMode, // 执行对应模式的命令

  // ─── 生命周期 ──────────────────────────────────────────
  installSignalHandlers, // 注册进程信号处理器
  shutdown, // 优雅关闭（含清理回调）
  setOrchestratorDeps, // 设置编排器依赖
  getOrchestratorDeps, // 获取编排器依赖
  __resetLifecycleForTest, // 测试重置

  // ─── TUI 运行器 ────────────────────────────────────────
  runTui, // 启动 TUI 模式

  // ─── 错误处理 ──────────────────────────────────────────
  createCliError, // 创建 CLI 错误（分类工厂）
  writeCliError, // 输出 CLI 错误到 stderr
  getCliErrorMessage, // 获取错误消息字符串
  formatCliError, // 格式化错误为可读字符串

  // ─── 帮助文本 ──────────────────────────────────────────
  getHelpText, // 获取帮助文本字符串
  printHelp, // 打印帮助文本到 stdout
} from "@cli";
```

## 使用方法

### 典型启动流程

```typescript
import { setOrchestratorDeps, installSignalHandlers, parseCliArgs, executeMode } from "@cli";
import type { CliOrchestratorDeps } from "@cli/type";

// 1. 注入依赖
setOrchestratorDeps({
  initDb: () => db.init(),
  loadConfig: () => config.load(),
  createTuiApp: async (renderer, mode, config) => {
    /* ... */
  },
  // ... 其他依赖
});

// 2. 注册信号处理
installSignalHandlers();

// 3. 解析参数并执行
const parsed = parseCliArgs(process.argv.slice(2));
await executeMode(parsed);
```

### 错误处理

```typescript
import { createCliError, writeCliError } from "@cli";

// 创建分类错误
const error = createCliError({
  kind: "invalid-parameter",
  message: "请指定配置文件路径",
  context: { usage: "crab config import <path>" },
});

// 输出到 stderr
writeCliError(error, { includeCause: true });
```

### 错误分类

| CliErrorKind         | AppError 类型        | 说明                    |
| -------------------- | -------------------- | ----------------------- |
| `invalid-parameter`  | `INVALID_PARAMETER`  | 参数格式错误或缺失      |
| `invalid-path`       | `INVALID_PATH`       | 文件/目录路径无效       |
| `resource-conflict`  | `RESOURCE_EXISTS`    | 资源冲突（如实例锁）    |
| `resource-not-found` | `RESOURCE_NOT_FOUND` | 资源不存在（如任务 ID） |
| `unavailable`        | `TOOL_UNAVAILABLE`   | 服务不可用              |
| `write-failed`       | `FS_WRITE_ERROR`     | 文件写入失败            |
| `internal`           | `INTERNAL_ERROR`     | 内部错误                |

## 支持的运行模式

| 模式            | CLI 命令                                | 说明                                                |
| --------------- | --------------------------------------- | --------------------------------------------------- |
| `tui`           | `crab`                                  | 启动 TUI 交互界面（默认）                           |
| `setup`         | `crab setup`                            | 交互式配置向导                                      |
| `help`          | `crab -h`                               | 显示帮助信息                                        |
| `version`       | `crab --version`                        | 显示版本号                                          |
| `headless`      | `crab --ask "..."`                      | 无头模式直接提问（支持 `--continue <id>` 恢复会话） |
| `config-test`   | `crab config test [id]`                 | 测试 Provider 连接                                  |
| `config-export` | `crab config export`                    | 导出配置为 JSON                                     |
| `config-import` | `crab config import <path>`             | 从 JSON 导入配置                                    |
| `sse`           | `crab --sse`                            | 启动 SSE 服务器                                     |
| `sse-daemon`    | `crab --sse-daemon`                     | SSE 后台守护进程                                    |
| `sse-stop`      | `crab --sse-stop`                       | 停止 SSE 服务器                                     |
| `sse-status`    | `crab --sse-status`                     | 查看 SSE 服务器状态                                 |
| `acp`           | `crab --acp`                            | 启动 ACP 协议服务                                   |
| `task`          | `crab --task "..."`                     | 执行后台任务                                        |
| `task-list`     | `crab --task-list`                      | 列出后台任务                                        |
| `task-status`   | `crab --task-status <id>`               | 查看任务详情                                        |
| `check-update`  | `crab --update`                         | 检查更新                                            |
| `task-worker`   | `crab --task-execute <id> --task "..."` | 任务执行器（内部使用）                              |

> **注**: `help` 和 `version` 模式在 `executeMode` 中硬编码拦截（orchestrator.ts:220-229），不经过命令注册表路由，因此未注册到 `commands.ts`。实际注册命令数量为 **16 个**。

## 在系统架构中的作用

```
用户输入 CLI 命令
       │
       ▼
┌──────────────────────────────────────────┐
│              CLI 模块 (src/cli/)          │
│  ┌────────────┐  ┌──────────────────┐   │
│  │ parseArgs  │→│ executeMode       │   │
│  └────────────┘  │  ├── setup        │   │
│  ┌────────────┐  │  ├── headless     │→ server/headless
│  │ lifecycle  │  │  ├── tui          │→ UI renderer
│  │ (signals)  │  │  ├── sse/*        │→ server/sse*
│  └────────────┘  │  ├── acp          │→ server/acpStdio
│  ┌────────────┐  │  └── task/*       │→ server/taskRunner
│  │ errors     │  └──────────────────┘   │
│  └────────────┘                          │
└──────────────────────────────────────────┘
```

## 与外部系统的交互

| 外部模块                | 交互方式        | 说明                                 |
| ----------------------- | --------------- | ------------------------------------ |
| `@core/logger`          | 依赖            | 日志记录                             |
| `@core/version`         | 依赖            | 版本号常量                           |
| `@core/errors/appError` | 依赖            | 底层错误类型                         |
| `@bus`                  | 依赖 + 发布事件 | TUI 启动时发布 `AppEvent.AppStarted` |
| `@server/sseModes`      | 依赖            | SSE 模式执行逻辑                     |
| `@server/headless`      | 动态导入        | 无头模式运行器                       |
| `@server/acpStdio`      | 动态导入        | ACP 协议服务                         |
| `@server/taskRunner`    | 动态导入        | 任务管理（注册/查询/格式化）         |
| `@command/config/*`     | 动态导入        | 配置命令（setup/test/export/import） |
| `@monitor/telemetry`    | 动态导入        | OpenTelemetry 遥测初始化             |
| `@core/devMode`         | 动态导入        | 开发者模式初始化                     |
| `@core/tmpCleanup`      | 动态导入        | 临时文件清理                         |
| `@tool/truncate`        | 动态导入        | 截断文件清理                         |

## 设计决策

| 决策                     | 原因                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 动态导入业务模块         | 各模式依赖不同模块（如 SSE 需要 server，TUI 需要 renderer），按需加载减少启动时间                                                                         |
| 依赖注入接口             | `CliOrchestratorDeps` 解耦编排器与具体实现，便于测试和替换                                                                                                |
| 统一错误分类             | `CliErrorKind` 将 CLI 层错误归为 7 类，映射到不同 `AppError` 类型                                                                                         |
| 实例锁机制               | 防止同一项目目录下多个 TUI 实例并发运行导致数据损坏                                                                                                       |
| 命令注册表               | `commandRegistry.ts` 提供 Map 驱动的注册/查询 API，`commands.ts` 在模块加载时注册 16 个命令，`executeMode` 通过 `getCommand` 查表执行，实现命令与路由解耦 |
| 参数互斥约束             | `validateCliArgs` 在执行前检查 `--sse`/`--acp`、`--task`/`--ask` 等互斥参数对，提前报错                                                                   |
| 帮助文本动态生成         | `help.ts` 的用法部分从 `getAllCommands()` 动态生成，新增命令自动出现在帮助中                                                                              |
| `require()` 用于致命日志 | ~~已移除~~ — `lifecycle.ts` 的 `writeFatalLog` 已改用 ESM 静态导入                                                                                        |

## 边界与限制

1. **仅做编排不做实现** — 具体命令实现在 `@command/*` 和 `@server/*` 中
2. **进程退出不可恢复** — `shutdown()` 调用 `process.exit()`，不可逆
3. **单实例锁基于文件** — 依赖文件系统锁，分布式场景不适用
4. **参数解析基于 `parseArgs`（strict 模式）** — 未知参数会直接报错；互斥约束通过 `validateCliArgs` 检查

## 故障排查

| 现象         | 可能原因                         | 排查步骤                           |
| ------------ | -------------------------------- | ---------------------------------- |
| 命令无响应   | 未调用 `setOrchestratorDeps`     | 确认入口文件初始化顺序             |
| SSE 端口错误 | `--sse-port` 格式无效            | 检查 `parseSsePort` 抛出的错误消息 |
| 实例锁冲突   | 另一个 crab-cli 正在运行         | 检查 `.crab/` 下的锁文件           |
| 信号未处理   | `installSignalHandlers()` 未调用 | 确认在入口文件中已注册             |

## 相关测试

| 测试文件                                     | 覆盖范围                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `test/unit/cli/errors.test.ts`               | 错误创建（7 种 kind）、格式化（含/不含 cause）、输出、exitWithError、getCliErrorMessage          |
| `test/unit/cli/help.test.ts`                 | 帮助文本内容、版本号嵌入、printHelp 输出、动态命令覆盖                                           |
| `test/unit/cli/orchestrator.test.ts`         | parseCliArgs 模式识别（18 种）、yolo/plan/continue 等标志位、严格模式未知参数、生命周期 shutdown |
| `test/unit/cli/executeMode.test.ts`          | executeMode 命令路由（所有 16 种注册模式 + help/version 硬编码拦截）                             |
| `test/unit/cli/lifecycle.test.ts`            | 信号处理防重入、deps get/set、shutdown 幂等性、清理异常兜底                                      |
| `test/unit/cli/sseModes.test.ts`             | parseSsePort 全量（边界值/类型/错误消息）                                                        |
| `test/unit/cli/validateCliArgs.test.ts`      | 参数互斥约束（6 组）+ --timeout/--max-tool-rounds 数值范围校验                                   |
| `test/unit/cli/commandRegistry.test.ts`      | 注册表 register/get/重复注册/clear/空表                                                          |
| `test/unit/cli/tuiRunner.test.ts`            | TUI 启动流程封装（实例锁获取/冲突、4 种环境变量、cleanup 回调）                                  |
| `test/unit/cli/writeFatalLog.test.ts`        | shutdown 带错误时的 writeFatalLog 触发（Error/字符串）、清理回调、退出码                         |
| `test/unit/cli/safeImport.test.ts`           | safeImport 正常加载、模块不存在时 exitWithError、错误消息含模块名、非 Error 类型处理             |
| `test/unit/cli/configTestValidate.test.ts`   | configTestCommand.validate 空字符串/空白/undefined/有效 providerId 四种场景                      |
| `test/unit/cli/crashHandler.test.ts`         | tuiRunner 崩溃处理器注册/移除（uncaughtException/unhandledRejection）                            |
| `test/unit/cli/parseCliArgsBoundary.test.ts` | parseCliArgs --sse-port 边界值（有效端口/无效值/缺失值）                                         |

#### 集成测试

| 测试文件                           | 覆盖范围                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/integration/cliArgs.test.ts` | runCli 端到端流程：TUI 环境变量映射（c-yolo/plan/dev）、--work-dir 目录切换、实例锁冲突拒绝、sse-daemon 后台启动、task-execute worker 兼容、headless --no-mcp、task-status 详情/缺失、sse-port 无效、--help 输出、--update 新版本/最新版本 |

# Tool Module — 工具定义、注册、执行与结果处理

## 整体定位

Tool 模块是系统的基础工具框架，统一管理工具的**定义**、**注册**、**执行**和**结果处理**。它提供 `@/tool`（值）和 `@/tool/type`（类型）两个稳定入口，串联所有内置工具和 MCP 工具的完整生命周期。

> **导入规范**: 深路径使用 `@/tool/xxx` 而非 `@tool/xxx`。详见 [导入边界规范](../../docs/architecture/import-boundary.md)。

## 核心功能

1. **工具定义** — `ToolDefinition` 接口 + `defineTool` 工厂，支持 Zod 参数校验和权限标识
2. **工具注册** — `toolRegistry` 统一管理内置与 MCP 工具，支持动态注册/注销
3. **工具执行** — `ToolExecutor` 权限检查 → 参数验证 → 策略评估 → 超时控制 → 执行
4. **结果处理** — `truncateToolOutput`、`ToolResultCache`、`validateAndTruncate`

## 目录结构

```
src/tool/
├── index.ts              # 统一入口（值导出）
├── README.md             # 本文档
│
├── types/                # 核心类型定义与 defineTool
│   └── index.ts          # ToolDefinition, ToolContext, defineTool, ToolTimeoutError
│
├── registry/             # 工具注册表
│   ├── index.ts          # 统一导出
│   ├── toolRegistry.ts   # 注册表核心（registerTool, getRegisteredTools 等）
│   ├── toolNameMatcher.ts # 工具名模糊匹配
│   ├── builtinToolPrefixes.ts # 内置工具名前缀
│   ├── toolRefUtils.ts   # 工具引用工具函数
│   └── externalToolResolver.ts # 外部工具名解析
│
├── executor/             # 工具执行流水线
│   ├── index.ts          # 统一导出
│   ├── toolExecutor.ts   # 主执行器（权限 + 执行 + 输出）
│   ├── toolExecutionCore.ts # 核心执行（参数验证 + 超时 + 截断）
│   ├── toolExecutionPolicy.ts # 策略评估（MCP 禁用检查）
│   ├── toolExecutorSafety.ts # 安全检测（敏感命令、权限匹配）
│   ├── toolTimeout.ts    # 超时控制
│   └── runtimeExec.ts    # 运行时执行器
│
├── result/               # 输出处理与缓存
│   ├── index.ts          # 统一导出
│   ├── truncate.ts       # 工具输出截断（head/tail 方向 + 写临时文件）
│   └── toolCache.ts      # 执行结果缓存（TTL + LRU）
│
├── shared/               # 工具间共享工具函数（内部）
│   ├── index.ts
│   ├── fs.ts             # 文件系统辅助
│   ├── html.ts           # HTML 处理辅助
│   ├── number.ts         # 数值辅助
│   ├── regex.ts          # 正则转义（ReDoS 防护）
│   └── sshUrl.ts         # SSH URL 解析（消除 codebaseSearch→bash 耦合）
│
├── deepResearch/         # 深度研究工具
├── deepwiki/             # DeepWiki 工具
├── context7/             # Context7 工具
├── notebookJupyter/      # Jupyter Notebook 工具
├── bash/                 # Shell 执行工具（含 SSH 支持）
├── filesystem/           # 文件系统工具
│   └── index.ts          # 统一导出（read/write/edit/batch/multiEdit/fileLock）
├── codebaseSearch/       # 代码库搜索工具
│   ├── aceRuntime/       # ACE 运行时
│   ├── enhanced/         # 增强搜索
│   └── indexer/          # 代码索引器
├── websearch/            # 网络搜索工具（多引擎回退）
│   ├── browser/          # 浏览器控制
│   ├── engines/          # 搜索引擎实现（tavily, brave, google, duckduckgoHttp + 注册表）
│   ├── apiTypes.ts       # API 响应类型
│   ├── cache.ts          # 搜索结果缓存（LRU + TTL）
│   ├── config.ts         # Tavily 配置加载
│   ├── utils.ts          # 常量 + formatResults + withRetry
│   ├── index.ts          # webSearchTool 定义 + 回退链编排
│   └── webfetch.ts       # Web Fetch 工具
├── toolSearch/           # 工具搜索工具
├── notebook/             # 会话笔记本工具
├── git/                  # Git 操作工具
├── format/               # 代码格式化工具
├── lsp/                  # LSP 工具
├── ideDiagnostics/       # IDE 诊断工具
├── goal/                 # 目标管理工具
├── agentComms/           # Agent 通信工具
├── subagent/             # 子 Agent 工具
├── team/                 # 团队协作工具
├── scheduler/            # 调度器工具
├── planMode/             # 计划模式工具
├── rollback/             # 回滚工具
├── askUser/              # 用户交互工具
├── skills/               # 技能工具
└── todo/                 # 待办事项工具
    ├── index.ts          # 主入口（CRUD handler + scan）
    ├── todoTypes.ts      # 类型定义（TodoItem, TodoPhase, TodoStore）
    ├── todoLock.ts       # 文件锁机制（withTodoStoreLock）
    └── todoUltra.ts      # Ultra 阶段工具（advancePhase, completePhase 等）
```

## 子模块说明

| 子模块             | 职责                                               | 主要导出                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`           | 核心类型定义与工厂                                 | `defineTool`, `ToolDefinition`, `ToolContext`, `ToolTimeoutError`                                                                                                                                                                                                                                                                         |
| `registry/`        | 工具注册表与命名解析                               | `registerTool`, `getRegisteredTools`, `getBuiltinToolGroups`                                                                                                                                                                                                                                                                              |
| `executor/`        | 工具执行流水线                                     | `ToolExecutor`, `executeToolCore`, `evaluateToolExecutionPolicy`                                                                                                                                                                                                                                                                          |
| `result/`          | 输出处理与缓存                                     | `truncateToolOutput`, `needsTruncation`, `getTruncateDefaults`, `cleanupTruncationFiles`, `streamReadTruncatedFile`, `countTruncatedFileLines`, `ToolResultCache`, `getToolResultCache`, `resetToolResultCache`, `validateAndTruncate`, `estimateTokens`, `getToolResultTokenLimit`, `validateTokenLimit`, `wrapToolResultWithTokenLimit` |
| `shared/`          | 工具间共享工具函数（内部模块，不对外导出）         | `stripHtmlTags`, `countMatches`, `escapeRegex`, 文件系统辅助                                                                                                                                                                                                                                                                              |
| `usageMemory.ts`   | 工具使用记忆与推荐（供 toolSearch 和外部模块使用） | `recordUsageMemory`, `getUsageBoost`, `getUsageCandidates`                                                                                                                                                                                                                                                                                |
| `deepResearch/`    | 深度研究（多轮搜索 + 综合）                        | `deepResearchTool`                                                                                                                                                                                                                                                                                                                        |
| `deepwiki/`        | DeepWiki 文档查询                                  | `deepwikiReadStructureTool`, `deepwikiReadContentsTool`, `deepwikiAskQuestionTool`, `deepwikiFetchTool`, `deepwikiSearchTool`; 函数: `readWikiStructure`, `readWikiContents`, `askQuestion`                                                                                                                                               |
| `context7/`        | Context7 文档检索                                  | `context7ResolveLibraryIdTool`, `context7QueryDocsTool`; 函数: `resolveLibraryId`, `queryLibraryDocs`                                                                                                                                                                                                                                     |
| `notebookJupyter/` | Jupyter Notebook 读写                              | Jupyter 编辑与读取工具                                                                                                                                                                                                                                                                                                                    |
| `bash/`            | Shell 执行（含 SSH）                               | `bashTool`                                                                                                                                                                                                                                                                                                                                |
| `filesystem/`      | 文件系统操作                                       | `fsReadTool`, `fsWriteTool`, `fsBatchTool`, `filesystemMultiEditTool`                                                                                                                                                                                                                                                                     |
| `codebaseSearch/`  | 代码库搜索                                         | `codebaseSearchTool`                                                                                                                                                                                                                                                                                                                      |
| `websearch/`       | 网络搜索（多引擎回退）                             | `webSearchTool`                                                                                                                                                                                                                                                                                                                           |
| `toolSearch/`      | 工具搜索与发现                                     | `toolSearchTool`                                                                                                                                                                                                                                                                                                                          |
| `notebook/`        | 会话笔记本管理                                     | `notebookTool`                                                                                                                                                                                                                                                                                                                            |
| `git/`             | Git 操作                                           | `gitTool`                                                                                                                                                                                                                                                                                                                                 |
| `format/`          | 代码格式化                                         | `formatTool`                                                                                                                                                                                                                                                                                                                              |
| `lsp/`             | LSP 语言服务                                       | `lspTool`                                                                                                                                                                                                                                                                                                                                 |
| `ideDiagnostics/`  | IDE 诊断信息                                       | `ideDiagnosticsTool`                                                                                                                                                                                                                                                                                                                      |
| `goal/`            | 目标管理                                           | `goalTool`                                                                                                                                                                                                                                                                                                                                |
| `agentComms/`      | Agent 间通信                                       | `agentCommsTool`                                                                                                                                                                                                                                                                                                                          |
| `subagent/`        | 子 Agent 管理                                      | `subagentTool`                                                                                                                                                                                                                                                                                                                            |
| `team/`            | 团队协作（16 个独立工具 + 向后兼容单体 teamTool）  | `teamTools`, `teamTool`                                                                                                                                                                                                                                                                                                                   |
| `scheduler/`       | 任务调度                                           | `schedulerTool`                                                                                                                                                                                                                                                                                                                           |
| `planMode/`        | 计划模式                                           | `planModeTool`                                                                                                                                                                                                                                                                                                                            |
| `rollback/`        | 文件变更追踪与回滚（基础设施，非 Tool）            | `recordFileMutation`, `previewRollbackEntry`, `applyRollbackEntry`, `listRollbackEntries`, `listRollbackEntriesForSessionSince`, `cleanupStaleRollbackEntries`                                                                                                                                                                            |
| `askUser/`         | 用户交互                                           | `askUserTool`                                                                                                                                                                                                                                                                                                                             |
| `skills/`          | 技能管理                                           | `skillsTool`                                                                                                                                                                                                                                                                                                                              |
| `todo/`            | 待办事项管理                                       | `todoUltraTool`                                                                                                                                                                                                                                                                                                                           |

## 稳定边界

- 值导出：优先从 `@/tool` 导入。
- 类型导出：优先从 `@/tool/type` 导入。
- 深路径：实现内部可以使用 `@/tool/...`。

## 完整 API 导出

### 类型导出 (`@tool/types`)

```typescript
import type {
  // 核心类型
  ToolDefinition, // 工具定义接口（schema、execute、permission）
  ToolContext, // 工具执行上下文（会话 ID、信号、配置）
  ToolPermissionInfo, // 权限信息
  ToolSearchInfo, // 搜索信息
} from "@/tool/types";

// 其他类型需从深路径导入:
//   registry:  BuiltinToolGroup, ExternalToolResolution        → from "@/tool/registry"
//   executor:  PermissionAction, PermissionCheckResult,          → from "@/tool/executor"
//              ToolExecutionResult, ToolExecutorOptions,
//              ToolExecutionCoreResult, ToolExecutionCoreOptions,
//              ToolExecutionPolicyDecision, ToolExecutionPolicyReason,
//              CommandInjectionCheckResult,
//              RuntimeToolExecutionResult, RuntimeToolExecutionOptions
//   result:    TruncateResult, TruncateOptions, TruncateDirection, → from "@/tool/result"
//              StreamReadOptions, StreamReadResult,
//              ToolCacheEntry, ToolCacheOptions,
//              TokenLimitResult
```

### 值导出 (`@tool`)

```typescript
import {
  // types
  defineTool, // 工具定义工厂
  ToolTimeoutError, // 超时错误类

  // registry
  registerTool, // 注册单个工具
  registerTools, // 批量注册
  unregisterTool, // 注销工具
  getRegisteredTools, // 获取所有注册工具
  getTool, // 按名称获取单个工具
  getToolsForAiSdk, // 转换为 AI SDK 格式
  getToolsForAiSdkByNames, // 按名转换
  clearToolsCache, // 清除缓存
  setupGoalToolVisibility, // 设置目标工具可见性
  isBuiltinTool, // 判断是否为内置工具
  getBuiltinGroupName, // 获取工具分组名
  isMcpToolNameDisabled, // 判断 MCP 工具是否禁用
  toolNameMatches, // 工具名模糊匹配
  BUILTIN_TOOL_PREFIXES, // 内置工具前缀常量
  resolveExternalToolName, // 解析外部工具名
  resolveExplicitExternalToolReference, // 解析显式外部引用

  // 内置工具分组
  getBuiltinToolGroups, // 获取内置工具分组（由 setupGoalToolVisibility 使用）

  // executor
  ToolExecutor, // 工具执行器类
  searchTools, // 模糊搜索工具
  isSensitiveCall, // 敏感命令检测
  checkCommandInjection, // 命令注入检测
  executeToolCore, // 核心执行函数
  evaluateToolExecutionPolicy, // 策略评估
  runWithTimeout, // 超时执行
  createBaseToolContext, // 创建基础上下文
  executeRegisteredTool, // 执行已注册工具

  // result
  truncateToolOutput, // 截断工具输出
  needsTruncation, // 判断是否需要截断
  getTruncateDefaults, // 获取截断默认值
  cleanupTruncationFiles, // 清理截断临时文件
  streamReadTruncatedFile, // 流式读取截断文件
  countTruncatedFileLines, // 统计截断文件行数
  ToolResultCache, // 结果缓存类
  getToolResultCache, // 获取结果缓存实例
  resetToolResultCache, // 重置结果缓存
  validateAndTruncate, // 验证并截断
  estimateTokens, // 估算 Token 数
  getToolResultTokenLimit, // 获取工具结果 Token 限制
  validateTokenLimit, // 验证 Token 限制
  wrapToolResultWithTokenLimit, // 按 Token 限制包装结果

  // DeepWiki
  deepwikiReadStructureTool, // 读取 Wiki 结构
  deepwikiReadContentsTool, // 读取 Wiki 内容
  deepwikiAskQuestionTool, // 向 Wiki 提问
  deepwikiFetchTool, // 获取 Wiki 页面
  deepwikiSearchTool, // 搜索 Wiki
  readWikiStructure, // 读取 Wiki 结构（函数）
  readWikiContents, // 读取 Wiki 内容（函数）
  askQuestion, // 提问（函数）

  // Context7
  context7ResolveLibraryIdTool, // 解析库 ID 工具
  context7QueryDocsTool, // 查询文档工具
  resolveLibraryId, // 解析库 ID（函数）
  queryLibraryDocs, // 查询文档（函数）

  // 内置工具
  webSearchTool, // 网络搜索
  webFetchTool, // Web Fetch
  todoUltraTool, // 待办事项
  askUserQuestionTool, // 用户交互
  subagentTool, // 子 Agent
  teamTool, // 团队协作（向后兼容单体）
  teamTools, // 团队协作工具集（16 个独立工具）
  schedulerTool, // 任务调度
  notebookTool, // 会话笔记本
  skillsTool, // 技能管理
  ideDiagnosticsTool, // IDE 诊断
  codebaseSearchTool, // 代码库搜索
  aceEnhancedSearchTool, // ACE 增强搜索
  filesystemMultiEditTool, // 文件系统多编辑
  notebookReadTool, // Jupyter Notebook 读取
  notebookEditTool, // Jupyter Notebook 编辑
  lspTool, // LSP 语言服务
  planModeTool, // 计划模式
  toolSearchTool, // 工具搜索
  grepTool, // Grep 搜索
  globTool, // Glob 匹配
  applyPatchTool, // Patch 应用
  sendMessageToAgentTool, // 发送消息给 Agent
  queryAgentsStatusTool, // 查询 Agent 状态
  goalTool, // 目标管理
  deepResearchTool, // 深度研究
  gitTool, // Git 操作（默认导出）
  gitMerge, // Git 合并
  gitRebase, // Git 变基
  gitPush, // Git 推送
  gitTag, // Git 标签
  formatTool, // 代码格式化
} from "@/tool";
```

## 使用方法

### 定义工具

```typescript
import { defineTool } from "@/tool";
import { z } from "zod";

const myTool = defineTool({
  name: "my_tool",
  description: "我的工具",
  permission: "custom.my_tool",
  parameters: z.object({ input: z.string() }),
  execute: async (args, context) => {
    return `Hello, ${args.input}`;
  },
});
```

### 注册与执行

```typescript
import { registerTool, ToolExecutor } from "@/tool";

registerTool(myTool);

const executor = new ToolExecutor({
  getConfig: () => config,
});
const result = await executor.execute("my_tool", { input: "world" });
// → { success: true, output: "Hello, world", toolName: "my_tool", durationMs: ... }
```

### 结果截断

```typescript
import { truncateToolOutput } from "@/tool";

const truncated = await truncateToolOutput(longText, { maxTokens: 2000, truncateDirection: "tail" });
```

## 边界与限制

1. **只执行已注册的工具** — `toolRegistry` 是唯一执行入口，未注册的工具无法执行
2. **参数必须通过 Zod 校验** — 所有工具参数必须定义 `zod` schema
3. **权限基于配置** — 权限规则通过 AppConfig 注入，支持通配符 `*`
4. **超时由 timeoutMs 控制** — 工具可声明 `timeoutMs`，未声明时由 `ToolExecutor.defaultTimeout` 或全局默认值兜底
5. **输出截断由 executor 统一处理** — 超长输出由 `truncateByTokenLimit` 按 Token 限制截断，截断时自动写入临时文件供后续查阅。工具内部不再调用 `truncateToolOutput`（read 工具除外，因其返回结构化元数据）

## 安全考量

Tool 模块涉及文件系统、Shell 执行、网络请求等高风险操作，采用多层防护：

### 路径遍历防护 (CWE-22)

| 层级   | 机制                      | 实现                                                                               |
| ------ | ------------------------- | ---------------------------------------------------------------------------------- |
| 第一层 | `validatePathWithinCwd()` | `resolve()` 后的路径检查 + `realpathSync()` 解析符号链接后的真实路径检查           |
| 第二层 | 敏感路径黑名单            | `toolExecutorSafety.SENSITIVE_PATTERNS` 硬拒绝 `~/.ssh/`、`/etc/shadow` 等系统路径 |
| 第三层 | 符号链接绕过防护          | `resolveRealPath()` 逐级解析父目录，防止 `symlink → /etc/passwd` 绕过              |

### 命令注入防护

| 层级   | 机制                      | 实现                                              |
| ------ | ------------------------- | ------------------------------------------------- |
| 第一层 | `checkCommandInjection()` | 正则检测 `&&`、`;`、`\|`、`$()`、反引号等注入模式 |
| 第二层 | `sensitiveCommandMatcher` | `rm -rf /`、`chmod 777`、`mkfs` 等高危命令软确认  |
| 第三层 | 权限系统                  | `permission: "bash"` 需用户显式授权               |

### 网络安全 (SSRF/ReDoS)

| 防护项   | 实现                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| SSRF     | `websearch/ssrf.test.ts` 验证的 URL 黑名单（`169.254.169.254`、`localhost` 等） |
| ReDoS    | `escapeRegex()` 将用户输入转义为字面量，防止正则 DoS                            |
| 输出净化 | `escapeHtml()` / `stripHtmlTags()` 防止 XSS                                     |

### 双重安全层

```
用户请求 → [executor: permission check] → [executor: injection check]
         → [safety: sensitive pattern deny] → [safety: soft-confirm]
         → 执行
```

`toolExecutorSafety.SENSITIVE_PATTERNS` 为**硬拒绝**（直接抛错），`sensitiveCommandMatcher` 为**软确认**（需用户确认）。

## 测试

### 目录结构

```
test/unit/tool/
├── shared/           # 纯函数测试（escapeHtml, stripHtmlTags, escapeRegex 等）
├── types/            # defineTool 工厂 + ToolTimeoutError
├── registry/         # normalizeToolRef + toolNameMatches
├── result/           # truncate + toolCache
├── filesystem/       # read/write/batch/fileLock/pathValidation
├── rollback/         # recordFileMutation/preview/apply + cleanup
├── toolCache.test.ts # ToolResultCache 单例 + sessionId 隔离
├── ...               # 各子模块独立测试
```

### 运行测试

```bash
# 单个模块（推荐，避免 mock.module 并行泄漏）
PATH="$HOME/.bun/bin:$PATH" bun test test/unit/tool/filesystem/ --no-coverage

# 完整 tool 模块
PATH="$HOME/.bun/bin:$PATH" bun test test/unit/tool/ --no-coverage

# CI 验证
npx tsc --noEmit 2>&1 | grep -E "error TS" | grep "src/tool/" | head -5
```

### Mock 策略

| 场景                  | 策略                                                    |
| --------------------- | ------------------------------------------------------- |
| 外部依赖 (logger)     | `mock.module("@/core/logging/logger", ...)`             |
| 跨模块依赖 (rollback) | `mock.module("@/tool/rollback", ...)`                   |
| 纯函数                | 无需 mock，直接测试                                     |
| 文件 I/O              | 使用 `createGlobalTmpTestDir()` 创建真实临时文件        |
| 会话/配置             | `mock.module("@/session")` 或 `mock.module("@/config")` |

> **已知限制**: Bun 1.3.14 的 `mock.module()` 在并行测试中存在跨文件模块泄漏，导致 15 个测试在并行运行时失败。单文件运行均通过。此为 Bun 运行时问题，非代码缺陷。

## 设计决策

| 决策                                          | 原因                                                       |
| --------------------------------------------- | ---------------------------------------------------------- |
| `@tool`（值）与 `@tool/types`（类型）分离     | 符合 `verbatimModuleSyntax` 要求，类型安全且避免运行时开销 |
| 按职责划分子目录                              | types/registry/executor/result 四个维度清晰分离关注点      |
| toolRegistry 与 ToolExecutor 解耦             | 注册表可独立用于工具发现，执行器专注执行流程               |
| 策略评估（Policy）从执行器中拆分              | MCP 禁用规则与权限检查逻辑各自独立，便于单元测试           |
| 会话级外部工具可见性放在 conversation context | `src/tool` 只负责能力注册与过滤，不直接持有会话状态        |

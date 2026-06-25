# Agent Module — Agent 运行时引擎

## 整体定位

Agent 模块是系统的 Agent 运行时引擎，负责管理所有 Agent 实例的生命周期、会话状态、子代理调度和专用 Agent 执行。它是连接 Role 定义（`@roles/`）与 Tool 执行（`@tool/`）的核心桥梁。

## 核心功能

1. **Agent 生命周期管理** — 注册、激活、状态跟踪、清理
2. **会话管理** — 消息序列化/反序列化、版本迁移、持久化
3. **子代理系统** — 任务派发、并发控制、依赖解析、结果追踪
4. **运行时保护** — 熔断器、看门狗、心跳监控、注意力机制
5. **专用 Agent** — 代码审查、Bash 摘要、代码库索引、对话摘要
6. **Tool-facing 契约** — 向 Tool 层暴露子代理操作的最小接口面

## 目录结构

```
src/agent/
├── index.ts              # 统一出入口，所有外部引用通过此文件
├── README.md             # 本文档
│
├── core/                 # 核心管理
│   ├── manager.ts        # Agent 注册、激活、列表、状态管理
│   ├── state.ts          # Agent 状态持久化与恢复
│   ├── errors.ts         # 错误处理与日志
│   ├── agentEvents.ts    # Agent 事件总线
│   └── definition.ts     # 内置 Agent 定义（名称、提示词、模式）
│
├── session/              # 会话管理
│   ├── session.ts        # AgentSession 类（核心会话逻辑）
│   ├── sessionDeps.ts    # 会话依赖注入
│   ├── sessionLifecycle.ts # 会话生命周期管理
│   ├── sessionSubagent.ts  # 会话子代理支持
│   ├── sessionToolContext.ts # 会话工具上下文
│   ├── lifecycle.ts      # 生命周期钩子管理
│   ├── model.ts          # 消息模型定义
│   ├── serializer.ts     # 消息序列化/反序列化
│   ├── toolContext.ts    # 工具上下文
│   └── types.ts          # 会话类型定义
│
├── subagent/             # 子代理系统
│   ├── executor.ts       # 子代理执行器（并发控制、任务调度）
│   ├── executorConcurrency.ts # 动态并发计算
│   ├── executorDependency.ts  # 依赖图解析
│   ├── executorLifecycle.ts   # 生命周期管理
│   ├── executorResult.ts      # 结果收集
│   ├── executorTaskRunner.ts  # 任务执行器
│   ├── tracker.ts        # 子代理追踪器（状态、消息）
│   ├── trackerDrain.ts   # 结果排空与继续提示
│   ├── resolver.ts       # 子代理解析器（名称→实例）
│   ├── streamProcessor.ts # 流处理（SSE/流式响应合并）
│   ├── builtinTools.ts   # 内置工具（sendMessage, queryStatus, spawn）
│   ├── toolInterceptor.ts # 工具拦截（DI 注入点）
│   ├── toolApproval.ts   # 工具审批（用户确认）
│   ├── permissions.ts    # 权限检查（工具白名单）
│   └── types.ts          # 子代理类型定义
│
├── runtime/              # 运行时支持
│   ├── circuitBreaker.ts # 熔断器（死循环检测）
│   ├── watchdog.ts       # 看门狗（超时处理）
│   ├── heartbeat.ts      # 心跳监控
│   ├── compression.ts    # 压缩状态追踪
│   ├── augmentations.ts  # 运行时增强（系统提示注入）
│   ├── attention.ts      # 注意力机制（用户提示点）
│   ├── modeState.ts      # 模式状态（YOLO/安全模式）
│   └── yolo.ts           # YOLO 模式（自动审批规则）
│
├── specialized/          # 专用 Agent
│   ├── base.ts           # 专用 Agent 基类
│   ├── registry.ts       # 专用 Agent 注册表
│   ├── vision.ts         # 视觉 Agent（图片分析）
│   ├── review.ts         # 代码审查逻辑
│   ├── reviewAgent.ts    # 审查 Agent 注册
│   ├── summary.ts        # 摘要逻辑
│   ├── summaryAgent.ts   # 摘要 Agent 注册
│   ├── bashSummary.ts    # Bash 输出摘要
│   ├── codebaseReview.ts # 代码库搜索结果审查
│   ├── codebaseIndex.ts  # 代码库索引逻辑
│   ├── codebaseIndexAgent.ts # 代码库索引 Agent
│   └── codebaseIndexDefinitions.ts # 索引定义
│
├── snapshot/             # 快照系统
│   ├── schema.ts         # 快照数据结构
│   └── validator.ts      # 快照验证器
│
└── contracts/            # Tool-facing 契约层
    ├── toolFacing.ts     # 暴露给 Tool 层的子代理操作
    └── toolFacingBootstrap.ts # 启动时 DI 注入
```

## 子模块说明

| 子模块                       | 职责                       | 核心导出                                                             |
| ---------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `core/manager`               | Agent 注册、查询、状态管理 | `registerAgent`, `getActiveAgent`, `listAgents`                      |
| `core/state`                 | Agent 状态持久化           | `saveAgentState`, `loadAgentState`, `clearAgentState`                |
| `core/errors`                | 错误处理                   | `getAgentErrorMessage`, `createAgentRuntimeError`                    |
| `core/definition`            | 内置 Agent 定义            | `getBuiltinAgentDefinition`, `BUILTIN_AGENT_NAMES`                   |
| `session/session`            | Agent 会话核心             | `AgentSession`                                                       |
| `session/lifecycle`          | 生命周期钩子               | `lifecycleHooks`, `onBeforeStart`, `onAfterStep`                     |
| `session/serializer`         | 消息序列化                 | `MessageSerializer`, `serialize`, `deserialize`                      |
| `session/toolContext`        | 工具上下文                 | `spawnToolSubagent`                                                  |
| `subagent/executor`          | 子代理执行                 | `SubAgentExecutor`, `createSubAgentExecutor`                         |
| `subagent/resolver`          | 子代理解析                 | `resolveSubAgent`, `buildSubAgentContext`                            |
| `subagent/tracker`           | 子代理追踪                 | `subAgentTracker`, `buildSpawnedToolResult`                          |
| `subagent/trackerDrain`      | 结果排空                   | `drainSpawnedChildResults`, `buildSpawnedChildrenContinuationPrompt` |
| `subagent/streamProcessor`   | 流处理                     | `SubAgentStreamProcessor`, `createStreamProcessor`                   |
| `subagent/builtinTools`      | 内置工具                   | `BUILTIN_AGENT_TOOL_NAMES`, `buildSubAgentTools`                     |
| `subagent/toolInterceptor`   | 工具拦截                   | `interceptBuiltinTools`, `interceptSendMessage`                      |
| `subagent/toolApproval`      | 工具审批                   | `checkAndApproveTools`, `executeApprovedToolsWithHooks`              |
| `subagent/permissions`       | 权限检查                   | `filterToolsForAgent`, `isToolAllowedForAgent`                       |
| `runtime/circuitBreaker`     | 熔断器                     | `CircuitBreaker`, `createCircuitBreaker`                             |
| `runtime/watchdog`           | 看门狗                     | `Watchdog`, `createWatchdog`, `createTimeoutHandler`                 |
| `runtime/heartbeat`          | 心跳监控                   | `HeartbeatMonitor`, `createHeartbeatMonitor`                         |
| `runtime/attention`          | 注意力机制                 | `addAttention`, `dismissAttention`, `formatAttentionPrompt`          |
| `runtime/modeState`          | 模式状态                   | `getCurrentMode`, `switchMode`, `getEffectiveMode`                   |
| `runtime/yolo`               | YOLO 模式                  | `isYoloPassthroughActive`, `shouldAutoApproveSubAgentTool`           |
| `specialized/vision`         | 视觉 Agent                 | `VisionAgent`, `registerVisionAgent`                                 |
| `specialized/review`         | 代码审查                   | `reviewCode`, `registerReviewAgent`                                  |
| `specialized/summary`        | 摘要 Agent                 | `createSummary`, `summarizeConversation`                             |
| `specialized/bashSummary`    | Bash 摘要                  | `summarizeBashOutput`, `registerBashSummaryAgent`                    |
| `specialized/codebaseReview` | 代码库审查                 | `reviewSearchResults`, `registerCodebaseReviewAgent`                 |
| `specialized/codebaseIndex`  | 代码库索引                 | `createCodebaseIndex`, `registerCodebaseIndexAgent`                  |
| `snapshot/validator`         | 快照验证                   | `validateSnapshot`                                                   |
| `contracts/toolFacing`       | Tool-facing API            | `resolveToolSubAgent`, `injectToolSubAgentMessage`                   |

## 使用方法

### 从外部模块引用

所有外部模块应通过 `@agent` 统一入口引用，**禁止**直接引用子目录路径：

```typescript
import {
  // 核心管理
  registerAgent,
  getActiveAgent,
  listAgents,
  getAgentErrorMessage,

  // 会话
  AgentSession,
  MessageSerializer,
  createLifecycleHooks,

  // 子代理
  SubAgentExecutor,
  subAgentTracker,
  resolveSubAgent,

  // 运行时
  CircuitBreaker,
  Watchdog,
  formatAttentionPrompt,

  // 专用 Agent
  reviewCode,
  summarizeBashOutput,
  createCodebaseIndex,

  // Tool-facing 契约
  resolveToolSubAgent,
  injectToolSubAgentMessage,
  isToolSubAgentRunning,

  // 类型
  type AgentInfo,
  type AgentSessionOptions,
  type SubAgentTask,
} from "@agent";
```

### 注册所有 Agent

```typescript
import { registerAllAgents } from "@agent";

// 应用启动时调用
registerAllAgents();
```

### 获取当前活跃 Agent

```typescript
import { getActiveAgent, getAgentStatus } from "@agent";

const agent = getActiveAgent();
if (agent) {
  console.log(`当前 Agent: ${agent.name}`);
}
```

### 创建会话

```typescript
import { AgentSession } from "@agent";

const session = new AgentSession({
  sessionId: "session-123",
  agentName: "code-agent",
  messages: [],
  config: appConfig,
});

await session.run();
```

### 派发子代理任务

```typescript
import { subAgentTracker, spawnToolSubagent } from "@agent";

// 派发子代理
await spawnToolSubagent(
  {
    agentType: "review-agent",
    prompt: "Review this code change",
    priority: "high",
    dependencies: [],
  },
  deps,
);

// 追踪状态
const running = subAgentTracker.listRunning();
```

## 与外部系统的交互

| 外部模块         | 交互方式         | 说明                                                   |
| ---------------- | ---------------- | ------------------------------------------------------ |
| `@roles/`        | 读取 Role 定义   | Agent 实例加载 Role 配置                               |
| `@tool/`         | Tool-facing 契约 | 通过 `@agent/contracts/toolFacing` 操作子代理          |
| `@bus/eventBus`  | 发布事件         | `AppEvent.AgentChanged`, `AppEvent.SubAgentSpawned` 等 |
| `@schema/config` | 读取配置         | Agent 配置、模型偏好、工具权限                         |
| `@core/logger`   | 日志记录         | Agent 生命周期事件日志                                 |
| `@ai-sdk`        | 调用 LLM         | Agent 推理、子代理执行                                 |
| `@compress/`     | 上下文压缩       | 会话消息压缩触发                                       |
| `@session/`      | 会话存储         | Agent 会话持久化                                       |

## Agent 生命周期

```
1. 注册阶段 (registerAgent / registerAllAgents)
   - 加载 Role 定义
   - 初始化内置 Agent
   - 注入 Tool-facing 依赖

2. 激活阶段 (setActiveAgent)
   - 创建 AgentSession
   - 加载历史状态（如有）
   - 发布 AgentChanged 事件

3. 执行阶段 (session.run)
   - LLM 推理循环
   - 工具调用与结果处理
   - 子代理派发与追踪
   - 运行时保护（熔断/看门狗/心跳）

4. 清理阶段 (unregisterAgent)
   - 保存会话状态
   - 释放子代理资源
   - 清理过期状态
```

## 配置项

通过 `AgentConfig`（定义在 `@config/agentLoader`）控制 Agent 行为：

| 配置项        | 类型                               | 说明             |
| ------------- | ---------------------------------- | ---------------- |
| `name`        | `string`                           | Agent 唯一标识   |
| `role`        | `string`                           | 关联的 Role 名称 |
| `mode`        | `"primary" \| "subagent" \| "all"` | Agent 模式       |
| `model`       | `string`                           | 首选模型 ID      |
| `description` | `string`                           | Agent 描述       |
| `options`     | `Record<string, unknown>`          | 自定义选项       |

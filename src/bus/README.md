# Bus 模块 — 进程内事件总线

## 整体定位

Bus 模块是 `crab-cli` 的进程内事件总线层，负责把会话、工具、权限、MCP、IDE、UI、协作、任务等跨模块状态变化统一抽象成事件，并通过类型安全的发布/订阅机制在本进程内部传播。

它不涉及持久化、网络传输或业务决策，核心职责是：

- **统一事件契约** — 20 个业务域事件定义，类型安全的载荷接口
- **统一事件分发** — 同步/异步发布 + 类型/前缀/通配符三种订阅模式
- **高频事件节流** — 防止 TUI 过载，自动合并同类事件
- **事件历史记录** — TTL + 容量双约束的 RingBuffer 存储
- **进程生命周期管理** — SIGINT/SIGTERM/exit 信号处理
- **跨模块解耦** — 为 100+ 外部消费者提供稳定的事件驱动接口

## 核心功能

1. **类型安全事件系统** — `defineEvent<T>()` 创建带载荷类型的事件定义，编译期保证类型正确
2. **三级订阅路由** — 精确类型匹配 → 前缀通配 → 全局通配，覆盖精确到泛化的所有场景
3. **优先级队列调度** — 基于 RingBuffer 的事件队列，queueMicrotask 异步排空，按优先级派发
4. **高频事件节流** — 可配置的时间窗口 + 合并策略，自动丢弃溢出事件
5. **事件历史管理** — 容量约束 + TTL 定时清理，支持按类型/数量过滤查询
6. **进程退出保护** — SIGINT/SIGTERM 时异步 flush + destroy，exit 时同步 clear
7. **事件命名规范校验** — 点分命名空间规则，支持例外表和历史兼容
8. **关键载荷校验** — 7 个核心事件的运行时 payload shape 校验
9. **调试与可观测性** — debug 快照、metrics 指标、历史查询

## 目录结构

```
src/bus/
├── index.ts              # 统一出入口，所有外部引用通过此文件
├── type.ts               # 纯 type-only re-export barrel（tree-shaking 优化）
├── README.md             # 本文档
├── runtimeEvents.ts      # 跨传输层运行时事件（ACP/SSE 桥接）
│
├── core/                 # 核心引擎实现（内部子模块，不直接对外暴露）
│   ├── index.ts          # 统一导出
│   ├── types.ts          # 核心类型定义（EventDefinition / EventPayload / EventHandler）
│   ├── constants.ts      # 默认配置常量（队列容量、节流窗口等）
│   ├── utils.ts          # defineEvent / filterExpiredEvents
│   ├── eventBus.ts       # EventBus 主类 + globalBus 全局单例
│   ├── dispatch.ts       # 事件分发引擎（三级路由 + 超时检测 + 异常包装）
│   ├── history.ts        # 历史记录管理（RingBuffer + TTL 清理）
│   ├── queueRuntime.ts   # 队列调度运行时（入队/排空/flush）
│   ├── subscriptions.ts  # 订阅管理（5 种订阅模式 + 上限警告）
│   ├── throttle.ts       # 高频事件节流（时间窗口 + 合并 + 溢出丢弃）
│   └── lifecycle.ts      # 进程生命周期管理（SIGINT/SIGTERM/exit）
│
├── events/               # 事件定义域（按业务域划分）
│   ├── index.ts          # 统一导出（AppEvent 聚合 + 域事件重导出 + 辅助工具）
│   ├── common.ts         # 跨域公共类型（ToolCallBase / ToolResultBase）
│   ├── namingRules.ts    # 事件命名规范校验（点分命名空间 + 例外表）
│   ├── namingValidation.ts # 全量 AppEvent 名称批量校验
│   ├── payloadValidation.ts # 关键事件载荷 shape 校验（7 个核心事件）
│   ├── lifecycleEvents.ts   # 应用生命周期（12 个事件）
│   ├── sessionEvents.ts    # 会话管理（16 个事件）
│   ├── toolEvents.ts       # 工具执行（3 个事件）
│   ├── permissionEvents.ts # 权限控制（3 个事件）
│   ├── userInputEvents.ts  # 用户输入（2 个事件）
│   ├── chatEvents.ts       # LLM 流式（4 个事件）
│   ├── conversationEvents.ts # 对话引擎（5 个事件）
│   ├── compressEvents.ts   # 上下文压缩（5 个事件）
│   ├── mcpEvents.ts        # MCP 协议（2 个事件）
│   ├── ideEvents.ts        # IDE 集成（5 个事件）
│   ├── agentEvents.ts      # Agent 管理（6 个事件）
│   ├── roleEvents.ts       # 角色切换（2 个事件）
│   ├── teamEvents.ts       # 团队协作（4 个事件）
│   ├── taskEvents.ts       # 任务管理（4 个事件）
│   ├── skillEvents.ts      # Skill 系统（5 个事件）
│   ├── snapshotEvents.ts   # 快照（2 个事件）
│   ├── loopEvents.ts       # 循环/剪贴板（2 个事件）
│   ├── researchEvents.ts   # 深度研究（3 个事件）
│   ├── cleanupEvents.ts    # 清理协调（2 个事件）
│   └── hookEvents.ts       # Hook 执行（1 个事件）
│
└── lifecycle/            # 进程生命周期工具（清理注册、子进程执行、临时文件管理）
    ├── index.ts          # 统一导出
    ├── globalCleanup.ts   # 全局清理回调注册器（LIFO 顺序执行）
    ├── cleanupProvider.ts # 清理提供者接口
    ├── processManager.ts  # 子进程执行封装（Bun.spawn + 超时控制）
    └── tmpCleanup.ts     # 临时文件清理（启动/退出时清理过期文件）
```

## 子模块说明

| 子模块                         | 职责                 | 主要导出                                                                                    |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------- |
| `core/types.ts`                | 核心类型定义         | `EventDefinition`, `EventPayload`, `EventHandler`, `EventQueueItem`, `EventHistoryItem`     |
| `core/constants.ts`            | 默认配置常量         | `HISTORY_CLEANUP_INTERVAL_MS`, `MAX_EVENT_QUEUE_SIZE`, `DEFAULT_THROTTLED_EVENT_TYPES`      |
| `core/utils.ts`                | 工具函数             | `defineEvent`, `filterExpiredEvents`                                                        |
| `core/eventBus.ts`             | EventBus 主类 + 单例 | `EventBus`, `globalBus`                                                                     |
| `core/dispatch.ts`             | 事件分发引擎         | `drainDispatchItems`, `dispatchEventThroughHandlers`                                        |
| `core/history.ts`              | 历史记录管理         | `EventBusHistoryManager`                                                                    |
| `core/queueRuntime.ts`         | 队列调度运行时       | `EventBusQueueRuntime`                                                                      |
| `core/subscriptions.ts`        | 订阅管理             | `EventBusSubscriptionsManager`                                                              |
| `core/throttle.ts`             | 高频事件节流         | `EventBusThrottleManager`                                                                   |
| `core/lifecycle.ts`            | 进程生命周期         | `installGlobalProcessHandlers`, `uninstallGlobalProcessHandlers`, `__resetGlobalBusForTest` |
| `events/`                      | 事件契约定义         | `AppEvent`, `AppEventType`, `EventPayloadMap`, 20 个域事件集合                              |
| `runtimeEvents.ts`             | 跨传输层运行时事件   | `createRuntimeEvent`, `toLegacySseEvent`, `toAcpSessionUpdate`                              |
| `lifecycle/globalCleanup.ts`   | 全局清理回调注册器   | `registerCleanup`, `unregisterCleanup`, `runCleanup`, `clearCleanup`                        |
| `lifecycle/processManager.ts`  | 子进程执行封装       | `exec`, `commandExists`                                                                     |
| `lifecycle/tmpCleanup.ts`      | 临时文件清理         | `registerTmpCleanup`, `runTmpCleanup`                                                       |
| `lifecycle/cleanupProvider.ts` | 清理提供者接口       | `CleanupProvider`                                                                           |

## 完整 API 导出

以下为 `index.ts` 导出的完整清单，所有外部模块应通过 `@bus` 统一入口引用：

### 类型导出

```typescript
import type {
  // ─── 核心类型 ──────────────────────────────────────────
  EventDefinition,           // 事件定义接口 { type: string }
  EventPayload,              // 事件载荷 { id, type, properties }
  EventHandler,             // 处理器签名 (data: EventPayload<T>) => void
  EventQueueItem,            // 队列条目 { type, payload, priority }
  EventHistoryItem,         // 历史条目 { type, payload, timestamp }

  // ─── 事件聚合类型 ──────────────────────────────────────
  AppEventType,              // 所有事件类型字符串联合
  EventPayloadMap,           // 事件名 → 载荷类型的映射
  EventOf<K>,                // 按事件名获取 EventDefinition 类型
  AppEventHandler<K>,       // 类型化 handler 签名

  // ─── 事件辅助类型 ──────────────────────────────────────
  ToolCallBase,              // 工具调用公共基字段
  ToolResultBase,            // 工具结果公共基字段
  AppEventNameValidationIssue,    // 命名校验问题
  CriticalPayloadValidationIssue, // 载荷校验问题

  // ─── 跨传输层运行时事件类型 ──────────────────────────
  RuntimeEvent,                        // 运行时事件联合类型
  RuntimeEventInput,                   // 运行时事件输入类型
  LegacySseEvent,                      // Legacy SSE 事件类型
  AcpSessionUpdate,                    // ACP SessionNotification 类型

  // ─── 进程生命周期类型 ──────────────────────────────────
  ProcessResult,                       // 进程执行结果
  ProcessOptions,                      // 进程执行选项
  CleanupProvider,                     // 清理提供者接口
} from "@bus";
```

### 值导出

```typescript
import {
  // ─── EventBus 核心 ─────────────────────────────────────
  EventBus, // EventBus 主类
  globalBus, // 全局单例实例

  // ─── 工具函数 ──────────────────────────────────────────
  defineEvent, // 创建类型安全的事件定义
  filterExpiredEvents, // 按时间戳和容量过滤历史

  // ─── 进程生命周期 ──────────────────────────────────────
  installGlobalProcessHandlers, // 注册进程退出处理器
  uninstallGlobalProcessHandlers, // 卸载进程退出处理器
  __resetGlobalBusForTest, // 测试重置全局 bus

  // ─── 应用事件聚合 ──────────────────────────────────────
  AppEvent, // 所有域事件的统一聚合对象

  // ─── 域事件集合 ──────────────────────────────────────
  LifecycleEvents, // 应用生命周期（12 个事件）
  SessionEvents, // 会话管理（16 个事件）
  ToolEvents, // 工具执行（3 个事件）
  PermissionEvents, // 权限控制（3 个事件）
  UserInputEvents, // 用户输入（2 个事件）
  ChatEvents, // LLM 流式（4 个事件）
  ConversationEvents, // 对话引擎（5 个事件）
  CompressEvents, // 上下文压缩（5 个事件）
  McpEvents, // MCP 协议（2 个事件）
  IdeEvents, // IDE 集成（5 个事件）
  AgentEvents, // Agent 管理（6 个事件）
  RoleEvents, // 角色切换（2 个事件）
  TeamEvents, // 团队协作（4 个事件）
  TaskEvents, // 任务管理（4 个事件）
  SkillEvents, // Skill 系统（5 个事件）
  SnapshotEvents, // 快照（2 个事件）
  LoopEvents, // 循环/剪贴板（2 个事件）
  ResearchEvents, // 深度研究（3 个事件）
  CleanupEvents, // 清理协调（2 个事件）
  HookEvents, // Hook 执行（1 个事件）

  // ─── 事件辅助工具 ──────────────────────────────────────
  validateEventName, // 校验事件名称是否符合命名规范
  isNamedException, // 检查是否在命名例外集中
  validateAllAppEventNames, // 批量校验所有 AppEvent 名称
  validateCriticalAppEventPayloadShapes, // 校验关键事件载荷 shape

  // ─── 跨传输层运行时事件 ──────────────────────────────
  createRuntimeEvent, // 创建带时间戳的运行时事件
  toLegacySseEvent, // 转 Legacy SSE 事件格式
  toAcpSessionUpdate, // 转 ACP SessionNotification

  // ─── 进程生命周期工具 ──────────────────────────────────
  registerCleanup, // 注册退出清理回调
  unregisterCleanup, // 注销清理回调
  runCleanup, // 执行所有清理回调（LIFO）
  clearCleanup, // 清空清理注册表
  registerTmpCleanup, // 注册临时文件退出清理
  runTmpCleanup, // 执行临时文件清理
  exec, // 子进程执行（Bun.spawn）
  commandExists, // 检查命令是否存在
} from "@bus";
```

## 使用方法

### 发布事件

```typescript
import { globalBus, AppEvent } from "@bus";

// 简单发布
globalBus.publish(AppEvent.SessionCreated, { sessionId: "abc" });

// 带优先级
import { ThrottlePriority } from "@core/throttle/throttleQueue";
globalBus.publish(
  AppEvent.ToolResult,
  { tool, result, success },
  {
    priority: ThrottlePriority.HIGH,
  },
);

// 强制节流
globalBus.publish(AppEvent.Log, { level: "info", message: "..." }, { throttle: true });
```

### 订阅事件

```typescript
// 精确订阅
const unsub = globalBus.subscribe(AppEvent.SessionStatusChanged, ({ properties }) => {
  if (properties.status === "idle") handleIdle();
});

// 一次性订阅
globalBus.subscribeOnce(AppEvent.AppStarted, ({ properties }) => {
  console.log(`App v${properties.version} started`);
});

// 按 sessionId 过滤
globalBus.subscribeForSession(AppEvent.ConversationStreamToken, currentSessionId, ({ properties }) =>
  appendToken(properties.content),
);

// 前缀订阅 — 捕获所有 session. 事件
globalBus.subscribePrefix("session.", (payload) => {
  console.log(`Session event: ${payload.type}`);
});

// 全局通配符
globalBus.subscribeAll((payload) => {
  monitor.record(payload.type);
});
```

### 进程生命周期

```typescript
import { installGlobalProcessHandlers, __resetGlobalBusForTest } from "@bus";

// 应用入口 — 显式安装退出处理器
installGlobalProcessHandlers(globalBus);

// 测试 — 重置全局 bus
beforeEach(() => __resetGlobalBusForTest());
```

### 调试与监控

```typescript
// 打印调试快照
globalBus.debug();

// 读取性能指标
const metrics = globalBus.getMetrics();
console.log(`已发布 ${metrics.totalEvents} 事件，历史 ${metrics.historySize} 条`);

// 查询历史
const recent = globalBus.getHistory({ limit: 10 });
```

## 在系统架构中的作用

```
┌─────────────────────────────────────────────────────────┐
│                    应用层 (src/)                         │
│  session / conversation / task / tool / mcp / team ...  │
│              publish()          subscribe()             │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│               Bus 模块 (src/bus/)                        │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐  │
│  │ publish │ │subscribe │ │ throttle  │ │ history   │  │
│  └─────────┘ └──────────┘ └───────────┘ └───────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐  │
│  │ dispatch│ │queue     │ │ lifecycle │ │ events    │  │
│  └─────────┘ └──────────┘ └───────────┘ └───────────┘  │
└──────────────────────────────────────────────────────────┘
```

Bus 直接支撑的主要链路：

| 链路         | 发布方                | 订阅方                          | 关键事件                                           |
| ------------ | --------------------- | ------------------------------- | -------------------------------------------------- |
| **对话链路** | conversation/llmLoop  | UI/chat context                 | `ConversationStreamToken`, `ConversationCompleted` |
| **权限链路** | permission/permission | UI/permissionDialog             | `PermissionAsked`, `PermissionResolved`            |
| **工具链路** | tool/toolExecution    | UI/statusBar, recorder          | `ToolCall`, `ToolResult`, `ToolTimeout`            |
| **会话链路** | session/sessionStatus | UI/sessionList, sessionSwitcher | `SessionCreated`, `SessionStatusChanged`           |
| **服务桥接** | server/sse, acp       | 外部客户端                      | 所有事件转发                                       |
| **团队链路** | team/teamTracker      | UI/teamPanel                    | `TeamMateSpawned`, `TeamMateMessage`               |
| **压缩链路** | compress/compressor   | session/recorder                | `CompressStarted`, `CompressCompleted`             |

## 与外部系统的交互

| 外部模块                   | 交互方式     | 说明                                    |
| -------------------------- | ------------ | --------------------------------------- |
| `@conversation/llmLoop`    | 发布对话事件 | 对话流式/完成/中止等状态广播            |
| `@conversation/compaction` | 发布压缩事件 | 压缩全生命周期事件                      |
| `@permission`              | 发布权限事件 | 权限申请/决议/状态同步                  |
| `@tool/*`                  | 发布工具事件 | 工具调用/结果/超时                      |
| `@server/*`                | 订阅 + 转发  | SSE/ACP/headless/collaboration 事件转发 |
| `@ui/contexts`             | 订阅 UI 更新 | 聊天流/状态栏/弹窗/主题等 UI 联动       |
| `@core/throttle`           | 依赖节流队列 | ThrottlePriority 枚举 + ThrottleQueue   |
| `@core/ringBuffer`         | 依赖数据结构 | 事件队列 + 历史存储                     |
| `@config`                  | 读取配置     | 事件历史容量、TTL 等配置值              |

## 设计决策

| 决策                 | 原因                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| 统一 `@bus` 入口     | 避免散落的 `@bus/eventBus`、`@bus/events` 等路径，外部消费者只需一个导入源 |
| `core/` 内部隔离     | EventBus 引擎实现细节不对外暴露，降低认知负担，允许内部自由重构            |
| 事件定义与引擎分离   | 域事件文件不依赖 EventBus 类，可独立编译和测试                             |
| RingBuffer 容量约束  | 防止内存无限增长，队列满时覆盖最旧事件（事件丢失优于 OOM）                 |
| TTL 定时清理         | 事件历史仅保留近期数据，cleanup timer 使用 `unref()` 不阻止进程退出        |
| 三级订阅路由         | 精确 → 前缀 → 通配符，兼顾精确匹配效率和灵活性                             |
| 节流队列独立于主队列 | 避免高频事件阻塞主队列处理，时间窗口内合并同类事件                         |
| 命名规范校验         | 保持事件命名的全局一致性，例外表兼容历史遗留命名                           |

## 配置项

| 常量                            | 值                                                                       | 说明                               |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| `MAX_EVENT_QUEUE_SIZE`          | 10,000                                                                   | 事件队列最大容量（RingBuffer）     |
| `HISTORY_CLEANUP_INTERVAL_MS`   | 300,000 (5 分钟)                                                         | 历史清理定时器间隔                 |
| `DEFAULT_THROTTLED_EVENT_TYPES` | `app.log`, `tool.result`, `conversation.stream.token`, `resource.update` | 默认节流事件类型                   |
| 节流窗口                        | 100ms                                                                    | 同类事件合并时间窗口               |
| 节流队列上限                    | 500                                                                      | 节流队列最大容量                   |
| 订阅者上限                      | 100/type                                                                 | 单事件类型最大订阅者数量           |
| 批量消费                        | 50 条/次                                                                 | 节流队列每次搬运到主队列的批量大小 |

## 边界与限制

1. **纯内存事件分发** — 不涉及持久化或网络传输
2. **进程退出需显式注册** — 调用 `installGlobalProcessHandlers()` 注册信号处理
3. **事件载荷不强制校验** — `validatePayloadInDev` 仅在非 production 环境下做非空检查
4. **历史记录有容量上限** — 超出 RingBuffer 容量时覆盖最旧事件
5. **节流队列可能丢事件** — 溢出时丢弃最旧事件，不阻塞发布方
6. **handler 超时仅记录日志** — 超时后不中断处理器执行，仅输出警告
7. **命名规范非强制** — 校验工具仅在 lint/dev 模式下使用，不阻塞生产代码

## 故障排查

| 现象                       | 可能原因                | 排查步骤                                           |
| -------------------------- | ----------------------- | -------------------------------------------------- |
| 事件未被处理               | 订阅未注册或已取消      | 检查 `subscribe()` 返回值是否被调用取消            |
| 高频事件丢失               | 节流队列溢出            | 检查 `globalBus.getMetrics().throttledCount`       |
| 事件历史为空               | 历史容量为 0 或全部过期 | 调用 `globalBus.getMetrics()` 检查 `historySize`   |
| 进程退出时事件丢失         | 未安装进程处理器        | 确认 `installGlobalProcessHandlers()` 已在入口调用 |
| subscribeForSession 不触发 | 载荷缺少 sessionId      | 检查事件载荷是否包含 `sessionId` 字段              |

## 相关测试

| 测试文件                                        | 覆盖范围                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `test/unit/bus/eventBus.test.ts`                | EventBus 核心功能（发布/订阅/节流/历史）                                             |
| `test/unit/bus/eventBusExtended.test.ts`        | EventBus 扩展功能（前缀订阅/通配符/flush/超时/priority）                             |
| `test/unit/bus/events.test.ts`                  | AppEvent 聚合与类型推导                                                              |
| `test/unit/bus/events/contract.test.ts`         | 全量事件载荷契约矩阵                                                                 |
| `test/unit/bus/events/permissionEvents.test.ts` | 权限域事件契约                                                                       |
| `test/unit/bus/events/sessionEvents.test.ts`    | 会话域事件契约                                                                       |
| `test/unit/bus/events/toolEvents.test.ts`       | 工具域事件契约                                                                       |
| `test/unit/bus/eventBusStructure.test.ts`       | 模块结构与导出完整性                                                                 |
| `test/unit/bus/runtimeEvents.test.ts`           | 跨传输层运行时事件桥接（createRuntimeEvent / toLegacySseEvent / toAcpSessionUpdate） |
| `test/unit/bus/p3Coverage.test.ts`              | P3 补充测试（跨实例隔离/生命周期/节流 flush/命名规范/flushSync）                     |
| `test/unit/bus/lifecycle.test.ts`               | 进程生命周期清理                                                                     |
| `test/unit/bus/processManager.test.ts`          | 子进程执行封装                                                                       |
| `test/unit/bus/tmpCleanup.test.ts`              | 临时文件清理                                                                         |

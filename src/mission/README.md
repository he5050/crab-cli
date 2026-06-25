# Mission 模块 — 异步任务、目标管理与定时循环引擎

## 整体定位

Mission 模块是系统的异步任务管理、会话级目标（Goal）生命周期管理与定时循环（Loop）调度引擎。它统一了三大核心能力：

- **Task** — 异步任务的创建、执行、取消和持久化
- **Goal** — 会话级目标的创建、暂停、恢复、清除，Token 预算控制与自动续接
- **Loop** — 定时任务的创建、启动、取消，支持多种调度类型（固定间隔、Cron、一次性）与后台守护进程

模块与 UI 面板（`@ui`）、命令面板（`@commandPalette`）以及跨进程任务运行器（`server/taskRunner`）联动，支持通过命令行交互管理任务和循环。

## 核心功能

1. **异步任务管理** — 创建、查询、取消异步任务，管理任务生命周期
2. **Goal 管理** — 会话级目标的生命周期管理（创建、暂停、恢复、清除），Token 预算控制，自动续接提示词注入
3. **Task 执行器** — 独立的 ConversationHandler 执行异步任务，支持超时和事件通知
4. **Loop 管理器** — 定时任务创建、启动、取消，支持多种调度类型（固定间隔、Cron、一次性）
5. **Loop 守护进程** — 后台循环任务的 PID/日志/状态管理，支持 `signalProcess` 注入用于测试
6. **Loop 调度类型** — 提供解析和验证功能（Cron 表达式、自然语言调度）
7. **运行时初始化** — 统一的运行时启动入口，自动加载持久化状态
8. **跨进程任务管理** — 与 `server/taskRunner` 协同，通过磁盘文件实现跨进程任务状态共享

## 目录结构

```
src/mission/
├── index.ts              # 统一值导出入口（@mission）
├── type.ts               # 统一类型导出入口（@mission/type）
├── README.md             # 本文档
│
├── types/                # 核心类型与常量
│   └── index.ts          # 类型定义（AsyncTask, TaskStatus, GoalRecord, GoalStatus 等）
│
├── goal/                 # Goal 管理器
│   ├── index.ts          # Barrel 导出（GoalManager, goalManager）
│   └── manager.ts        # Goal 生命周期管理（创建、暂停、恢复、清除、Token 预算、续接）
│
├── task/                 # Task 管理器与执行器
│   ├── index.ts          # 统一导出
│   ├── manager.ts        # 异步任务生命周期管理
│   └── executor.ts       # 异步任务执行器
│
└── loop/                 # Loop 管理器与守护进程
    ├── index.ts          # 统一导出
    ├── manager.ts        # 定时任务管理（创建、启动、取消、持久化）
    ├── daemon.ts         # 守护进程管理（PID 文件、日志轮转、signalProcess 注入）
    └── schedule.ts       # 调度类型与工具函数（完整 5 字段 Cron 解析、自然语言解析、下次执行计算）
```

## 子模块说明

| 子模块   | 职责                              | 主要导出                                                                                                                            |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `types/` | 核心类型定义与常量                | `AsyncTask`, `TaskStatus`, `GoalRecord`, `GoalStatus`, `DEFAULT_GOAL_TOKEN_BUDGET`                                                  |
| `goal/`  | Goal 生命周期管理                 | `GoalManager`, `goalManager`                                                                                                        |
| `task/`  | Task 管理器 + 执行器              | `TaskManager`, `taskManager`, `executeTask`                                                                                         |
| `loop/`  | Loop 管理器 + 守护进程 + 调度类型 | `LoopManager`, `loopManager`, `LoopDaemonManager`, `loopDaemonManager`, `parseLoopSchedule`, `validateCron`, `calculateNextCronRun` |

## 入口规范

- **值/类入口**：`@mission` — 所有运行时值、类、工厂函数
- **类型入口**：`@mission/type` — 所有 TypeScript 类型

```typescript
// 引用值/类
import { GoalManager, taskManager, executeTask } from "@mission";

// 引用类型
import type { AsyncTask, GoalRecord, LoopRecord } from "@mission/type";
```

## 完整 API 导出

### 类型导出（@mission/type）

```typescript
import type {
  // 核心类型
  AsyncTask, // 异步任务接口
  TaskStatus, // 任务状态：pending/running/completed/failed/cancelled
  GoalStatus, // Goal 状态：pursuing/paused/achieved/unmet/budget-limited/cleared
  GoalRecord, // Goal 记录
  GoalStatusUpdate, // Goal 状态更新
  GoalCreateOptions, // Goal 创建选项
  TaskEventPayload, // 任务事件载荷
  GoalEventPayload, // Goal 事件载荷

  // 管理器类型
  GoalManager, // Goal 管理器类
  TaskManager, // Task 管理器类
  LoopManager, // Loop 管理器类
  LoopDaemonManager, // 守护进程管理器类

  // 执行器类型
  TaskExecutorOptions, // 任务执行器选项
  TaskExecutorResult, // 任务执行器结果

  // Loop 类型
  LoopExecutionRecord, // 循环执行记录
  LoopRecord, // 循环记录
  LoopScheduleInput, // 循环调度输入
  LoopStats, // 循环统计

  // 守护进程类型
  LoopDaemonStatus, // 守护进程状态
  LoopDaemonRecord, // 守护进程记录
} from "@mission/type";
```

### 值导出（@mission）

```typescript
import {
  // ─── 常量 ──────────────────────────────────────────────
  DEFAULT_GOAL_TOKEN_BUDGET, // 默认 Goal Token 预算（2M）

  // ─── Goal 管理 ─────────────────────────────────────────
  GoalManager, // Goal 管理器类
  goalManager, // 默认 Goal 管理器实例

  // ─── Task 管理 ─────────────────────────────────────────
  TaskManager, // Task 管理器类
  taskManager, // 默认 Task 管理器实例

  // ─── Task 执行 ─────────────────────────────────────────
  executeTask, // 异步任务执行函数

  // ─── Loop 管理 ─────────────────────────────────────────
  LoopManager, // Loop 管理器类
  loopManager, // 默认 Loop 管理器实例
  parseLoopSchedule, // 解析调度输入
  scheduleLabel, // 生成调度标签
  validateCron, // 验证 Cron 表达式
  calculateNextCronRun, // 计算下次 Cron 执行时间（完整 5 字段：分 时 日 月 星期）

  // ─── Loop 守护进程 ─────────────────────────────────────
  LoopDaemonManager, // 守护进程管理器类
  loopDaemonManager, // 默认守护进程管理器实例

  // ─── 测试覆写支持 ──────────────────────────────────────
  __setLoopManagerDepsForTesting, // 注入 LoopManager 依赖（测试用）
  __resetLoopManagerDepsForTesting, // 重置 LoopManager 依赖（测试用）

  // ─── 运行时初始化 ───────────────────────────────────────
  initTaskRuntime, // 统一运行时启动入口
} from "@mission";
```

## Goal 管理与状态机

Goal 是会话级目标，每个会话同时只能有一个 pursuing 或 paused 的 Goal。状态转换遵循严格的状态机规则：

```
                    createGoal()
                         │
                         ▼
               ┌──────────────────┐
               │                  │
               │    pursuing      │
               │                  │
               └──┬───┬───┬───┬───┘
                  │   │   │   │
       pauseGoal()│   │   │   │modelUpdateGoal()
                  │   │   │   │
                  ▼   │   │   ├──► achieved
               ┌────────┐│   │
               │ paused ││   │
               └───┬────┘│   │
                   │     │   ├──► unmet
     resumeGoal() │     │   │
                   │     │   │
                   │     │   ├──► budget-limited  (accrueTokens 超预算)
                   │     │   │
                   ▼     │   │
               ┌────────┐│   │
               │pursuing◄┘   │
               └─────────────┘
                   │
                   │ clearGoal()
                   ▼
                 cleared
```

### Goal 关键操作

```typescript
import { goalManager } from "@mission";
import type { GoalRecord } from "@mission/type";

// 创建目标
const goal = goalManager.createGoal({
  objective: "完成代码审查",
  sessionId: "session-123",
});

// 暂停/恢复
goalManager.pauseGoal("session-123");
goalManager.resumeGoal("session-123");

// Token 预算管理（超出自动转为 budget-limited）
const { exceeded, goal: updatedGoal } = goalManager.accrueTokens("session-123", 15000);

// 续接管理（Ralph Loop 场景）
goalManager.markPendingContinuation("session-123");
const prompt = goalManager.consumePendingContinuation("session-123");

// 会话迁移（压缩后）
goalManager.migrateGoalToSession("old-session", "new-session");

// 查看目标状态
const summary = goalManager.formatSummary(goal);
```

## 使用方法

### 任务管理

```typescript
import { taskManager } from "@mission";
import type { AsyncTask } from "@mission/type";

// 创建异步任务
const task = taskManager.createTask("task-id", {
  request: "请帮我分析代码",
  toolName: "code-analysis",
});

// 监听任务状态
taskManager.onStatusChange(task, (status) => {
  console.log(`任务状态: ${status}`);
});

// 取消任务
taskManager.cancelTask("task-id");
```

### 定时循环

```typescript
import { loopManager, parseLoopSchedule } from "@mission";

// 使用 Cron 表达式
const schedule = parseLoopSchedule("0 */2 * * *");
if (schedule) {
  const loop = loopManager.createLoop(schedule);
  loopManager.startLoop(loop.id);
}

// 使用自然语言
const schedule2 = parseLoopSchedule("every 30 minutes");
if (schedule2) {
  const loop2 = loopManager.createLoop(schedule2);
}
```

### 运行时初始化

```typescript
import { initTaskRuntime } from "@mission";

// 在应用启动时调用
initTaskRuntime(projectDir);

// 可选: 自定义管理器实例或跳过任务加载
initTaskRuntime(projectDir, { taskManager: myTaskManager }, { skipTaskLoad: true });
```

## LoopDaemonManager 与 signalProcess 注入

`LoopDaemonManager` 负责后台循环守护进程的 PID 文件管理、日志轮转和进程存活检测。构造器支持 `signalProcess` 注入，方便单元测试时不依赖真实进程：

```typescript
import { LoopDaemonManager } from "@mission";

// 生产环境: 默认使用 process.kill
const daemon = new LoopDaemonManager();

// 测试环境: 注入 mock signalProcess
const mockSignal = jest.fn().mockReturnValue(true);
const testDaemon = new LoopDaemonManager({
  processId: 12345,
  signalProcess: mockSignal,
});
```

## server/taskRunner 跨进程任务管理

`server/taskRunner.ts` 是 Mission 模块的外部协作模块，负责后台任务在独立进程中运行时的状态同步。

### 架构关系

```
┌──────────────────────┐         磁盘 (.crab/tasks/)         ┌──────────────────────┐
│   Mission (主进程)    │ ◄──────────────────────────────────► │  server/taskRunner   │
│                      │                                      │  (后台子进程)         │
│  - taskManager       │         TaskRecord JSON 文件          │  - registerTask()    │
│  - createTask()      │                                      │  - setTaskPid()      │
│  - cancelTask()      │                                      │  - completeTask()    │
│  - loadFromDisk()    │                                      │  - isProcessAlive()  │
└──────────────────────┘                                      └──────────────────────┘
```

### 交互方式

| 方向                  | 操作                                                 | 说明                                            |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| Mission -> taskRunner | 创建任务后子进程启动                                 | Mission 发起任务，taskRunner 子进程负责实际执行 |
| taskRunner -> 磁盘    | `registerTask()` / `setTaskPid()` / `completeTask()` | 子进程注册自身，写入 PID 和结果                 |
| Mission -> 磁盘       | `loadFromDisk()` / `reconcileRunningTasks()`         | 主进程从磁盘同步状态，检测子进程是否存活        |
| 共享依赖              | `@mission/type` 中的 `AsyncTask` / `TaskStatus`      | 类型定义跨进程共享，保证结构一致                |
| 共享依赖              | `@core/utilities` 中的 `isProcessAlive`              | 双方均使用相同的进程存活检测逻辑                |

### taskRunner 关键 API

```typescript
import {
  listTasks, // 列出所有后台任务（含磁盘同步）
  getTask, // 获取指定任务详情
  registerTask, // 注册新任务（写入磁盘）
  setTaskPid, // 设置任务进程 PID
  completeTask, // 标记任务完成
  formatTaskRecordLine, // 格式化单行摘要
  formatTaskRecordDetail, // 格式化详情
} from "@/server/taskRunner";
```

### 数据一致性

- **存储路径**: `.crab/tasks/<taskId>.json`
- **文件锁**: 使用目录锁（`.crab/tasks.lock`）防止并发写入冲突
- **自动清理**: 最多保留 200 个已完成任务，30 天前的已完成任务自动清理
- **状态协调**: `reconcileRunningTasks()` 通过 `isProcessAlive()` 检测已退出的运行中任务，自动标记为 failed

## 共享工具函数（@core/utilities）

Mission 模块及其协作模块（`server/taskRunner`、`goal/manager`）依赖 `@core/utilities` 提供的通用工具函数：

```typescript
import { isProcessAlive, safeUnlinkSync } from "@/core/utilities";
```

### isProcessAlive(pid: number): boolean

检测进程是否存活。向目标 PID 发送信号 `0`（不实际终止进程），根据返回值判断：

- 返回 `true` — 进程存在
- 返回 `false` — 进程不存在
- `EPERM`（权限不足）按存活处理，因为进程确实存在

用于 `server/taskRunner` 的 `reconcileRunningTasks()` 和 `LoopDaemonManager` 的 `status()` 检查。

### safeUnlinkSync(filePath: string): void

安全删除文件，采用三级降级策略：

1. 首先尝试 `unlinkSync` 正常删除
2. 失败时尝试写入空文件覆盖内容
3. 仍然失败则静默忽略（持久化清理场景，不应影响主流程）

用于 `goal/manager.ts` 的 `clearGoal()` 和 `migrateGoalToSession()` 删除 Goal 持久化文件。

## 与外部系统的交互

| 外部模块            | 交互方式   | 说明                                                               |
| ------------------- | ---------- | ------------------------------------------------------------------ |
| `@ui`               | 状态展示   | Task 状态通过 EventBus 传递到 UI 面板                              |
| `@commandPalette`   | 命令行交互 | 通过动态导入 `@mission` 管理目标和任务                             |
| `@bus`              | 事件发布   | 任务和 Goal 状态变更事件                                           |
| `@core/logger`      | 日志记录   | 任务执行过程的日志输出                                             |
| `@compress`         | 压缩触发   | Goal 的 Token 预算监控触发压缩                                     |
| `@schema/config`    | 配置注入   | Loop 配置从应用配置注入                                            |
| `@tool/scheduler`   | 调度管理   | 通过 `@mission` 管理定时调度工具                                   |
| `server/taskRunner` | 跨进程协作 | 后台子进程通过磁盘文件与主进程共享任务状态                         |
| `@core/utilities`   | 工具函数   | 进程存活检测（`isProcessAlive`）、安全文件删除（`safeUnlinkSync`） |

## 边界与限制

1. **任务执行异步** — 所有任务在后台执行，不阻塞调用方
2. **Goal 单会话单目标** — 每个会话同时只能有一个活跃 Goal
3. **Loop 守护进程独立** — 循环任务在独立进程中运行
4. **状态持久化** — 任务和 Goal 状态通过文件系统持久化，重启后可恢复
5. **跨进程可见性** — `server/taskRunner` 通过磁盘文件与主进程共享任务状态，非实时同步
6. **Goal 状态机严格** — 状态转换需符合状态机规则，违规操作将被拒绝

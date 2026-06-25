# Session — 会话管理模块

## 目录结构

```
src/session/
├── types/          — 纯数据类型（MessagePartTime、MessageFileReference、TokenUsage）
├── core/           — 会话核心 CRUD（session.ts + message.ts + checkpoint.ts）
├── token/          — Token 估算与类型（tokenCounterRef.ts + tokenUsage.ts）
├── state/          — 状态机与管理（stateMachine.ts + sessionStateManager.ts + sessionStatus.ts）
├── adapter/        — AI SDK ↔ session 消息转换（index.ts）
├── io/             — 导入导出与格式转换（exporter、importer、converter、share、snapshot）
├── record/         — 会话录制与回放（recorder.ts + replayer.ts）
├── usage/          — 使用统计（usage.ts + commandUsage.ts）
├── governance/     — 上下文治理面板（index.ts）
├── summarize/      — 会话摘要（index.ts）
├── orchestrator/   — 会话编排（index.ts）
├── permissions/    — 权限持久化（index.ts）
├── index.ts        — 统一值出口
├── type.ts         — 统一类型出口
└── README.md       — 本文件
```

## 入口规范

| 用途       | 导入路径         | 说明                                 |
| ---------- | ---------------- | ------------------------------------ |
| 运行时值   | `@session`       | 所有函数、类、枚举等运行时值         |
| 类型       | `@session/type`  | 所有 type / interface                |
| 纯数据类型 | `@session/types` | 无运行时依赖的纯数据类型（向后兼容） |

## 子目录划分原则

按业务域拆分，每个子目录一个职责：

- **types** — 被 bus/、ui/ 等跨层模块直接引用，不含 session 内部实现依赖
- **core** — 会话基本操作（增删改查、消息管理、检查点）
- **token** — token 估算与类型定义
- **state** — 会话状态机 + 状态管理 + 忙闲状态
- **adapter** — 消息格式转换（AI SDK ↔ session 内部格式）。注意：依赖 `@ui/contexts/chat` 类型定义，见下方"跨层依赖"说明
- **io** — 导入导出（各种格式转换、分享、快照）
- **record** — 录制与回放
- **usage** — 使用统计与命令使用记录
- **governance** — 上下文治理面板（budget 检查、警告收集）
- **summarize** — 会话摘要生成
- **orchestrator** — 会话编排（生命周期管理）
- **permissions** — 权限持久化存储

## Checkpoint 与 Snapshot 的区别

两者都用于保存和恢复会话状态，但设计和适用场景不同：

| 维度       | Checkpoint                           | Snapshot                         |
| ---------- | ------------------------------------ | -------------------------------- |
| 存储位置   | SQLite 数据库（通过 Drizzle ORM）    | 文件系统（`~/.crab/snapshots/`） |
| 生命周期   | 与会话级联删除（删除会话时自动清理） | 独立于会话（手动管理）           |
| 支持模式   | 仅完整快照                           | 完整快照 + 增量快照              |
| 恢复安全性 | 事务保护 + 自动备份                  | 基链解析 + 增量合并              |
| 文件回滚   | 支持关联 git rollback 回滚           | 不支持                           |
| 典型场景   | 日常对话中频繁创建/恢复              | 长期存档、跨会话迁移             |

## 状态管理架构

会话状态由三层协同管理：

1. **SessionStateMachine**（`state/stateMachine.ts`）— 严格的状态机，定义 INIT → RUNNING → WAITING → COMPLETED/FAILED/CANCELLED 的合法转换，使用 Mutex 防止竞态
2. **SessionStatus**（`state/sessionStatus.ts`）— 轻量内存 Map，提供 idle/busy/waiting/error/cancelled/completed/retry 状态。其中 retry 状态用于 LLM 降级重试场景，不经过状态机
3. **SessionStateManager**（`state/sessionStateManager.ts`）— 桥接层，统一两者 + 发布事件到 EventBus

状态映射规则：

- INIT → idle, RUNNING → busy, WAITING → waiting
- COMPLETED → completed, FAILED → error, CANCELLED → cancelled

working 辅助语义：

- `isSessionBusy()` / `getBusySessions()` 将 `busy`、`waiting`、`retry` 都视为进行中状态
- `canAcceptInput()` 仍只在 `idle` 下返回 `true`

## 跨层依赖说明

| 子模块  | 依赖模块                                     | 说明                                                                      |
| ------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| adapter | `@ui/contexts/chat`, `@conversation/message` | adapter 依赖 UI 层的 ChatMessage 类型定义和 conversation 层的消息工厂函数 |

> 改进计划：将 ChatMessage 等共享类型提取到独立模块（如 `src/schema/chat.ts`），消除 session → ui 的反向依赖。

## 外部引用

外部模块统一通过 `@session`（值）或 `@session/type`（类型）引用，不直接引入子目录实现文件。

## 废弃文件

以下文件保留为向后兼容，标记为 `@deprecated`，将在下一大版本移除：

- `session.ts` / `message.ts` / `snapshot.ts` / `exporter.ts` / `importer.ts` — 纯 re-export，指向子模块
- `usageMemory.ts` — 已迁移至 `@/tool/usageMemory`
- `token/tokenCounter.ts` — 中间层，已废弃

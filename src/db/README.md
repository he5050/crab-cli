# DB Module — 数据库持久化层

## 整体定位

DB 模块是系统的数据库持久化层，基于 **bun:sqlite** + **Drizzle ORM** 构建，负责会话、消息、检查点、权限、审批等核心数据的存储与查询。它提供类型安全的 ORM 操作、自动迁移管理、备份恢复机制，以及与 LLM 对话循环的深度集成。

## 核心功能

1. **SQLite 连接管理** — 全局单例连接，WAL 模式并发优化，懒初始化
2. **Drizzle ORM 集成** — 类型安全的查询构建，Schema 单源定义
3. **自动迁移** — Drizzle Kit 管理的 Schema 迁移，支持备份与回滚
4. **级联触发器** — 会话删除时自动清理关联的消息、检查点、审批记录

## 目录结构

```
src/db/
├── index.ts              # 统一出入口，所有外部引用通过此文件
├── type.ts               # 类型-only 导出
├── README.md             # 本文档
│
├── schema/               # Schema 定义
│   └── index.ts          # 5 张表的 Drizzle ORM 定义（sessions, messages, checkpoints, persistentPermissions, approvals）
│
├── core/                 # 核心连接管理 + 迁移
│   ├── index.ts          # 统一导出
│   ├── connection.ts     # 数据库连接（initDb/getDb/closeDb/resetDb/getDbPath/getRawDb）
│   └── migrations.ts     # 迁移逻辑（runMigrations/backup/restore/triggers）
│
└── migrations/           # Drizzle Kit 迁移文件
    ├── 0000_mature_aqueduct.sql
    └── meta/
        ├── _journal.json
        └── 0000_snapshot.json
```

## 子模块说明

| 子模块  | 职责                | 主要导出                                                                                                                       |
| ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `core/` | 连接管理 + 迁移执行 | `initDb`, `getDb`, `closeDb`, `resetDb`, `getRawDb`, `getDbPath`, `runMigrations`（`applyPragmas` 为内部函数，不暴露公共 API） |

## 完整 API 导出

### 类型导出

```typescript
import type {
  DrizzleDb, // Drizzle ORM 实例类型
} from "@db/type";
```

### 值导出

```typescript
import {
  // ─── 连接管理 ──────────────────────────────────────────
  initDb, // 初始化数据库连接（懒初始化单例）
  getDb, // 获取 Drizzle ORM 实例
  getRawDb, // 获取原始 SQLite 实例（特殊查询）
  closeDb, // 关闭数据库连接
  resetDb, // 重置数据库（仅测试）— 清空单例状态
  getDbPath, // 获取数据库文件路径

  // ─── 迁移 ──────────────────────────────────────────────
  runMigrations, // 执行 Drizzle Kit 迁移（含备份/恢复）

  // ─── Drizzle 操作符 ────────────────────────────────────
  eq, // 等值比较
  and, // 逻辑与
  desc, // 降序排列
  asc, // 升序排列
  sql, // 原始 SQL 片段
  inArray, // IN 查询
} from "@db";
```

### Schema 导出

```typescript
import {
  sessions, // 会话表
  messages, // 消息表
  checkpoints, // 检查点表
  persistentPermissions, // 持久化权限表
  approvals, // 审批记录表
} from "@db/schema";
```

## 使用方法

### 初始化数据库

```typescript
import { initDb, closeDb } from "@db";

// 应用启动时初始化
const db = initDb();

// 应用关闭时清理
closeDb();
```

### 执行查询

```typescript
import { getDb, eq, desc, and } from "@db";
import { sessions, messages } from "@db/schema";

const db = getDb();

// 查询会话
const session = await db.query.sessions.findFirst({
  where: eq(sessions.id, "Ses_abc123"),
});

// 查询会话的消息（按创建时间降序）
const msgs = await db.query.messages.findMany({
  where: eq(messages.sessionId, "Ses_abc123"),
  orderBy: [desc(messages.createdAt)],
  limit: 50,
});

// 复杂条件查询
const approved = await db.query.approvals.findMany({
  where: and(eq(approvals.sessionId, "Ses_abc123"), eq(approvals.decision, "allow")),
});
```

### 使用原始 SQL

```typescript
import { getRawDb, sql } from "@db";

const rawDb = getRawDb();
const result = rawDb.query("SELECT COUNT(*) AS count FROM sessions").get();
```

### 插入/更新数据

```typescript
import { getDb, eq } from "@db";
import { sessions } from "@db/schema";

const db = getDb();

// 插入
await db.insert(sessions).values({
  id: "Ses_new123",
  title: "New Session",
  status: "active",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// 更新
await db.update(sessions).set({ updatedAt: Date.now(), tokensInput: 1000 }).where(eq(sessions.id, "Ses_new123"));

// 删除
await db.delete(sessions).where(eq(sessions.id, "Ses_new123"));
```

### 事务操作

```typescript
import { getDb } from "@db";

const db = getDb();

await db.transaction(async (tx) => {
	await tx.insert(sessions).values({ ... });
	await tx.insert(messages).values({ ... });
	// 自动提交或回滚
});
```

## 数据库 Schema

### sessions（会话表）

| 字段              | 类型        | 说明                                |
| ----------------- | ----------- | ----------------------------------- |
| `id`              | text (PK)   | 会话ID（Ses_xxx）                   |
| `title`           | text        | 会话标题                            |
| `status`          | text (enum) | 状态：active/paused/completed/error |
| `model`           | text        | 使用的模型名称                      |
| `parentId`        | text        | 分叉来源会话ID                      |
| `projectDir`      | text        | 项目目录                            |
| `tokensInput`     | integer     | 输入 Token 数                       |
| `tokensOutput`    | integer     | 输出 Token 数                       |
| `tokensReasoning` | integer     | 推理 Token 数                       |
| `cost`            | integer     | 成本（微美分）                      |
| `agentStateJson`  | text        | Agent 状态快照（JSON）              |
| `createdAt`       | integer     | 创建时间戳                          |
| `updatedAt`       | integer     | 更新时间戳                          |

### messages（消息表）

| 字段        | 类型        | 说明                             |
| ----------- | ----------- | -------------------------------- |
| `id`        | text (PK)   | 消息ID（Msg_xxx）                |
| `sessionId` | text        | 所属会话ID                       |
| `role`      | text (enum) | 角色：system/user/assistant/tool |
| `partsJson` | text        | 消息内容（MessagePart[] JSON）   |
| `createdAt` | integer     | 创建时间戳                       |

### checkpoints（检查点表）

| 字段           | 类型      | 说明                |
| -------------- | --------- | ------------------- |
| `id`           | text (PK) | 检查点ID（Chk_xxx） |
| `sessionId`    | text      | 所属会话ID          |
| `label`        | text      | 检查点标签          |
| `messageIndex` | integer   | 对应的消息索引      |
| `snapshotJson` | text      | 快照数据（JSON）    |
| `createdAt`    | integer   | 创建时间戳          |

### persistentPermissions（持久化权限表）

| 字段         | 类型         | 说明                                   |
| ------------ | ------------ | -------------------------------------- |
| `id`         | integer (PK) | 自增ID                                 |
| `pattern`    | text         | 权限模式（如 `*`, `git *`, `**/*.ts`） |
| `permission` | text         | 权限类型（Bash/fs.write/mcp 等）       |
| `action`     | text (enum)  | allow/deny                             |
| `source`     | text (enum)  | user/default/project                   |
| `createdAt`  | integer      | 创建时间戳                             |

### approvals（审批记录表）

| 字段         | 类型        | 说明                          |
| ------------ | ----------- | ----------------------------- |
| `id`         | text (PK)   | 审批ID（Appr_xxx）            |
| `sessionId`  | text        | 所属会话ID                    |
| `pattern`    | text        | 审批模式                      |
| `permission` | text        | 审批权限类型                  |
| `decision`   | text (enum) | allow/deny                    |
| `expiresAt`  | integer     | 过期时间戳（null = 永不过期） |
| `timestamp`  | integer     | 创建时间戳                    |

## 与外部系统的交互

| 外部模块                                      | 交互方式                                           | 说明                                |
| --------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `src/index.ts`                                | 调用 `initDb()` / `closeDb()`                      | 应用启动/关闭时的数据库生命周期管理 |
| `src/server/headless.ts`                      | 调用 `initDb()` / `closeDb()`                      | Headless 服务器的数据库初始化与关闭 |
| `src/server/acpServer.ts`                     | 调用 `initDb()`                                    | ACP 服务器的数据库初始化            |
| `src/cli/type.ts`                             | 定义 `initDb`/`closeDb` 接口                       | CLI 依赖注入接口定义                |
| `src/cli/core/tuiRunner.ts`                   | 通过 `deps.initDb()` 调用                          | TUI 启动时初始化数据库              |
| `src/cli/core/lifecycle.ts`                   | 通过 `deps.closeDb()` 调用                         | CLI 生命周期关闭时清理数据库        |
| `src/session/core/*`                          | 查询/写入 `sessions`, `messages`, `checkpoints` 表 | 会话、消息、检查点的 CRUD 操作      |
| `src/session/permissions/`                    | 查询 `persistentPermissions` 表                    | 持久化权限规则的读取与应用          |
| `src/session/usage/`                          | 使用 `getRawDb()`                                  | 使用统计的原始 SQL 查询             |
| `src/permission/approvalStore.ts`             | 查询/写入 `approvals` 表                           | 运行时审批记录的持久化              |
| `src/agent/core/state.ts`                     | 查询 `sessions` 表                                 | Agent 状态持久化                    |
| `src/tool/codebaseSearch/indexer/vectorDb.ts` | 使用 `getRawDb()`                                  | 向量索引的原始 SQL 查询             |

## 配置项

| 配置项                   | 来源                        | 说明                                                     |
| ------------------------ | --------------------------- | -------------------------------------------------------- |
| `SQLITE_BUSY_TIMEOUT_MS` | `@config`                   | SQLite 忙锁超时（毫秒）                                  |
| 数据库路径               | `getDataDir() + "/crab.db"` | 默认 `~/.crab/crab.db`，可通过 `initDb(customPath)` 覆盖 |

## 边界与限制

1. **单连接模式** — 当前使用全局单例连接，WAL 模式下支持并发读，但写操作串行化
2. **懒初始化** — `getDb()` 会自动调用 `initDb()`，无需手动初始化
3. **迁移自动执行** — 每次 `initDb()` 都会检查并执行未应用的迁移
4. **备份策略** — 迁移前自动备份 `crab.db` → `crab.db.bak`，失败时自动恢复
5. **级联删除** — 删除会话时自动清理关联的消息、检查点、审批记录（通过触发器）

## 设计决策

| 决策                 | 原因                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| 全局单例连接         | CLI 工具为单进程应用，单连接足够，避免多连接写锁冲突                      |
| WAL 模式             | 提升并发读性能，允许读写并行                                              |
| Schema 单源定义      | Drizzle ORM 的 `schema` 对象作为唯一真实来源，迁移由 Drizzle Kit 自动生成 |
| 迁移前自动备份       | 防止迁移失败导致数据丢失，支持手动回滚                                    |
| 级联触发器           | 数据库触发器保证删除一致性，避免孤立的子记录                              |
| Drizzle 操作符重导出 | 简化外部模块的导入路径，`@db` 一站式获取所有常用 API                      |

## 故障排查

| 现象                                 | 可能原因                          | 排查步骤                                                                     |
| ------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------- |
| `initDb()` 抛出 "database is locked" | 其他进程持有写锁                  | 检查是否有多个 crab 实例运行；增加 `SQLITE_BUSY_TIMEOUT_MS`                  |
| 迁移失败                             | Schema 定义与数据库实际结构不一致 | 删除 `~/.crab/crab.db` 重新初始化（测试环境）；检查 `migrations/` 目录完整性 |
| 查询返回空结果                       | 表名或字段名拼写错误              | 确认使用 `@db/schema` 导出的表对象，而非字符串                               |
| 备份文件堆积                         | 多次迁移失败触发恢复              | 手动删除 `~/.crab/crab.db.bak` 即可                                          |

## 迁移指南

### 从旧版本升级

旧版本的 `@db` 模块将所有文件放在根目录。重构后：

```typescript
// 旧版本
import { initDb, getDb, eq } from "@db";
import { sessions, messages } from "@db/schema";

// 新版本 — 导入路径不变！
// @db 和 @db/schema 的路径别名仍然有效
import { initDb, getDb, eq } from "@db";
import { sessions, messages } from "@db/schema";
```

所有外部消费者的导入路径**无需修改**，因为根目录 `index.ts` 和 `schema/index.ts` 提供了完整的 re-export。

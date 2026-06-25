/**
 * 数据库 Schema — Drizzle ORM 表结构定义
 *
 * 职责:
 *   - 定义所有数据库表结构(sessions, messages, checkpoints, permissions)
 *   - 提供类型安全的表定义供业务层使用
 *   - 统一管理数据表字段和约束
 *
 * 模块功能:
 *   - sessions: 会话表，存储 AI 对话会话元信息
 *   - messages: 消息表，存储会话中的消息内容
 *   - checkpoints: 检查点表，存储会话快照用于回溯
 *   - persistentPermissions: 持久化权限表，存储用户权限规则
 *   - approvals: 审批记录表，存储运行时审批决策
 *
 * 使用场景:
 *   - 初始化数据库时创建表结构
 *   - Drizzle ORM 查询操作的类型约束
 *   - 权限系统的持久化存储
 *
 * 边界:
 * 1. 仅定义 Schema，不包含业务逻辑
 * 2. 表之间无外键约束声明，通过级联触发器保证删除一致性
 * 3. 审计记录与权限数据统一存储于 crab.db
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 会话表 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // Ses_xxx
  title: text("title").notNull().default(""),
  status: text("status", { enum: ["active", "paused", "completed", "error"] })
    .notNull()
    .default("active"),
  model: text("model"),
  parentId: text("parent_id"), // 分叉来源
  projectDir: text("project_dir"),
  // Token/成本追踪
  tokensInput: integer("tokens_input").notNull().default(0),
  tokensOutput: integer("tokens_output").notNull().default(0),
  tokensReasoning: integer("tokens_reasoning").notNull().default(0),
  cost: integer("cost").notNull().default(0), // 单位:微美分(避免浮点精度问题)
  agentStateJson: text("agent_state_json"), // Agent 运行时状态快照(nullable，NULL = 无持久化状态)
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** 消息表 */
export const messages = sqliteTable("messages", {
  createdAt: integer("created_at").notNull(),
  id: text("id").primaryKey(), // Msg_xxx
  partsJson: text("parts_json").notNull(), // JSON 序列化的 MessagePart[]
  role: text("role", { enum: ["system", "user", "assistant", "tool"] }).notNull(),
  sessionId: text("session_id").notNull(),
});

/** 检查点表 */
export const checkpoints = sqliteTable("checkpoints", {
  createdAt: integer("created_at").notNull(),
  id: text("id").primaryKey(), // Chk_xxx
  label: text("label").notNull().default(""),
  messageIndex: integer("message_index").notNull(), // 检查点对应的消息位置
  sessionId: text("session_id").notNull(),
  snapshotJson: text("snapshot_json").notNull(), // JSON 序列化的快照,
});

/** 持久化权限表(阶段 7 新增，从审计新增项) */
export const persistentPermissions = sqliteTable("persistent_permissions", {
  action: text("action", { enum: ["allow", "deny"] })
    .notNull()
    .default("allow"),
  createdAt: integer("created_at").notNull(),
  id: integer("id").primaryKey({ autoIncrement: true }),
  pattern: text("pattern").notNull(), // * / git * / **/*.ts
  permission: text("permission").notNull(), // Bash / fs.write / mcp
  source: text("source", { enum: ["user", "default", "project"] })
    .notNull()
    .default("user"),
});

/** 审批记录表(运行时审批持久化，从 approval-store 迁移至统一数据库) */
export const approvals = sqliteTable("approvals", {
  decision: text("decision", { enum: ["allow", "deny"] }).notNull(),
  expiresAt: integer("expires_at"), // Null 表示永不过期
  id: text("id").primaryKey(), // Appr_xxx
  pattern: text("pattern").notNull(),
  permission: text("permission").notNull(),
  sessionId: text("session_id").notNull(),
  timestamp: integer("timestamp").notNull(),
});

/** 持久化事件表(Durable Events — 用于事件溯源、会话恢复、崩溃恢复) */
export const durableEvents = sqliteTable("durable_events", {
  id: text("id").primaryKey(), // Evt_xxx
  seq: integer("seq").notNull(), // 全局自增序列号(用于事件排序和增量回放)
  aggregateId: text("aggregate_id").notNull(), // 聚合根 ID(如 sessionId)
  version: integer("version").notNull(), // 聚合内版本号(从 0 开始)
  definition: text("definition").notNull(), // 事件类型(EventDefinition.type)
  dataJson: text("data_json").notNull(), // JSON 序列化的事件载荷
  createdAt: integer("created_at").notNull(), // 事件创建时间戳
});

/** 消息 Parts 表(P2-A4 — Part 粒度消息模型，独立存储每个 Part) */
export const parts = sqliteTable("parts", {
  id: text("id").primaryKey(), // Part_xxx
  sessionId: text("session_id").notNull(),
  messageId: text("message_id").notNull(),
  type: text("type", { enum: ["text", "tool", "reasoning"] }).notNull(), // Part 类型
  dataJson: text("data_json").notNull(), // JSON 序列化的 Part 数据
  createdAt: integer("created_at").notNull(),
});

/**
 * [Team 类型定义]
 *
 * 职责:
 *   - 定义 Team 协作模式的核心接口
 *   - 提供类型安全和结构约束
 *   - 统一 Team 相关数据结构
 *
 * 模块功能:
 *   - TeammateStatus:队友状态类型
 *   - Teammate:队友定义接口
 *   - TeamTaskStatus:任务状态类型
 *   - TeamTask:共享任务接口
 *   - TeamConfig:Team 配置接口
 *   - TeamExecutionResult:执行结果接口
 *   - TeamSnapshot:快照接口
 *   - DEFAULT_TEAM_CONFIG:默认配置常量
 *
 * 使用场景:
 *   - Team 模块类型定义
 *   - 接口契约约束
 *   - 数据结构设计
 *   - 类型安全保证
 *
 * 边界:
 *   1. 纯类型定义，无业务逻辑
 *   2. 状态类型为联合类型
 *   3. 可选字段需运行时检查
 *   4. 默认配置为常量对象
 *
 * 流程:
 *   1. 定义核心类型和接口
 *   2. 导出供其他模块使用
 *   3. 运行时配合类型守卫
 */
import type { AppConfigSchema } from "@/schema/config";

/** 队友状态 */
export type TeammateStatus = "pending" | "running" | "completed" | "failed";

/** 队友定义 */
export interface Teammate {
  /** 唯一 ID */
  id: string;
  /** 队友名称 */
  name: string;
  /** 角色描述(如 "前端开发"、"后端开发") */
  role: string;
  /** 关联的 Agent 名称(映射到 agentManager 注册的 Agent，不传则使用 role 字符串) */
  agentName?: string;
  /** 分配的任务描述 */
  task: string;
  /** 当前状态 */
  status: TeammateStatus;
  /** 独立 worktree 路径(Git worktree) */
  worktreePath?: string;
  /** 独立会话 ID */
  sessionId?: string;
  /** 创建时间戳 */
  startedAt?: number;
  /** 完成时间戳 */
  completedAt?: number;
  /** 执行结果摘要 */
  result?: string;
  /** 允许使用的工具列表 */
  allowedTools?: string[];
  /** 使用的模型 */
  model?: string;
  /** 继承自关联 Agent 的权限规则 */
  permissions?: AppConfigSchema["permissions"];
  /** 错误信息(status=failed 时有值) */
  error?: string;
}

/** 共享任务状态 */
export type TeamTaskStatus = "pending" | "in-progress" | "completed" | "failed";

/** 共享任务 */
export interface TeamTask {
  /** 唯一 ID */
  id: string;
  /** 任务标题(简短描述) */
  title: string;
  /** 任务描述(详细说明) */
  description?: string;
  /** 分配的队友 ID */
  assignee?: string;
  /** 分配的队友名称 */
  assigneeName?: string;
  /** 依赖的任务 ID 列表(必须全部完成才能开始) */
  dependencies?: string[];
  /** 任务状态 */
  status: TeamTaskStatus;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
  /** 完成时间戳 */
  completedAt?: number;
}

/** Team 配置 */
export interface TeamConfig {
  /** 最大队友数(默认 0，表示不限制) */
  maxTeammates: number;
  /** 是否自动批准队友的工具调用(默认 false) */
  autoApprove: boolean;
  /** 是否使用独立 Git worktree(默认 true) */
  useWorktree: boolean;
  /** Worktree 基础路径(默认 .crab/worktrees/) */
  worktreeBase?: string;
  /**
   * 死循环检测阈值:连续 N 次相同工具+参数触发中断，默认 5。
   * 必须为正整数，配置错误时回退到默认值。
   */
  doomLoopThreshold: number;
}

/** Team 执行结果 */
export interface TeamExecutionResult {
  /** 执行是否成功 */
  ok: boolean;
  /** 队友 ID */
  teammateId: string;
  /** 执行输出 */
  output?: string;
  /** 错误信息 */
  error?: string;
}

/** Team 快照(用于持久化/恢复) */
export interface TeamSnapshot {
  /** 快照 ID */
  id: string;
  /** 快照时间戳 */
  timestamp: number;
  /** 队友列表 */
  teammates: Teammate[];
  /** 共享任务列表 */
  tasks: TeamTask[];
  /** Team 配置 */
  config: TeamConfig;
}

/** 默认 Team 配置 */
export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  autoApprove: false,
  doomLoopThreshold: 5,
  maxTeammates: 0,
  useWorktree: true,
  worktreeBase: ".crab/worktrees",
};

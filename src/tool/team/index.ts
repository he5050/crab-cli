/**
 * Team 工具集 — 多代理协作(拆分为 16 个独立工具)。
 *
 * 职责:
 *   - 创建和管理队友代理
 *   - 队友间消息传递
 *   - 任务分配和管理
 *   - 工作合并和冲突解决
 *   - 计划审批
 *
 * 模块功能:
 *   - teamSpawnTool: 创建队友
 *   - teamMessageTool: 发送消息
 *   - teamBroadcastTool: 广播消息
 *   - teamShutdownTool: 关闭队友
 *   - teamWaitTool: 等待队友完成
 *   - teamListTool: 列出队友
 *   - teamStatusTool: 查询队友状态
 *   - teamCreateTaskTool: 创建任务
 *   - teamUpdateTaskTool: 更新任务
 *   - teamListTasksTool: 列出任务
 *   - teamMergeWorkTool: 合并指定队友工作
 *   - teamMergeAllTool: 合并所有队友工作
 *   - teamResolveConflictsTool: 解决合并冲突
 *   - teamAbortMergeTool: 中止合并
 *   - teamApprovePlanTool: 审批计划
 *   - teamCleanupTool: 清理团队
 *
 * 边界:
 *   1. 权限细分: team.spawn/team.message/team.broadcast/team.shutdown/team.wait/team.list/team.status
 *      /team.task.create/team.task.update/team.task.list/team.merge/team.approve/team.cleanup
 *      (旧单体 teamTool 保持 permission:"team" 向后兼容)
 *   2. 通过 teamExecutor 执行操作
 *   3. 队友有独立的工具白名单
 *   4. 支持合并策略选择
 */

// ── Handler re-export ──────────────────────────────────────────
export {
  handleAbortMerge,
  handleApprovePlan,
  handleBroadcast,
  handleCleanupTeam,
  handleCreateTask,
  handleList,
  handleListTasks,
  handleMergeAll,
  handleMergeWork,
  handleMessage,
  handleResolveConflicts,
  handleShutdown,
  handleSpawn,
  handleStatus,
  handleUpdateTask,
  handleWaitForTeammates,
  resetTeamExecutorPort,
  safeParseJson,
  setTeamExecutorPort,
} from "./teamHandlers";

// ── Tool re-export ────────────────────────────────────────────
export {
  teamAbortMergeTool,
  teamApprovePlanTool,
  teamBroadcastTool,
  teamCleanupTool,
  teamCreateTaskTool,
  teamListTasksTool,
  teamListTool,
  teamMergeAllTool,
  teamMergeWorkTool,
  teamMessageTool,
  teamResolveConflictsTool,
  teamShutdownTool,
  teamSpawnTool,
  teamStatusTool,
  teamTool,
  teamUpdateTaskTool,
  teamWaitTool,
  teamTools,
} from "./teamTools";

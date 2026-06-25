/**
 * Team 工具定义 — 16 个独立工具 + 向后兼容的统一 teamTool。
 */
import { z } from "zod";
import { type ToolDefinition, defineTool } from "@/tool/types";
import {
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
  teamSchemas,
} from "./teamHandlers";

// ─── Tool Definitions ────────────────────────────────────────

/** 创建队友代理 */
export const teamSpawnTool = defineTool({
  description:
    "创建队友代理。参数: name(队友名称), role(角色描述), task(任务描述), prompt(执行提示词), model(模型), allowedTools(工具白名单), requirePlanApproval(是否需要计划审批)",
  execute: async (params) => handleSpawn(params),
  name: "team-spawn",
  parameters: teamSchemas.spawn,
  permission: "team.spawn",
  builtin: true,
});

/** 向指定队友发送消息 */
export const teamMessageTool = defineTool({
  description: "向指定队友发送消息。参数: teammateId(队友ID), message(消息内容)",
  execute: async (params) => handleMessage(params),
  name: "team-message",
  parameters: teamSchemas.message,
  permission: "team.message",
  builtin: true,
});

/** 广播消息给所有队友 */
export const teamBroadcastTool = defineTool({
  description: "广播消息给所有队友。参数: message(消息内容)",
  execute: async (params) => handleBroadcast(params),
  name: "team-broadcast",
  parameters: teamSchemas.broadcast,
  permission: "team.broadcast",
  builtin: true,
});

/** 关闭指定队友 */
export const teamShutdownTool = defineTool({
  description: "关闭指定队友。参数: teammateId(队友ID)",
  execute: async (params) => handleShutdown(params),
  name: "team-shutdown",
  parameters: teamSchemas.shutdown,
  permission: "team.shutdown",
  builtin: true,
});

/** 等待所有队友完成工作 */
export const teamWaitTool = defineTool({
  description: "等待所有队友完成工作并进入 standby 状态",
  execute: async () => handleWaitForTeammates(),
  name: "team-wait",
  parameters: z.object({}),
  permission: "team.wait",
  builtin: true,
});

/** 列出所有队友及其状态 */
export const teamListTool = defineTool({
  description: "列出所有队友及其状态",
  execute: async () => handleList(),
  name: "team-list",
  parameters: z.object({}),
  permission: "team.list",
  builtin: true,
});

/** 查询指定队友的详细状态 */
export const teamStatusTool = defineTool({
  description: "查询指定队友的详细状态。参数: teammateId(队友ID)",
  execute: async (params) => handleStatus(params),
  name: "team-status",
  parameters: teamSchemas.status,
  permission: "team.status",
  builtin: true,
});

/** 创建共享任务 */
export const teamCreateTaskTool = defineTool({
  description:
    "创建共享任务。参数: task(任务描述), name(任务标题), teammateId(可选分配给指定队友), dependencies(依赖任务ID列表)",
  execute: async (params) => handleCreateTask(params),
  name: "team-create-task",
  parameters: teamSchemas.createTask,
  permission: "team.task.create",
  builtin: true,
});

/** 更新任务状态 */
export const teamUpdateTaskTool = defineTool({
  description:
    "更新任务状态。参数: teammateId(队友ID), task(任务描述,可选更新), taskStatus(任务状态: pending/in_progress/completed/failed)",
  execute: async (params) => handleUpdateTask(params),
  name: "team-update-task",
  parameters: teamSchemas.updateTask,
  permission: "team.task.update",
  builtin: true,
});

/** 查看所有共享任务 */
export const teamListTasksTool = defineTool({
  description: "查看所有共享任务",
  execute: async () => handleListTasks(),
  name: "team-list-tasks",
  parameters: z.object({}),
  permission: "team.task.list",
  builtin: true,
});

/** 合并指定队友的分支 */
export const teamMergeWorkTool = defineTool({
  description: "合并指定队友的分支。参数: teammateId(队友ID), strategy(合并策略: manual/theirs/ours/auto)",
  execute: async (params) => handleMergeWork(params),
  name: "team-merge-work",
  parameters: teamSchemas.mergeWork,
  permission: "team.merge",
  builtin: true,
});

/** 合并所有队友的分支 */
export const teamMergeAllTool = defineTool({
  description: "合并所有队友的分支。参数: strategy(合并策略: manual/theirs/ours/auto)",
  execute: async (params) => handleMergeAll(params),
  name: "team-merge-all",
  parameters: teamSchemas.mergeAll,
  permission: "team.merge",
  builtin: true,
});

/** 解决合并冲突后完成合并 */
export const teamResolveConflictsTool = defineTool({
  description: "解决合并冲突后完成合并",
  execute: async () => handleResolveConflicts(),
  name: "team-resolve-conflicts",
  parameters: z.object({}),
  permission: "team.merge",
  builtin: true,
});

/** 中止当前合并操作 */
export const teamAbortMergeTool = defineTool({
  description: "中止当前合并操作",
  execute: async () => handleAbortMerge(),
  name: "team-abort-merge",
  parameters: z.object({}),
  permission: "team.merge",
  builtin: true,
});

/** 审批或拒绝队友的计划 */
export const teamApprovePlanTool = defineTool({
  description: "审批或拒绝队友的计划。参数: teammateId(队友ID), approved(是否批准), feedback(审批反馈)",
  execute: async (params) => handleApprovePlan(params),
  name: "team-approve-plan",
  parameters: teamSchemas.approvePlan,
  permission: "team.approve",
  builtin: true,
});

/** 清理所有 worktree 并解散团队 */
export const teamCleanupTool = defineTool({
  description: "清理所有 worktree 并解散团队",
  execute: async () => handleCleanupTeam(),
  name: "team-cleanup",
  parameters: z.object({}),
  permission: "team.cleanup",
  builtin: true,
});

/** 向后兼容:导出旧的单体 teamTool(已废弃) */
/** @deprecated 请使用 team-spawn、team-message 等独立工具 */
export const teamTool = defineTool({
  description: "多代理协作工具(已废弃，请使用 team-spawn、team-message 等独立工具)",
  execute: async (params) => {
    const args = params as Record<string, unknown>;
    try {
      switch (args.action) {
        case "spawn": {
          return await handleSpawn(args as Parameters<typeof handleSpawn>[0]);
        }
        case "message": {
          return await handleMessage(args as Parameters<typeof handleMessage>[0]);
        }
        case "broadcast": {
          return await handleBroadcast(args as Parameters<typeof handleBroadcast>[0]);
        }
        case "shutdown": {
          return await handleShutdown(args as Parameters<typeof handleShutdown>[0]);
        }
        case "wait_for_teammates": {
          return handleWaitForTeammates();
        }
        case "list": {
          return handleList();
        }
        case "status": {
          return handleStatus(args as Parameters<typeof handleStatus>[0]);
        }
        case "update_task": {
          return handleUpdateTask(args as Parameters<typeof handleUpdateTask>[0]);
        }
        case "create_task": {
          return handleCreateTask(args as Parameters<typeof handleCreateTask>[0]);
        }
        case "list_tasks": {
          return handleListTasks();
        }
        case "merge_work": {
          return await handleMergeWork(args as Parameters<typeof handleMergeWork>[0]);
        }
        case "merge_all": {
          return await handleMergeAll(args as Parameters<typeof handleMergeAll>[0]);
        }
        case "resolve_conflicts": {
          return handleResolveConflicts();
        }
        case "abort_merge": {
          return handleAbortMerge();
        }
        case "approve_plan": {
          return handleApprovePlan(args as Parameters<typeof handleApprovePlan>[0]);
        }
        case "cleanup_team": {
          return handleCleanupTeam();
        }
        default: {
          return { error: `未知操作: ${args.action}`, success: false };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { error: msg, success: false };
    }
  },
  name: "team",
  parameters: z.object({
    action: z
      .enum([
        "spawn",
        "message",
        "broadcast",
        "shutdown",
        "wait_for_teammates",
        "list",
        "status",
        "update_task",
        "create_task",
        "list_tasks",
        "merge_work",
        "merge_all",
        "resolve_conflicts",
        "abort_merge",
        "approve_plan",
        "cleanup_team",
      ])
      .describe("操作类型"),
    agentName: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
    approved: z.boolean().optional(),
    dependencies: z.array(z.string()).optional(),
    feedback: z.string().optional(),
    message: z.string().optional(),
    model: z.string().optional(),
    name: z.string().optional(),
    prompt: z.string().optional(),
    requirePlanApproval: z.boolean().optional(),
    role: z.string().optional(),
    strategy: z.enum(["manual", "theirs", "ours", "auto"]).optional(),
    task: z.string().optional(),
    taskStatus: z.enum(["pending", "in_progress", "completed", "failed"]).optional(),
    teammateId: z.string().optional(),
  }),
  permission: "team",
  builtin: true,
});

/** 16 个独立工具数组，供 toolRegistry 批量注册 */
export const teamTools: ToolDefinition<any>[] = [
  teamSpawnTool,
  teamMessageTool,
  teamBroadcastTool,
  teamShutdownTool,
  teamWaitTool,
  teamListTool,
  teamStatusTool,
  teamCreateTaskTool,
  teamUpdateTaskTool,
  teamListTasksTool,
  teamMergeWorkTool,
  teamMergeAllTool,
  teamResolveConflictsTool,
  teamAbortMergeTool,
  teamApprovePlanTool,
  teamCleanupTool,
];

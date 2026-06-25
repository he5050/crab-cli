/**
 * Team Lead 行为模块 — Lead 视角下的任务/团队管理动作。
 *
 * 职责:
 *   - 创建/更新/关闭团队任务
 *   - 切换活跃团队并持久化
 *   - 维护 Lead 视角的运行时状态
 *
 * 模块功能:
 *   - createTeamTask: 创建团队任务
 *   - updateTeamTaskStatus: 更新任务状态
 *   - getActiveTeamRuntimeState: 获取 Lead 视角运行时状态
 *   - TeamLeadActionDeps: 依赖注入
 */
import { getActiveTeam } from "../persist/teamPersist";
import type { TeamTaskList } from "../core/teamTaskList";
import type { TeamTracker } from "../core/teamTracker";
import type { TeamExecutionResult, TeamTaskStatus } from "../types";

export interface TeamLeadActionDeps {
  tracker: TeamTracker;
  taskList: TeamTaskList;
  projectDir?: string;
}

export interface CreateTeamTaskOptions {
  title?: string;
  dependencies?: string[];
  assigneeName?: string;
}

export interface TeamRuntimeState {
  activeTeamName: string | null;
  persistedActiveTeamName: string | null;
  trackedTeammates: number;
  taskCount: number;
}

export function messageTeamMate(
  deps: Pick<TeamLeadActionDeps, "tracker">,
  teammateId: string,
  message: string,
): TeamExecutionResult {
  const mate = deps.tracker.get(teammateId);
  if (!mate) {
    return { error: `队友不存在: ${teammateId}`, ok: false, teammateId };
  }

  const sent = deps.tracker.sendMessageToTeammate("lead", teammateId, message);
  if (!sent) {
    return { error: "消息投递失败", ok: false, teammateId };
  }

  return {
    ok: true,
    output: `消息已发送给 ${mate.name} (${teammateId})`,
    teammateId,
  };
}

export function broadcastTeamMessage(deps: Pick<TeamLeadActionDeps, "tracker">, message: string): TeamExecutionResult {
  const count = deps.tracker.broadcastToTeammates("lead", message);
  return {
    ok: true,
    output: `消息已广播给 ${count} 个队友`,
    teammateId: "all",
  };
}

export async function waitForTeamStandby(
  deps: Pick<TeamLeadActionDeps, "tracker">,
  timeoutMs?: number,
  abortSignal?: AbortSignal,
): Promise<TeamExecutionResult> {
  const allDone = await deps.tracker.waitForAllTeammates(timeoutMs, abortSignal);
  const messages = deps.tracker.dequeueLeadMessages();
  const results = deps.tracker.drainResults();

  return {
    ok: allDone,
    output: JSON.stringify({
      allStandby: allDone,
      leadMessages: messages.map((m) => ({ content: m.content, from: m.fromName })),
      results: results.map((r) => ({ name: r.name, result: r.result, success: r.success })),
    }),
    teammateId: "all",
  };
}

export function approveTeamPlan(
  deps: Pick<TeamLeadActionDeps, "tracker">,
  teammateId: string,
  approved: boolean,
  feedback?: string,
): TeamExecutionResult {
  const mate = deps.tracker.get(teammateId);
  if (!mate) {
    return { error: `队友不存在: ${teammateId}`, ok: false, teammateId };
  }

  const ok = deps.tracker.resolvePlanApproval(teammateId, approved, feedback);
  return {
    ok,
    output: ok ? `计划已${approved ? "批准" : "拒绝"}: ${mate.name}` : "没有待审批的计划",
    teammateId,
  };
}

export function createTeamTask(
  deps: Pick<TeamLeadActionDeps, "taskList">,
  description: string,
  assigneeId?: string,
  options?: CreateTeamTaskOptions,
): TeamExecutionResult {
  const task = deps.taskList.create(description, assigneeId, options);
  return {
    ok: true,
    output: JSON.stringify({
      assignee: assigneeId,
      dependencies: task.dependencies,
      description,
      status: task.status,
      taskId: task.id,
      title: task.title,
    }),
    teammateId: "",
  };
}

export function updateTeamTask(
  deps: Pick<TeamLeadActionDeps, "tracker" | "taskList">,
  teammateId: string,
  taskDescription?: string,
  taskStatus?: string,
): TeamExecutionResult {
  const mate = deps.tracker.get(teammateId);
  if (!mate) {
    return { error: `队友不存在: ${teammateId}`, ok: false, teammateId };
  }

  const mateTasks = deps.taskList.listByAssignee(teammateId);
  if (mateTasks.length > 0 && taskStatus) {
    const validStatuses = ["pending", "in-progress", "completed", "failed"];
    if (validStatuses.includes(taskStatus)) {
      deps.taskList.updateStatus(mateTasks[0]!.id, taskStatus as TeamTaskStatus);
    }
  }

  if (taskStatus === "completed") {
    deps.tracker.updateStatus(teammateId, "completed", { result: taskDescription ?? "任务完成" });
  } else if (taskStatus === "failed") {
    deps.tracker.updateStatus(teammateId, "failed", { error: taskDescription ?? "任务失败" });
  } else if (taskStatus === "in_progress" || taskStatus === "in-progress") {
    deps.tracker.updateStatus(teammateId, "running");
  }

  return {
    ok: true,
    output: `队友 ${mate.name} 任务已更新: ${taskStatus ?? "描述更新"}`,
    teammateId,
  };
}

export function getTeamRuntimeState(deps: TeamLeadActionDeps): TeamRuntimeState {
  return {
    activeTeamName: deps.tracker.getActiveTeamName() ?? deps.taskList.getActiveTeamName(),
    persistedActiveTeamName: getActiveTeam(deps.projectDir)?.name ?? null,
    taskCount: deps.taskList.size,
    trackedTeammates: deps.tracker.size,
  };
}

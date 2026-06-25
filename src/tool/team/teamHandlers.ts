/**
 * Team 处理函数 — 每个操作一个 handler。
 */
import { z } from "zod";
import { createTeamExecutorAdapter } from "./teamExecutorAdapter";
import type { TeamExecutorPort } from "./teamExecutorPort";

/**
 * 安全解析 JSON，过滤 __proto__ 等危险键，防止原型污染。
 * 解析失败时返回空对象而非抛出异常。
 */
/** safeParseJson 的实现 */
export function safeParseJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      // 过滤危险键
      const safe: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          continue;
        }
        safe[key] = value;
      }
      return safe;
    }
    return {};
  } catch {
    return {};
  }
}

// ─── 参数 Schema ──────────────────────────────────────────────

const spawnParams = z.object({
  agentName: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  message: z.string().optional(),
  model: z.string().optional(),
  name: z.string(),
  prompt: z.string().optional(),
  requirePlanApproval: z.boolean().optional(),
  role: z.string().optional(),
  task: z.string().optional(),
  teammateId: z.string().optional(),
});

const teammateMessageParams = z.object({
  message: z.string(),
  teammateId: z.string(),
});

const broadcastParams = z.object({
  message: z.string(),
});

const shutdownParams = z.object({
  teammateId: z.string(),
});

const statusParams = z.object({
  teammateId: z.string(),
});

const updateTaskParams = z.object({
  task: z.string().optional(),
  taskStatus: z.enum(["pending", "in_progress", "completed", "failed"]).optional(),
  teammateId: z.string(),
});

const createTaskParams = z.object({
  dependencies: z.array(z.string()).optional(),
  name: z.string().optional(),
  task: z.string(),
  teammateId: z.string().optional(),
});

const mergeParams = z.object({
  strategy: z.enum(["manual", "theirs", "ours", "auto", "ours-prefer"]).optional(),
  teammateId: z.string(),
});

const mergeAllParams = z.object({
  strategy: z.enum(["manual", "theirs", "ours", "auto", "ours-prefer"]).optional(),
});

const approvePlanParams = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  teammateId: z.string(),
});

// ─── 导出 Schema（供 teamTools.ts 复用）────────────────────────

/** teamSchemas */
export const teamSchemas = {
  approvePlan: approvePlanParams,
  broadcast: broadcastParams,
  createTask: createTaskParams,
  mergeAll: mergeAllParams,
  mergeWork: mergeParams,
  message: teammateMessageParams,
  shutdown: shutdownParams,
  spawn: spawnParams,
  status: statusParams,
  updateTask: updateTaskParams,
} as const;

// ─── 依赖注入：可通过测试替换为 mock ────────────────────────────────

let teamExecutorPort: TeamExecutorPort = createTeamExecutorAdapter();

/** 设置 TeamExecutorPort（测试用） */
export function setTeamExecutorPort(port: TeamExecutorPort): void {
  teamExecutorPort = port;
}

/** 重置为默认适配器（测试清理用） */
export function resetTeamExecutorPort(): void {
  teamExecutorPort = createTeamExecutorAdapter();
}

// ─── Handlers ────────────────────────────────────────────────

/** 创建并启动新队友 @param p - 队友配置参数 @returns 创建结果 */
export async function handleSpawn(p: z.infer<typeof spawnParams>): Promise<Record<string, unknown>> {
  const name = p.name;
  if (!name) {
    return { error: "创建队友需要提供 name", success: false };
  }

  const result = await teamExecutorPort.spawnMate(name, p.role ?? name, p.task ?? `由 ${name} 执行`, {
    agentName: p.agentName,
    allowedTools: p.allowedTools,
    model: p.model,
  });

  if (!result.ok) {
    return { error: result.error, success: false };
  }

  const parsed: Record<string, unknown> = safeParseJson(result.output ?? "{}");

  const effectivePrompt =
    p.prompt ??
    `你被分配了以下任务:${p.task ?? `由 ${name} 执行`}\n\n请开始执行你的任务。完成后调用 wait_for_messages 并提供工作摘要。`;

  teamExecutorPort.startTeammate(parsed.teammateId as string, effectivePrompt, {
    requirePlanApproval: p.requirePlanApproval,
  });

  return { success: true, ...parsed };
}

/** 向指定队友发送消息 */
export async function handleMessage(p: z.infer<typeof teammateMessageParams>): Promise<Record<string, unknown>> {
  const { teammateId, message } = p;
  if (!teammateId || !message) {
    return { error: "需要提供 teammateId 和 message", success: false };
  }

  const result = await teamExecutorPort.messageMate(teammateId, message);
  if (!result.ok) {
    return { error: result.error, success: false };
  }
  return { action: "message", delivered: true, success: true, teammateId };
}

/** 向所有队友广播消息 */
export async function handleBroadcast(p: z.infer<typeof broadcastParams>): Promise<Record<string, unknown>> {
  const { message } = p;
  if (!message) {
    return { error: "需要提供 message", success: false };
  }

  const result = teamExecutorPort.broadcastMessage(message);
  return { action: "broadcast", output: result.output, success: result.ok };
}

/** 关闭指定队友 */
export async function handleShutdown(p: z.infer<typeof shutdownParams>): Promise<Record<string, unknown>> {
  const { teammateId } = p;
  if (!teammateId) {
    return { error: "需要提供 teammateId", success: false };
  }

  const result = await teamExecutorPort.shutdownTeammate(teammateId);
  return { action: "shutdown", error: result.error, output: result.output, success: result.ok };
}

/** 等待所有队友完成当前任务 */
export async function handleWaitForTeammates(): Promise<Record<string, unknown>> {
  const result = await teamExecutorPort.waitForTeammates();
  return {
    action: "wait_for_teammates",
    success: result.ok,
    ...(result.output ? safeParseJson(result.output) : {}),
  };
}

/** 列出所有队友及其状态 */
export function handleList(): Record<string, unknown> {
  const tracker = teamExecutorPort.getTracker();
  const teammates = teamExecutorPort.listTeammates();
  return {
    action: "list",
    success: true,
    teammates: teammates.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      standby: tracker.isOnStandby(m.id),
      status: m.status,
      task: m.task,
      worktreePath: m.worktreePath,
    })),
    total: teammates.length,
  };
}

/** 查询指定队友的详细状态 */
export function handleStatus(p: z.infer<typeof statusParams>): Record<string, unknown> {
  const { teammateId } = p;
  if (!teammateId) {
    return { error: "需要提供 teammateId", success: false };
  }

  const mate = teamExecutorPort.getTeammate(teammateId);
  if (!mate) {
    return { error: `队友不存在: ${teammateId}`, success: false };
  }
  const tracker = teamExecutorPort.getTracker();

  return {
    action: "status",
    error: mate.error,
    name: mate.name,
    result: mate.result,
    role: mate.role,
    standby: tracker.isOnStandby(teammateId),
    status: mate.status,
    success: true,
    task: mate.task,
    teammateId,
    worktreePath: mate.worktreePath,
  };
}

/** 更新队友的任务或任务状态 */
export function handleUpdateTask(p: z.infer<typeof updateTaskParams>): Record<string, unknown> {
  const { teammateId, task, taskStatus } = p;
  if (!teammateId) {
    return { error: "需要提供 teammateId", success: false };
  }

  const result = teamExecutorPort.updateTask(teammateId, task, taskStatus);
  return { error: result.error, output: result.output, success: result.ok };
}

/** 创建共享任务 */
export function handleCreateTask(p: z.infer<typeof createTaskParams>): Record<string, unknown> {
  const { task: description, teammateId, dependencies, name: title } = p;
  if (!description) {
    return { error: "需要提供 task(任务描述)", success: false };
  }

  const result = teamExecutorPort.createTask(description, teammateId, {
    dependencies,
    title,
  });
  return { action: "create_task", success: result.ok, ...(result.output ? JSON.parse(result.output) : {}) };
}

/** 列出所有共享任务 */
export function handleListTasks(): Record<string, unknown> {
  const tasks = teamExecutorPort.getTaskList().list();
  return {
    action: "list_tasks",
    success: true,
    tasks: tasks.map((t) => ({
      assignee: t.assigneeName ?? t.assignee,
      dependencies: t.dependencies,
      description: t.description,
      id: t.id,
      status: t.status,
      title: t.title,
    })),
    total: tasks.length,
  };
}

/** 合并指定队友的工作成果 */
export async function handleMergeWork(p: z.infer<typeof mergeParams>): Promise<Record<string, unknown>> {
  const { teammateId } = p;
  if (!teammateId) {
    return { error: "需要提供 teammateId", success: false };
  }

  const result = await teamExecutorPort.mergeTeammateWork(teammateId, p.strategy ?? "manual");
  return {
    success: result.ok,
    action: "merge_work",
    teammateId,
    ...(result.output ? safeParseJson(result.output) : {}),
    error: result.error,
  };
}

/** 合并所有队友的工作成果 */
export async function handleMergeAll(p: z.infer<typeof mergeAllParams>): Promise<Record<string, unknown>> {
  const result = await teamExecutorPort.mergeAllWork(p.strategy ?? "manual");
  return {
    success: result.ok,
    action: "merge_all",
    ...(result.output ? safeParseJson(result.output) : {}),
    error: result.error,
  };
}

/** 解决合并冲突 */
export async function handleResolveConflicts(): Promise<Record<string, unknown>> {
  const result = await teamExecutorPort.resolveMergeConflicts();
  return { action: "resolve_conflicts", output: result.output, success: result.ok };
}

/** 中止进行中的合并操作 */
export async function handleAbortMerge(): Promise<Record<string, unknown>> {
  const result = await teamExecutorPort.abortMerge();
  return { action: "abort_merge", output: result.output, success: result.ok };
}

/** 审批队友的计划（通过或拒绝） */
export function handleApprovePlan(p: z.infer<typeof approvePlanParams>): Record<string, unknown> {
  const { teammateId, approved, feedback } = p;
  if (!teammateId || approved === undefined) {
    return { error: "需要提供 teammateId 和 approved", success: false };
  }

  const result = teamExecutorPort.approvePlan(teammateId, approved, feedback);
  return { action: "approve_plan", output: result.output, success: result.ok };
}

/** 清理所有队友资源（进程、worktree 等） */
export async function handleCleanupTeam(): Promise<Record<string, unknown>> {
  const result = await teamExecutorPort.cleanupTeam();
  return { action: "cleanup_team", error: result.error, output: result.output, success: result.ok };
}

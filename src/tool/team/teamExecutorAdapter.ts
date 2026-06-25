/**
 * Team 工具执行器 — Agent/Team 适配器
 *
 * 职责:
 *   - 实现 TeamExecutorPort 接口
 *   - 将 tool 层调用委托给 @/agent/team 的 TeamExecutor
 *   - 隔离 agent/team 内部类型，tool 层只依赖 Port 接口
 */

import type {
  TeamExecutorPort,
  TeammateInfo,
  TeamTaskInfo,
  TeamTrackerPort,
  TeamTaskListPort,
} from "./teamExecutorPort";
import { teamExecutor } from "@/agent/team";

// ─── 类型转换函数 ──────────────────────────────────────────────────

function toTeammateInfo(mate: unknown): TeammateInfo {
  if (typeof mate !== "object" || mate === null) {
    return { id: "", name: "", role: "", status: "", task: "" };
  }
  const obj: Record<string, unknown> = mate as Record<string, unknown>;
  return {
    id: String(obj.id ?? ""),
    name: String(obj.name ?? ""),
    role: String(obj.role ?? ""),
    status: String(obj.status ?? ""),
    task: String(obj.task ?? ""),
    worktreePath: typeof obj.worktreePath === "string" ? obj.worktreePath : undefined,
    error: typeof obj.error === "string" ? obj.error : undefined,
    result: typeof obj.result === "string" ? obj.result : undefined,
  };
}

function toTeamTaskInfo(task: unknown): TeamTaskInfo {
  if (typeof task !== "object" || task === null) {
    return { id: "", description: "", status: "", dependencies: [] };
  }
  const obj: Record<string, unknown> = task as Record<string, unknown>;
  const deps = obj.dependencies;
  return {
    id: String(obj.id ?? ""),
    description: String(obj.description ?? ""),
    status: String(obj.status ?? ""),
    assignee: typeof obj.assignee === "string" ? obj.assignee : undefined,
    assigneeName: typeof obj.assigneeName === "string" ? obj.assigneeName : undefined,
    dependencies: Array.isArray(deps) && deps.every((d): d is string => typeof d === "string") ? deps : [],
    title: typeof obj.title === "string" ? obj.title : undefined,
  };
}

// ─── 子端口适配 ────────────────────────────────────────────────────

class AdapterTracker implements TeamTrackerPort {
  isOnStandby(teammateId: string): boolean {
    return teamExecutor.getTracker().isOnStandby(teammateId);
  }
}

class AdapterTaskList implements TeamTaskListPort {
  list(): TeamTaskInfo[] {
    return teamExecutor.getTaskList().list().map(toTeamTaskInfo);
  }
}

// ─── 主适配器 ──────────────────────────────────────────────────────

/** 创建团队执行器适配器，将 teamExecutor 适配为 TeamExecutorPort 接口 */
export function createTeamExecutorAdapter(): TeamExecutorPort {
  return {
    spawnMate(
      name: string,
      role: string,
      task: string,
      options?: { agentName?: string; allowedTools?: string[]; model?: string },
    ): Promise<{ ok: boolean; output: string; error?: string }> {
      return teamExecutor
        .spawnMate(name, role, task, options)
        .then((r) => ({ ok: r.ok, output: r.output ?? "", error: r.error }));
    },

    startTeammate(
      teammateId: string,
      prompt: string,
      options?: { requirePlanApproval?: boolean },
    ): { ok: boolean; output?: string; error?: string } {
      return teamExecutor.startTeammate(teammateId, prompt, options);
    },

    messageMate(teammateId: string, message: string): Promise<{ ok: boolean; output?: string; error?: string }> {
      return teamExecutor.messageMate(teammateId, message).then((r) => ({ ...r }));
    },

    broadcastMessage(message: string): { ok: boolean; output?: string; error?: string } {
      return teamExecutor.broadcastMessage(message);
    },

    shutdownTeammate(teammateId: string): Promise<{ ok: boolean; output?: string; error?: string }> {
      return teamExecutor.shutdownTeammate(teammateId).then((r) => ({ ...r }));
    },

    waitForTeammates(
      timeoutMs?: number,
      abortSignal?: AbortSignal | undefined,
    ): Promise<{ ok: boolean; output?: string; error?: string }> {
      return teamExecutor.waitForTeammates(timeoutMs, abortSignal).then((r) => ({ ...r }));
    },

    cleanupTeam(): Promise<{ ok: boolean; output?: string; error?: string }> {
      return teamExecutor.cleanupTeam().then((r) => ({ ...r }));
    },

    getTracker(): TeamTrackerPort {
      return new AdapterTracker();
    },

    listTeammates(): TeammateInfo[] {
      return teamExecutor.listTeammates().map(toTeammateInfo);
    },

    getTeammate(teammateId: string): TeammateInfo | undefined {
      const mate = teamExecutor.getTeammate(teammateId);
      if (!mate) return undefined;
      return toTeammateInfo(mate as unknown);
    },

    createTask(
      description: string,
      teammateId?: string,
      options?: { dependencies?: string[]; title?: string },
    ): { ok: boolean; output: string; error?: string } {
      const r = teamExecutor.createTask(description, teammateId, options);
      return { ok: r.ok, output: r.output ?? "", error: r.error };
    },

    updateTask(
      teammateId: string,
      task?: string,
      taskStatus?: string,
    ): { ok: boolean; output?: string; error?: string } {
      return teamExecutor.updateTask(teammateId, task, taskStatus);
    },

    getTaskList(): TeamTaskListPort {
      return new AdapterTaskList();
    },

    mergeTeammateWork(
      teammateId: string,
      strategy: "manual" | "theirs" | "ours" | "auto" | "ours-prefer",
    ): Promise<{ ok: boolean; output?: string; error?: string }> {
      return teamExecutor.mergeTeammateWork(teammateId, strategy);
    },

    mergeAllWork(strategy: "manual" | "theirs" | "ours" | "auto" | "ours-prefer"): Promise<{
      ok: boolean;
      output?: string;
      error?: string;
    }> {
      return teamExecutor.mergeAllWork(strategy);
    },

    resolveMergeConflicts(): Promise<{ ok: boolean; output?: string; error?: string }> {
      return teamExecutor.resolveMergeConflicts().then((r) => ({ ...r }));
    },

    abortMerge(): Promise<{ ok: boolean; output?: string; error?: string }> {
      return teamExecutor.abortMerge().then((r) => ({ ...r }));
    },

    approvePlan(
      teammateId: string,
      approved: boolean,
      feedback?: string,
    ): { ok: boolean; output?: string; error?: string } {
      return teamExecutor.approvePlan(teammateId, approved, feedback);
    },
  };
}

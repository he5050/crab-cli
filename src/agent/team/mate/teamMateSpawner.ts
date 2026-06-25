/**
 * Team 队友生成模块 — 创建队友实例并初始化 worktree/跟踪器。
 *
 * 职责:
 *   - 创建 Teammate 并分配 worktree
 *   - 解析队友 Agent 策略
 *   - 广播队友创建事件到全局总线
 *
 * 模块功能:
 *   - spawnTeamMate: 生成单个队友
 *   - SpawnTeamMateOptions: 生成参数
 *   - SpawnTeamMateDeps: 依赖注入
 */
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";
import type { TeamTaskList } from "../core/teamTaskList";
import type { TeamTracker } from "../core/teamTracker";
import { createWorktree } from "../merge/teamWorktree";
import type { TeamConfig, TeamExecutionResult, Teammate } from "../types";
import { resolveTeammateAgentPolicy } from "./teamAgentPolicy";

const log = createLogger("team:spawner");

export interface SpawnTeamMateOptions {
  allowedTools?: string[];
  model?: string;
  agentName?: string;
}

export interface SpawnTeamMateDeps {
  tracker: TeamTracker;
  taskList: TeamTaskList;
  config: TeamConfig;
  projectDir?: string;
  ensureActiveTeamContext: (createIfMissing?: boolean) => string | null;
  autoSaveState: () => void;
}

export async function spawnTeamMate(
  deps: SpawnTeamMateDeps,
  name: string,
  role: string,
  task: string,
  options?: SpawnTeamMateOptions,
  eventBus: EventBus = globalBus,
): Promise<TeamExecutionResult> {
  deps.ensureActiveTeamContext(true);

  if (deps.config.maxTeammates > 0 && deps.tracker.size >= deps.config.maxTeammates) {
    return {
      error: `已达到最大队友数限制 (${deps.config.maxTeammates})`,
      ok: false,
      teammateId: "",
    };
  }

  const id = createId("mate");
  const policy = resolveTeammateAgentPolicy(options);
  if ("error" in policy) {
    return {
      error: policy.error,
      ok: false,
      teammateId: "",
    };
  }

  let worktreePath: string | undefined;
  if (deps.config.useWorktree && deps.projectDir) {
    try {
      worktreePath = await createWorktree(id, deps.config.worktreeBase ?? ".crab/worktrees", deps.projectDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Worktree 创建失败: ${message}`);
      return {
        error: `Worktree 创建失败，已取消队友创建: ${message}`,
        ok: false,
        teammateId: "",
      };
    }
  }

  const teammate: Teammate = {
    agentName: options?.agentName,
    allowedTools: policy.allowedTools,
    id,
    model: policy.model,
    name,
    permissions: policy.permissions,
    role,
    status: "pending",
    task,
    worktreePath,
  };

  deps.tracker.register(teammate);
  const teamTask = deps.taskList.create(task, id, { assigneeName: name });

  eventBus.publish(AppEvent.TeamMateSpawned, {
    name,
    role,
    task,
    teammateId: id,
    worktreePath,
  });

  log.info(`队友已创建: ${id} (${name}) — ${task}`);
  deps.autoSaveState();

  return {
    ok: true,
    output: JSON.stringify({
      name,
      role,
      status: "pending",
      task,
      taskId: teamTask.id,
      teammateId: id,
      worktreePath,
    }),
    teammateId: id,
  };
}

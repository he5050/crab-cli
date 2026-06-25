/**
 * Team 队友生命周期模块 — 协调队友开始/结束阶段的钩子、提交与状态更新。
 *
 * 职责:
 *   - 启动前调用钩子并构建上下文
 *   - 结束后自动提交 worktree 改动
 *   - 失败时标记队友状态
 *
 * 模块功能:
 *   - startTeamMateExecution: 启动队友执行
 *   - finalizeTeamMateExecution: 收尾工作(提交/状态/钩子)
 *   - StartTeamMateExecutionDeps: 启动依赖
 */
import { createId } from "@/core/identity";
import { createLogger } from "@/core/logging/logger";
import { hookExecutor } from "@/hooks/hookExecutor";
import type { TeamTracker } from "../core/teamTracker";
import { autoCommitWorktreeChanges } from "../merge/teamWorktree";
import type { TeamExecutionResult, Teammate } from "../types";
import type { TeammateExecutionOptions } from "../mate/teamExecutorHelpers";

const log = createLogger("team:lifecycle");

export interface StartTeamMateExecutionDeps {
  tracker: TeamTracker;
  buildTeammateContext: (mate: Teammate, prompt: string) => string;
  executeTeammateLoop: (
    mate: Teammate,
    initialPrompt: string,
    abortSignal: AbortSignal,
    options: TeammateExecutionOptions,
  ) => Promise<void>;
  markTeammateFailedIfTracked: (teammateId: string, error: string) => void;
}

export function startTeamMateExecution(
  deps: StartTeamMateExecutionDeps,
  teammateId: string,
  prompt: string,
  options: TeammateExecutionOptions = {},
): TeamExecutionResult {
  const mate = deps.tracker.get(teammateId);
  if (!mate) {
    return { error: `队友不存在: ${teammateId}`, ok: false, teammateId };
  }

  if (mate.status === "running") {
    return { error: `队友已在运行中: ${teammateId}`, ok: false, teammateId };
  }

  const abortController = deps.tracker.createAbortController(teammateId, options.abortSignal);
  deps.tracker.updateStatus(teammateId, "running", { sessionId: createId("ses") });

  hookExecutor.subAgentStart(teammateId, mate.name).catch((error: unknown) => {
    log.warn(`队友 ${teammateId} 启动钩子执行失败`, { error: error instanceof Error ? error.message : String(error) });
  });

  const teamContext = deps.buildTeammateContext(mate, prompt);
  deps.executeTeammateLoop(mate, teamContext, abortController.signal, options).catch(async (error) => {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`队友 ${teammateId} 执行异常: ${msg}`);
    deps.markTeammateFailedIfTracked(teammateId, msg);
    await hookExecutor.subAgentStop(teammateId, mate.name, false);
    options.onMessage?.({
      content: msg,
      teammateId,
      teammateName: mate.name,
      type: "error",
    });
  });

  return {
    ok: true,
    output: `队友 ${mate.name} 已开始执行`,
    teammateId,
  };
}

export interface ShutdownTeamMateDeps {
  tracker: TeamTracker;
}

export async function shutdownTeamMate(deps: ShutdownTeamMateDeps, teammateId: string): Promise<TeamExecutionResult> {
  const mate = deps.tracker.get(teammateId);
  if (!mate) {
    return { error: `队友不存在: ${teammateId}`, ok: false, teammateId };
  }

  const controller = deps.tracker.getAbortController(teammateId);
  controller?.abort();

  await hookExecutor.subAgentStop(teammateId, mate.name, true);

  if (mate.worktreePath) {
    autoCommitWorktreeChanges(mate.worktreePath, mate.name);
  }

  deps.tracker.updateStatus(teammateId, "completed", { result: "被 lead 关闭" });
  deps.tracker.unregister(teammateId);

  log.info(`队友已关闭: ${teammateId} (${mate.name})`);

  return {
    ok: true,
    output: `队友 ${mate.name} 已关闭`,
    teammateId,
  };
}

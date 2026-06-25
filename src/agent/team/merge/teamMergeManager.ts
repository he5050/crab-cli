/**
 * [Team 合并管理器]
 *
 * 职责:
 *   - 分支合并(mergeTeammateWork / mergeAllWork)
 *   - 冲突解决(resolveConflictsWithLlm)
 *   - 团队清理(cleanupTeam / cleanup)
 *   - 合并生命周期(resolveMergeConflicts / abortMerge)
 *
 * 从 teamExecutor.ts 提取，降低主文件复杂度。
 */

import { createLogger } from "@/core/logging/logger";
import type { TeamConfig, TeamExecutionResult, Teammate } from "../types";
import type { TeamTracker } from "../core/teamTracker";
import type { TeamTaskList } from "../core/teamTaskList";
import {
  abortMerge,
  cleanupTeamWorktrees,
  completeMerge,
  mergeTeammateBranch,
  removeWorktree,
} from "../merge/teamWorktree";
import type { LlmConflictResolver, MergeStrategy } from "../merge/teamWorktree";
import { disbandTeam } from "../persist/teamPersist";
import { deleteStateSnapshot } from "../persist/teamStateSnapshot";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "@/config";
import { completeLlm } from "@/api";
import type { ModelMessage } from "ai";
import {
  type AutoConflictResolution,
  applyOursPreferConflictFallback,
  requestConflictFallbackChoice,
} from "../merge/teamConflictFallback";

const log = createLogger("team:merge-manager");

export interface TeamMergeManagerDeps {
  projectDir: string | undefined;
  tracker: TeamTracker;
  taskList: TeamTaskList;
  config: TeamConfig;
}

export class TeamMergeManager {
  constructor(private deps: TeamMergeManagerDeps) {}

  setProjectDir(dir: string | undefined): void {
    this.deps.projectDir = dir;
  }

  setConfig(config: TeamConfig): void {
    this.deps.config = config;
  }

  private get projectDir() {
    return this.deps.projectDir;
  }
  private get tracker() {
    return this.deps.tracker;
  }
  private get taskList() {
    return this.deps.taskList;
  }
  private get config() {
    return this.deps.config;
  }

  // ─── 团队上下文清理 ─────────────────────────────────────────

  private clearActiveTeamContext(markDisbanded: boolean): void {
    const activeTeamName = this.tracker.getActiveTeamName() ?? this.taskList.getActiveTeamName();
    if (markDisbanded && activeTeamName) {
      try {
        disbandTeam(activeTeamName, this.projectDir);
      } catch {
        // Ignore cleanup-time persistence failures
      }
    }
    this.tracker.clearActiveTeam();
    this.taskList.setActiveTeam(null);
  }

  // ─── 冲突解决 ───────────────────────────────────────────────

  /** 使用 LLM 解决 Git 合并冲突 */
  private async resolveConflictsWithLlm(conflicts: string[]): Promise<AutoConflictResolution> {
    if (!this.projectDir) {
      return { status: "failed" };
    }
    const config = await loadConfig();
    const resolved: string[] = [];
    const failed: string[] = [];

    for (const file of conflicts) {
      const filePath = path.join(this.projectDir, file);
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        failed.push(file);
        continue;
      }
      if (!content.includes("<<<<<<<")) {
        failed.push(file);
        continue;
      }

      const messages: ModelMessage[] = [
        {
          content: `你是 Git 合并冲突解决专家。请分析以下文件的冲突标记，合并两个版本的代码。
规则:
1. 保留两个版本中所有有价值的逻辑，不要丢弃任何一方独有的功能
2. 如果两方修改了同一区域，智能整合，不能简单拼接
3. 保持代码语法正确、可编译
4. 移除所有冲突标记(<<<<<<<, =======, >>>>>>>)
5. 只输出解决后的完整文件内容，不要解释`,
          role: "system",
        },
        {
          content: `文件: ${file}\n\n${content}`,
          role: "user",
        },
      ];

      try {
        const { text: resolvedContent } = await completeLlm(config, messages);
        await writeFile(filePath, resolvedContent, "utf8");
        resolved.push(file);
      } catch (error) {
        log.warn(`LLM 解决冲突失败: ${file}`, { error: error instanceof Error ? error.message : String(error) });
        failed.push(file);
      }
    }

    if (failed.length > 0) {
      const choice = await requestConflictFallbackChoice(conflicts, failed);
      if (choice === "manual") {
        log.warn("LLM 冲突解决失败，升级为用户手动解决", { failed });
        return { status: "manual" };
      }
      if (choice === "abort") {
        log.warn("LLM 冲突解决失败，用户选择中止合并", { failed });
        return { status: "abort" };
      }
      const fallbackOk = await applyOursPreferConflictFallback(this.projectDir, failed);
      if (!fallbackOk) {
        return { status: "failed" };
      }
    }

    if (resolved.length > 0) {
      const addProc = Bun.spawnSync(["git", "add", "-A", "--", ...conflicts], {
        cwd: this.projectDir,
        stderr: "pipe",
        stdout: "pipe",
      });
      if (addProc.exitCode !== 0) {
        log.error("git add 冲突文件失败");
        return { status: "failed" };
      }
    }

    log.info(`冲突解决完成: LLM解决 ${resolved.length} 个, ours-prefer fallback ${failed.length} 个`);
    return { status: "resolved" };
  }

  // ─── 分支合并 ──────────────────────────────────────────────

  /** 合并指定队友的分支 */
  async mergeTeammateWork(
    teammateId: string,
    strategy: MergeStrategy = "manual",
    llmResolver?: LlmConflictResolver,
  ): Promise<TeamExecutionResult> {
    const mate = this.tracker.get(teammateId);
    if (!mate?.worktreePath || !this.projectDir) {
      return { error: "队友或 worktree 不存在", ok: false, teammateId };
    }

    const result = await mergeTeammateBranch(mate.worktreePath, this.projectDir, strategy, llmResolver);

    if (!result.success && result.conflicts && result.conflicts.length > 0 && strategy === "auto") {
      const resolution = await this.resolveConflictsWithLlm(result.conflicts);
      if (resolution.status === "resolved") {
        const ok = await completeMerge(this.projectDir!);
        return {
          error: ok ? undefined : "LLM 冲突解决后提交失败",
          ok,
          output: JSON.stringify({ resolved: result.conflicts }),
          teammateId,
        };
      }
      if (resolution.status === "manual") {
        return {
          error: `需要用户手动解决合并冲突: ${result.conflicts.join(", ")}`,
          ok: false,
          output: JSON.stringify({ askUserEscalated: true, conflicts: result.conflicts, pendingConflict: true }),
          teammateId,
        };
      }
      await abortMerge(this.projectDir!);
      return {
        error: `自动冲突解决失败: ${result.conflicts.join(", ")}`,
        ok: false,
        output: JSON.stringify({
          aborted: resolution.status === "abort",
          autoResolveFailed: true,
          conflicts: result.conflicts,
        }),
        teammateId,
      };
    }

    return {
      error: result.error,
      ok: result.success,
      output: JSON.stringify(result),
      teammateId,
    };
  }

  /** 合并所有队友的分支 */
  async mergeAllWork(
    strategy: MergeStrategy = "manual",
    llmResolver?: LlmConflictResolver,
  ): Promise<TeamExecutionResult> {
    if (!this.projectDir) {
      return { error: "项目目录未设置", ok: false, teammateId: "all" };
    }

    const mates = this.tracker.list();
    const results: { name: string; success: boolean; conflicts?: string[] }[] = [];

    for (const mate of mates) {
      if (!mate.worktreePath) {
        continue;
      }

      const result = await mergeTeammateBranch(mate.worktreePath, this.projectDir, strategy, llmResolver);
      results.push({ conflicts: result.conflicts, name: mate.name, success: result.success });

      if (!result.success && result.conflicts && result.conflicts.length > 0) {
        if (strategy === "auto") {
          const resolution = await this.resolveConflictsWithLlm(result.conflicts);
          if (resolution.status === "resolved") {
            const ok = await completeMerge(this.projectDir!);
            results[results.length - 1] = { name: mate.name, success: ok };
            continue;
          }
          if (resolution.status === "manual") {
            return {
              error: `需要用户手动解决合并冲突: ${result.conflicts.join(", ")}`,
              ok: false,
              output: JSON.stringify({
                askUserEscalated: true,
                conflicts: result.conflicts,
                pendingConflict: true,
                results,
              }),
              teammateId: "all",
            };
          }
          await abortMerge(this.projectDir!);
          return {
            error: `自动冲突解决失败: ${result.conflicts.join(", ")}`,
            ok: false,
            output: JSON.stringify({
              aborted: resolution.status === "abort",
              autoResolveFailed: true,
              conflicts: result.conflicts,
              results,
            }),
            teammateId: "all",
          };
        }
        return {
          error: `合并冲突: ${result.conflicts.join(", ")}`,
          ok: false,
          output: JSON.stringify({ conflicts: result.conflicts, pendingConflict: true, results }),
          teammateId: "all",
        };
      }
    }

    return {
      ok: true,
      output: JSON.stringify({ results }),
      teammateId: "all",
    };
  }

  /** 解决合并冲突后完成合并 */
  async resolveMergeConflicts(): Promise<TeamExecutionResult> {
    if (!this.projectDir) {
      return { error: "项目目录未设置", ok: false, teammateId: "all" };
    }

    const ok = await completeMerge(this.projectDir);
    return {
      ok,
      output: ok ? "合并冲突已解决" : "解决合并冲突失败",
      teammateId: "all",
    };
  }

  /** 中止合并 */
  async abortMerge(): Promise<TeamExecutionResult> {
    if (!this.projectDir) {
      return { error: "项目目录未设置", ok: false, teammateId: "all" };
    }

    const ok = await abortMerge(this.projectDir);
    return {
      ok,
      output: ok ? "合并已中止" : "中止合并失败",
      teammateId: "all",
    };
  }

  // ─── 清理 ──────────────────────────────────────────────────

  /** 完整清理:中止队友 + 合并分支 + 删除 worktree */
  async cleanupTeam(): Promise<TeamExecutionResult> {
    if (!this.projectDir) {
      return { error: "项目目录未设置", ok: false, teammateId: "all" };
    }

    const mates = this.tracker.list();
    for (const mate of mates) {
      if (mate.worktreePath && mate.status === "running") {
        return {
          error: `队友 ${mate.name} 仍在运行，请先关闭所有队友`,
          ok: false,
          teammateId: "all",
        };
      }
    }

    this.tracker.abortAllTeammates();

    const basePath = this.config.worktreeBase ?? ".crab/worktrees";
    const cleanedCount = await cleanupTeamWorktrees(this.projectDir, basePath);

    this.tracker.clear();
    this.taskList.clear();
    this.clearActiveTeamContext(true);

    log.info(`Team 已清理: ${cleanedCount} 个 worktree`);

    deleteStateSnapshot(this.projectDir);

    return {
      ok: true,
      output: `Team 已清理: ${cleanedCount} 个 worktree 已移除`,
      teammateId: "all",
    };
  }

  /** 简单清理(不合并分支) */
  async cleanup(): Promise<void> {
    const mates = this.tracker.list();
    for (const mate of mates) {
      if (mate.worktreePath && this.projectDir) {
        await removeWorktree(mate.worktreePath, this.projectDir);
      }
    }
    this.tracker.clear();
    this.taskList.clear();
    this.clearActiveTeamContext(true);
    log.info("Team 执行器已清理");
  }
}

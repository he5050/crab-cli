/**
 * Team 活跃上下文模块 — 确保运行时存在活跃团队及其跟踪器/任务列表。
 *
 * 职责:
 *   - 推导默认团队名称
 *   - 在缺失时自动创建团队
 *   - 同步 tracker / taskList / 持久化状态
 *
 * 模块功能:
 *   - ensureActiveTeamContext: 确保活跃团队上下文
 *   - deriveDefaultTeamName: 推导默认团队名
 *   - EnsureActiveTeamContextOptions: 入参
 */
import path from "node:path";
import { createTeam, getActiveTeam, getTeam, updateTeam } from "../persist/teamPersist";
import type { TeamTaskList } from "../core/teamTaskList";
import type { TeamTracker } from "../core/teamTracker";

export interface EnsureActiveTeamContextOptions {
  tracker: TeamTracker;
  taskList: TeamTaskList;
  projectDir?: string;
  createIfMissing?: boolean;
  leadInstanceId?: string;
}

export function deriveDefaultTeamName(projectDir?: string): string {
  const base = projectDir ? path.basename(projectDir) : path.basename(process.cwd());
  return `${base || "crab"}-team`;
}

export function ensureActiveTeamContext(options: EnsureActiveTeamContextOptions): string | null {
  const trackerTeam = options.tracker.getActiveTeamName();
  if (trackerTeam) {
    if (options.taskList.getActiveTeamName() !== trackerTeam) {
      options.taskList.setActiveTeam(trackerTeam);
    }
    return trackerTeam;
  }

  const persisted = getActiveTeam(options.projectDir);
  if (persisted?.name) {
    options.tracker.setActiveTeam(persisted.name);
    options.taskList.setActiveTeam(persisted.name);
    return persisted.name;
  }

  if (options.createIfMissing === false) {
    return null;
  }

  const teamName = deriveDefaultTeamName(options.projectDir);
  try {
    createTeam(teamName, options.leadInstanceId ?? `lead_${process.pid}`, options.projectDir);
  } catch {
    const existing = getTeam(teamName, options.projectDir);
    if (existing && existing.status !== "active") {
      updateTeam(teamName, { status: "active" }, options.projectDir);
    }
  }
  options.tracker.setActiveTeam(teamName);
  options.taskList.setActiveTeam(teamName);
  return teamName;
}

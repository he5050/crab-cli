/**
 * [团队实例持久化]
 *
 * 职责:
 *   - 管理活跃团队的状态持久化
 *   - 团队成员的 CRUD 操作
 *   - 团队生命周期管理
 *
 * 模块功能:
 *   - createTeam:创建新团队
 *   - getTeam:获取团队配置
 *   - getActiveTeam:获取当前活跃团队
 *   - updateTeam:更新团队配置
 *   - addMember:添加成员到团队
 *   - updateMember:更新成员状态
 *   - removeMember:移除成员
 *   - getMember:获取成员信息
 *   - getActiveMembers:获取活跃成员列表
 *   - findMemberByName:按名称查找成员
 *   - disbandTeam:解散团队
 *   - deleteTeamData:删除团队数据
 *
 * 使用场景:
 *   - 团队创建和管理
 *   - 成员加入和离开
 *   - 团队状态持久化
 *   - 会话恢复和清理
 *
 * 边界:
 *   1. 存储路径:<project>/.crab/teams/{teamName}/config.json
 *   2. JSON 文件持久化
 *   3. 活跃团队状态为 "active"
 *   4. 解散后状态为 "disbanded"
 *
 * 流程:
 *   1. 创建团队目录和配置文件
 *   2. 添加/更新/删除成员
 *   3. 写入 JSON 文件持久化
 *   4. 解散时更新状态和成员
 *   5. 删除时移除整个目录
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { uuid } from "@/core/id";
import { createLogger } from "@/core/logging/logger";
import { ensureDir } from "@/tool/shared/fs";
import { getTeamStorageDir } from "../persist/storagePaths";
import { createInternalError } from "@/core/errors/appError";

const log = createLogger("team:persist");

// ─── 类型 ────────────────────────────────────────────────────

export type PersistedTeamMemberStatus = "pending" | "active" | "idle" | "shutdown";
export type PersistedTeamStatus = "active" | "cleanup" | "disbanded";

export interface PersistedTeamMember {
  id: string;
  name: string;
  role?: string;
  instanceId?: string;
  worktreePath: string;
  status: PersistedTeamMemberStatus;
  spawnedAt?: string;
  shutdownAt?: string;
}

export interface PersistedTeam {
  name: string;
  leadInstanceId: string;
  members: PersistedTeamMember[];
  createdAt: string;
  status: PersistedTeamStatus;
}

// ─── 路径 ────────────────────────────────────────────────────

function getTeamDir(teamName: string, projectDir?: string): string {
  return join(getTeamStorageDir(projectDir), teamName);
}

function getTeamConfigPath(teamName: string, projectDir?: string): string {
  return join(getTeamDir(teamName, projectDir), "config.json");
}

// ─── Team CRUD ──────────────────────────────────────────────

/** 创建新团队 */
export function createTeam(teamName: string, leadInstanceId: string, projectDir?: string): PersistedTeam {
  const existing = getTeam(teamName, projectDir);
  if (existing) {
    throw createInternalError("INTERNAL_ERROR", `Team "${teamName}" already exists.`);
  }

  const teamDir = getTeamDir(teamName, projectDir);
  ensureDir(teamDir);

  const team: PersistedTeam = {
    createdAt: new Date().toISOString(),
    leadInstanceId,
    members: [],
    name: teamName,
    status: "active",
  };

  writeFileSync(getTeamConfigPath(teamName, projectDir), JSON.stringify(team, null, 2));
  log.info(`团队已创建: ${teamName}`);
  return team;
}

/** 获取团队配置 */
export function getTeam(teamName: string, projectDir?: string): PersistedTeam | null {
  const configPath = getTeamConfigPath(teamName, projectDir);
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as PersistedTeam;
  } catch {
    return null;
  }
}

/** 获取当前活跃团队(遍历 teams 目录) */
export function getActiveTeam(projectDir?: string): PersistedTeam | null {
  const teamsDir = getTeamStorageDir(projectDir);
  ensureDir(teamsDir);
  try {
    const entries = readdirSync(teamsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const team = getTeam(entry.name, projectDir);
        if (team && team.status === "active") {
          return team;
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
}

/** 更新团队配置 */
export function updateTeam(
  teamName: string,
  updates: Partial<PersistedTeam>,
  projectDir?: string,
): PersistedTeam | null {
  const team = getTeam(teamName, projectDir);
  if (!team) {
    return null;
  }

  const updated: PersistedTeam = { ...team, ...updates, name: teamName };
  writeFileSync(getTeamConfigPath(teamName, projectDir), JSON.stringify(updated, null, 2));
  return updated;
}

// ─── Member CRUD ───────────────────────────────────────────

/** 添加成员到团队 */
export function addMember(
  teamName: string,
  name: string,
  worktreePath: string,
  role?: string,
  projectDir?: string,
): PersistedTeamMember {
  const team = getTeam(teamName, projectDir);
  if (!team) {
    throw createInternalError("INTERNAL_ERROR", `Team "${teamName}" not found`);
  }
  if (team.status !== "active") {
    throw createInternalError("INTERNAL_ERROR", `Team "${teamName}" is not active`);
  }

  const member: PersistedTeamMember = {
    id: uuid(),
    name,
    role,
    spawnedAt: new Date().toISOString(),
    status: "pending",
    worktreePath,
  };

  team.members.push(member);
  writeFileSync(getTeamConfigPath(teamName, projectDir), JSON.stringify(team, null, 2));
  log.info(`成员已添加: ${name} → ${teamName}`);
  return member;
}

/** 更新成员状态 */
export function updateMember(
  teamName: string,
  memberId: string,
  updates: Partial<Pick<PersistedTeamMember, "status" | "instanceId" | "shutdownAt">>,
  projectDir?: string,
): PersistedTeamMember | null {
  const team = getTeam(teamName, projectDir);
  if (!team) {
    return null;
  }

  const member = team.members.find((m) => m.id === memberId);
  if (!member) {
    return null;
  }

  Object.assign(member, updates);
  writeFileSync(getTeamConfigPath(teamName, projectDir), JSON.stringify(team, null, 2));
  return member;
}

/** 移除成员 */
export function removeMember(teamName: string, memberId: string, projectDir?: string): boolean {
  const team = getTeam(teamName, projectDir);
  if (!team) {
    return false;
  }

  const idx = team.members.findIndex((m) => m.id === memberId);
  if (idx === -1) {
    return false;
  }

  team.members.splice(idx, 1);
  writeFileSync(getTeamConfigPath(teamName, projectDir), JSON.stringify(team, null, 2));
  return true;
}

/** 获取成员 */
export function getMember(teamName: string, memberId: string, projectDir?: string): PersistedTeamMember | null {
  const team = getTeam(teamName, projectDir);
  if (!team) {
    return null;
  }
  return team.members.find((m) => m.id === memberId) || null;
}

/** 获取活跃成员列表 */
export function getActiveMembers(teamName: string, projectDir?: string): PersistedTeamMember[] {
  const team = getTeam(teamName, projectDir);
  if (!team) {
    return [];
  }
  return team.members.filter((m) => m.status === "active" || m.status === "pending");
}

/** 按名称查找成员 */
export function findMemberByName(
  teamName: string,
  memberName: string,
  projectDir?: string,
): PersistedTeamMember | null {
  const team = getTeam(teamName, projectDir);
  if (!team) {
    return null;
  }
  const lower = memberName.toLowerCase();
  return team.members.find((m) => m.name.toLowerCase() === lower) || null;
}

// ─── 团队生命周期 ───────────────────────────────────────────

/** 解散团队 */
export function disbandTeam(teamName: string, projectDir?: string): boolean {
  const team = getTeam(teamName, projectDir);
  if (!team) {
    return false;
  }

  team.status = "disbanded";
  team.members.forEach((m) => {
    if (m.status !== "shutdown") {
      m.status = "shutdown";
      m.shutdownAt = new Date().toISOString();
    }
  });

  writeFileSync(getTeamConfigPath(teamName, projectDir), JSON.stringify(team, null, 2));
  log.info(`团队已解散: ${teamName}`);
  return true;
}

/** 删除团队数据 */
export function deleteTeamData(teamName: string, projectDir?: string): boolean {
  const teamDir = getTeamDir(teamName, projectDir);
  if (!existsSync(teamDir)) {
    return false;
  }
  try {
    rmSync(teamDir, { force: true, recursive: true });
    log.info(`团队数据已删除: ${teamName}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * [Team 快照管理]
 *
 * 职责:
 *   - 追踪团队创建事件
 *   - 追踪队友生成事件
 *   - 支持会话回滚时自动清理
 *   - 管理快照数据的持久化
 *
 * 模块功能:
 *   - recordTeamCreated:记录团队创建
 *   - recordMemberSpawned:记录队友生成
 *   - getTeamEventsToRollback:获取需回滚的事件
 *   - hasTeamToRollback:检查是否有可回滚的团队
 *   - getTeamRollbackCount:获取回滚队友数量
 *   - deleteTeamSnapshotsFromIndex:删除指定索引后的快照
 *   - deleteTeamSnapshotsByTeamName:删除指定团队的快照
 *   - clearAllTeamSnapshots:清空所有快照
 *   - rollbackTeamState:执行团队状态回滚
 *
 * 使用场景:
 *   - 会话回滚时清理团队资源
 *   - 追踪团队生命周期事件
 *   - 恢复或清理团队状态
 *
 * 边界:
 *   1. 使用 JSON 文件持久化
 *   2. 按 (sessionId, messageIndex) 索引
 *   3. 快照数据存储在 .crab/team-snapshots 目录
 *   4. 回滚操作不可逆
 *
 * 流程:
 *   1. 团队创建/队友生成时记录事件
 *   2. 按 sessionId:messageIndex 存储快照
 *   3. 回滚时获取目标索引后的事件
 *   4. 执行清理(abort、解散团队、删除 worktree)
 *   5. 删除已回滚的快照记录
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createLogger } from "@/core/logging/logger";
import { ensureDir } from "@/tool/shared/fs";
import { getTeamSnapshotDir } from "../persist/storagePaths";

const log = createLogger("team:snapshot");

// ─── 类型 ────────────────────────────────────────────────────

export type TeamSnapshotEvent =
  | { type: "team_created"; teamName: string }
  | { type: "member_spawned"; teamName: string; memberId: string; memberName: string; worktreePath: string };

type TeamSnapshotData = Record<string, TeamSnapshotEvent[]>;

// ─── 文件 I/O ────────────────────────────────────────────────

function getSnapshotDir(projectDir?: string): string {
  return getTeamSnapshotDir(projectDir);
}

function getSnapshotFilePath(projectId: string, projectDir?: string): string {
  return join(getSnapshotDir(projectDir), `${projectId}.json`);
}

function readSnapshotData(projectId: string, projectDir?: string): TeamSnapshotData {
  const filePath = getSnapshotFilePath(projectId, projectDir);
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as TeamSnapshotData;
  } catch {
    return {};
  }
}

function saveSnapshotData(projectId: string, data: TeamSnapshotData, projectDir?: string): void {
  ensureDir(dirname(getSnapshotFilePath(projectId, projectDir)));
  try {
    writeFileSync(getSnapshotFilePath(projectId, projectDir), JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    log.error(`快照保存失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ─── Public API ──────────────────────────────────────────────

/** 记录团队创建事件 */
export function recordTeamCreated(
  projectId: string,
  sessionId: string,
  messageIndex: number,
  teamName: string,
  projectDir?: string,
): void {
  const data = readSnapshotData(projectId, projectDir);
  const key = `${sessionId}:${messageIndex}`;
  if (!data[key]) {
    data[key] = [];
  }
  const already = data[key].some((e) => e.type === "team_created" && e.teamName === teamName);
  if (!already) {
    data[key].push({ teamName, type: "team_created" });
    saveSnapshotData(projectId, data, projectDir);
  }
}

/** 记录队友生成事件 */
export function recordMemberSpawned(
  projectId: string,
  sessionId: string,
  messageIndex: number,
  teamName: string,
  memberId: string,
  memberName: string,
  worktreePath: string,
  projectDir?: string,
): void {
  const data = readSnapshotData(projectId, projectDir);
  const key = `${sessionId}:${messageIndex}`;
  if (!data[key]) {
    data[key] = [];
  }
  data[key].push({ memberId, memberName, teamName, type: "member_spawned", worktreePath });
  saveSnapshotData(projectId, data, projectDir);
}

/** 获取需要回滚的事件 */
export function getTeamEventsToRollback(
  projectId: string,
  sessionId: string,
  targetMessageIndex: number,
  projectDir?: string,
): TeamSnapshotEvent[] {
  const data = readSnapshotData(projectId, projectDir);
  const events: TeamSnapshotEvent[] = [];
  for (const [key, ops] of Object.entries(data)) {
    if (!key.startsWith(`${sessionId}:`)) {
      continue;
    }
    const msgIndex = parseInt(key.split(":")[1] || "", 10);
    if (!isNaN(msgIndex) && msgIndex >= targetMessageIndex) {
      events.push(...ops);
    }
  }
  return events;
}

/** 检查是否有可回滚的团队 */
export function hasTeamToRollback(
  projectId: string,
  sessionId: string,
  targetMessageIndex: number,
  projectDir?: string,
): boolean {
  return getTeamEventsToRollback(projectId, sessionId, targetMessageIndex, projectDir).length > 0;
}

/** 获取回滚的队友数量 */
export function getTeamRollbackCount(
  projectId: string,
  sessionId: string,
  targetMessageIndex: number,
  projectDir?: string,
): number {
  return getTeamEventsToRollback(projectId, sessionId, targetMessageIndex, projectDir).filter(
    (e) => e.type === "member_spawned",
  ).length;
}

/** 删除指定 messageIndex 之后的快照记录 */
export function deleteTeamSnapshotsFromIndex(
  projectId: string,
  sessionId: string,
  targetMessageIndex: number,
  projectDir?: string,
): void {
  const data = readSnapshotData(projectId, projectDir);
  let changed = false;
  for (const key of Object.keys(data)) {
    if (!key.startsWith(`${sessionId}:`)) {
      continue;
    }
    const msgIndex = parseInt(key.split(":")[1] || "", 10);
    if (!isNaN(msgIndex) && msgIndex >= targetMessageIndex) {
      delete data[key];
      changed = true;
    }
  }
  if (changed) {
    saveSnapshotData(projectId, data, projectDir);
  }
}

/** 删除指定 team 的快照记录 */
export function deleteTeamSnapshotsByTeamName(
  projectId: string,
  sessionId: string,
  teamName: string,
  projectDir?: string,
): void {
  const data = readSnapshotData(projectId, projectDir);
  let changed = false;
  for (const [key, events] of Object.entries(data)) {
    if (!key.startsWith(`${sessionId}:`)) {
      continue;
    }
    const filtered = events.filter((e) => e.teamName !== teamName);
    if (filtered.length !== events.length) {
      changed = true;
      if (filtered.length === 0) {
        delete data[key];
      } else {
        data[key] = filtered;
      }
    }
  }
  if (changed) {
    saveSnapshotData(projectId, data, projectDir);
  }
}

/** 清空 session 的所有快照 */
export function clearAllTeamSnapshots(projectId: string, sessionId: string, projectDir?: string): void {
  const data = readSnapshotData(projectId, projectDir);
  let changed = false;
  for (const key of Object.keys(data)) {
    if (key.startsWith(`${sessionId}:`)) {
      delete data[key];
      changed = true;
    }
  }
  if (changed) {
    saveSnapshotData(projectId, data, projectDir);
  }
}

// ─── 回滚执行 ────────────────────────────────────────────────

/**
 * 执行团队回滚:abort 所有队友、清理 worktree、解散团队、清除 tracker。
 *
 * rollbackTeamState:
 *   1. Abort 所有运行中的队友
 *   2. 收集快照中涉及的团队名
 *   3. 清理每个团队的 worktree
 *   4. 解散每个团队
 *   5. 清除 tracker 的活跃团队
 *   6. 删除快照记录
 *
 * @returns 清理的团队数量
 */
export async function rollbackTeamState(
  projectId: string,
  sessionId: string,
  targetMessageIndex: number,
  projectDir?: string,
): Promise<number> {
  const events = getTeamEventsToRollback(projectId, sessionId, targetMessageIndex, projectDir);
  if (events.length === 0) {
    return 0;
  }

  // 动态导入以避免循环依赖
  const { teamExecutor } = await import("../core/teamExecutor");
  const { cleanupTeamWorktrees } = await import("../merge/teamWorktree");
  const { disbandTeam } = await import("./teamPersist");

  // Abort 所有运行中的队友
  const tracker = teamExecutor.getTracker();
  tracker.abortAllTeammates();

  // 收集快照中涉及的团队名
  const teamNames = new Set<string>();
  for (const event of events) {
    teamNames.add(event.teamName);
  }

  // 也包括 tracker 中的活跃团队(可能不在快照中)
  const activeTeamName = tracker.getActiveTeamName();
  if (activeTeamName) {
    teamNames.add(activeTeamName);
  }

  let cleanedCount = 0;

  for (const teamName of teamNames) {
    // 清理 worktree
    try {
      const config = teamExecutor.getConfig();
      const basePath = config.worktreeBase ?? ".crab/worktrees";
      const projectDir = teamExecutor.getProjectDir();
      if (projectDir) {
        await cleanupTeamWorktrees(projectDir, basePath);
      }
      cleanedCount++;
    } catch (error) {
      log.error(`清理 worktree 失败 (${teamName}): ${error instanceof Error ? error.message : String(error)}`);
    }

    // 解散团队
    try {
      disbandTeam(teamName, projectDir);
    } catch {
      // 可能已经解散
    }
  }

  // 清除 tracker 的活跃团队
  tracker.clearActiveTeam();

  // 删除快照记录
  deleteTeamSnapshotsFromIndex(projectId, sessionId, targetMessageIndex, projectDir);

  log.info(`团队回滚完成: ${cleanedCount} 个团队已清理`);
  return cleanedCount;
}

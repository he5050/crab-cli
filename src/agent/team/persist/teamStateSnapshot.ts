/**
 * Team 运行时状态快照 — 将 TeamTracker 的运行时状态持久化到磁盘，支持进程重启后恢复。
 *
 * 职责:
 *   - 将 TeamTracker 的运行时状态(队友、任务、配置)持久化到磁盘
 *   - 进程重启后恢复团队状态
 *   - 管理快照生命周期(过期清理)
 *
 * 模块功能:
 *   - saveStateSnapshot(): 将团队状态快照保存到 .crab/team-state-snapshots/ 目录
 *   - loadStateSnapshot(): 加载最新的团队状态快照，过期(24小时)自动清理
 *   - deleteStateSnapshot(): 删除团队状态快照
 *   - hasRecoverableSnapshot(): 检查是否存在可恢复的快照
 *
 * 使用场景:
 *   - 进程崩溃重启后恢复团队状态
 *   - 服务中断后继续未完成的工作
 *   - 团队协作中断后恢复工作进度
 *
 * 边界:
 * 1. 仅持久化可序列化字段，AbortController 等运行时对象不保存
 * 2. 快照写入 .crab/team-state-snapshots/ 目录，每个团队同时只保留最新快照
 * 3. 快照最大存活 24 小时，超时自动清理
 * 4. 与 teamSnapshot.ts 的区别:本模块持久化运行时状态，teamSnapshot.ts 追踪会话回滚事件
 *
 * 流程:
 * 1. 任务执行中:定期调用 saveStateSnapshot() 保存状态
 * 2. 进程重启:调用 loadStateSnapshot() 尝试恢复状态
 * 3. 恢复成功:检查 hasRecoverableSnapshot() 确认可继续工作
 * 4. 任务完成:调用 deleteStateSnapshot() 清理快照
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@/core/logging/logger";
import { ensureDir } from "@/tool/shared/fs";
import { getTeamSnapshotDir } from "../persist/storagePaths";
import type { TeamSnapshot } from "../types";

const log = createLogger("team:state-snapshot");

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_PREFIX = "team-state-";

function getDir(projectDir?: string): string {
  return getTeamSnapshotDir(projectDir);
}

function snapshotPath(projectDir?: string): string {
  return join(getDir(projectDir), `${SNAPSHOT_PREFIX}latest.json`);
}

function tmpPath(projectDir?: string): string {
  return join(
    getDir(projectDir),
    `${SNAPSHOT_PREFIX}latest.json.tmp.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`,
  );
}

export function saveStateSnapshot(snapshot: TeamSnapshot, projectDir?: string): boolean {
  try {
    const data = JSON.stringify(snapshot, null, 2);
    const finalPath = snapshotPath(projectDir);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      ensureDir(getDir(projectDir));
      const tmp = tmpPath(projectDir);
      try {
        writeFileSync(tmp, data, "utf8");
        renameSync(tmp, finalPath);
        break;
      } catch (error) {
        if (attempt === 0 && error instanceof Error && "code" in error && error.code === "ENOENT") {
          continue;
        }
        throw error;
      }
    }
    log.debug(`团队状态快照已保存: ${snapshot.id}, ${snapshot.teammates.length} 个队友`);
    return true;
  } catch (error) {
    log.error(`保存团队状态快照失败: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export function loadStateSnapshot(projectDir?: string): TeamSnapshot | null {
  const path = snapshotPath(projectDir);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as TeamSnapshot;
    const age = Date.now() - data.timestamp;
    if (age > MAX_AGE_MS) {
      log.info(`团队状态快照已过期 (${Math.round(age / 60_000)} 分钟前)，已忽略`);
      try {
        unlinkSync(path);
      } catch {
        /* Noop */
      }
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function deleteStateSnapshot(projectDir?: string): void {
  try {
    const path = snapshotPath(projectDir);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    /* Noop */
  }
}

export function hasRecoverableSnapshot(projectDir?: string): boolean {
  const snapshot = loadStateSnapshot(projectDir);
  if (!snapshot) {
    return false;
  }
  return snapshot.teammates.some((t) => t.status === "running" || t.status === "pending");
}

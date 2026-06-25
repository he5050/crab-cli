/**
 * 文件系统快照 — 在 LLM step 前后捕获 Git 文件变更。
 *
 * 职责:
 *   - trackSnapshot: 在 LLM step 开始/结束时捕获 git status + diff
 *   - getSnapshot: 获取指定步骤的快照
 *   - diffSnapshots: 比较两个快照的差异
 *
 * 模块功能:
 *   - trackSnapshot(sessionId, step): 捕获当前文件状态
 *   - getSnapshot(sessionId, step): 获取快照数据
 *   - diffSnapshots(before, after): 比较两个快照
 *   - SnapshotData: 快照数据类型
 *
 * 使用场景:
 *   - LLM 调用前捕获文件状态(before)
 *   - 工具执行后捕获文件状态(after)
 *   - 会话 Revert 时恢复文件状态
 *
 * 边界:
 *   1. 仅在 Git 工作区内有效，非 Git 仓库跳过(不报错)
 *   2. 快照存储在内存中(Map)，进程退出后丢失
 *   3. 不修改任何文件，只读取 git status/diff
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getSession } from "./session";
import { isInsideGitWorkTree } from "@/tool/rollback";

const log = createLogger("session:snapshot");

/** 快照步骤 */
export type SnapshotStep = "before" | "after";

/** 单个文件变更状态 */
export interface FileChange {
  /** 文件路径(相对项目根目录) */
  path: string;
  /** Git 状态码(如 M, A, D, ?? 等) */
  status: string;
  /** 是否为新增文件 */
  isNew: boolean;
  /** 是否为删除文件 */
  isDeleted: boolean;
}

/** 快照数据 */
export interface SnapshotData {
  /** 会话 ID */
  sessionId: string;
  /** 快照步骤 */
  step: SnapshotStep;
  /** 变更文件列表 */
  files: FileChange[];
  /** Git diff 摘要(截断到 5000 字符) */
  diffSummary: string;
  /** 快照创建时间戳 */
  createdAt: number;
  /** 轮次标识(用于关联 before/after) */
  round?: number;
}

/** 快照差异结果 */
export interface SnapshotDiff {
  /** before 快照中独有的文件 */
  onlyInBefore: string[];
  /** after 快照中独有的文件 */
  onlyInAfter: string[];
  /** 两个快照中都存在但状态不同的文件 */
  changed: string[];
  /** 两个快照中都存在且状态相同的文件 */
  unchanged: string[];
  /** 新增文件数 */
  addedCount: number;
  /** 删除文件数 */
  deletedCount: number;
  /** 修改文件数 */
  modifiedCount: number;
}

/** 会话快照存储: sessionId → step → SnapshotData */
const snapshotStore = new Map<string, Map<SnapshotStep, SnapshotData>>();

/**
 * 捕获当前文件系统快照。
 * 在 LLM step 开始/结束时调用，记录 git status + diff。
 * 如果不在 Git 仓库中，跳过(不报错)。
 *
 * @param sessionId 会话 ID
 * @param step 快照步骤 ("before" | "after")
 * @param round 轮次标识(可选，用于关联 before/after)
 * @returns 快照数据，非 Git 仓库返回 null
 */
export function trackSnapshot(sessionId: string, step: SnapshotStep, round?: number): SnapshotData | null {
  try {
    const session = getSession(sessionId);
    const projectDir = session?.projectDir ?? process.cwd();
    const resolvedDir = resolve(projectDir);

    // 不在 Git 工作区内，跳过
    if (!isInsideGitWorkTree(resolvedDir)) {
      log.debug(`跳过快照: ${sessionId} 不在 Git 工作区内`);
      return null;
    }

    const files = captureGitStatus(resolvedDir);
    const diffSummary = captureGitDiff(resolvedDir);

    const snapshot: SnapshotData = {
      createdAt: Date.now(),
      diffSummary,
      files,
      round,
      sessionId,
      step,
    };

    // 存储快照
    let sessionSnapshots = snapshotStore.get(sessionId);
    if (!sessionSnapshots) {
      sessionSnapshots = new Map();
      snapshotStore.set(sessionId, sessionSnapshots);
    }
    sessionSnapshots.set(step, snapshot);

    log.debug(`快照已捕获: ${sessionId} ${step} (${files.length} 个文件变更)`);
    return snapshot;
  } catch (error) {
    log.warn(`快照捕获失败: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 获取指定会话和步骤的快照。
 *
 * @param sessionId 会话 ID
 * @param step 快照步骤
 * @returns 快照数据，不存在返回 null
 */
export function getSnapshot(sessionId: string, step: SnapshotStep): SnapshotData | null {
  const sessionSnapshots = snapshotStore.get(sessionId);
  if (!sessionSnapshots) {
    return null;
  }
  return sessionSnapshots.get(step) ?? null;
}

/**
 * 比较两个快照的差异。
 *
 * @param before before 快照
 * @param after after 快照
 * @returns 差异结果
 */
export function diffSnapshots(before: SnapshotData | null, after: SnapshotData | null): SnapshotDiff {
  const empty: SnapshotDiff = {
    addedCount: 0,
    changed: [],
    deletedCount: 0,
    modifiedCount: 0,
    onlyInAfter: [],
    onlyInBefore: [],
    unchanged: [],
  };

  if (!before && !after) {
    return empty;
  }

  if (!before) {
    return {
      ...empty,
      addedCount: after!.files.filter((f) => f.isNew).length,
      modifiedCount: after!.files.filter((f) => !f.isNew && !f.isDeleted).length,
      onlyInAfter: after!.files.map((f) => f.path),
    };
  }

  if (!after) {
    return {
      ...empty,
      deletedCount: before.files.filter((f) => f.isNew).length,
      onlyInBefore: before.files.map((f) => f.path),
    };
  }

  const beforeMap = new Map(before.files.map((f) => [f.path, f]));
  const afterMap = new Map(after.files.map((f) => [f.path, f]));

  const onlyInBefore: string[] = [];
  const onlyInAfter: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  // 检查 before 中的文件
  for (const [path, beforeFile] of beforeMap) {
    const afterFile = afterMap.get(path);
    if (!afterFile) {
      onlyInBefore.push(path);
    } else if (afterFile.status !== beforeFile.status) {
      changed.push(path);
    } else {
      unchanged.push(path);
    }
  }

  // 检查 after 中新增的文件
  for (const [path] of afterMap) {
    if (!beforeMap.has(path)) {
      onlyInAfter.push(path);
    }
  }

  return {
    addedCount: onlyInAfter.length,
    changed,
    deletedCount: onlyInBefore.length,
    modifiedCount: changed.length,
    onlyInAfter,
    onlyInBefore,
    unchanged,
  };
}

/**
 * 清除指定会话的所有快照。
 *
 * @param sessionId 会话 ID
 */
export function clearSnapshots(sessionId: string): void {
  snapshotStore.delete(sessionId);
}

/**
 * 捕获 Git 状态(git status --porcelain)。
 */
function captureGitStatus(projectDir: string): FileChange[] {
  try {
    const output = execFileSync("git", ["-C", projectDir, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();

    if (!output) {
      return [];
    }

    return output.split("\n").map((line) => {
      // porcelain 格式: XY filename
      // X = staged status, Y = working tree status
      const status = line.slice(0, 2).trim();
      const path = line.slice(3).trim().replace(/^"|"$/g, "");
      return {
        isNew: status === "??" || status === "A",
        isDeleted: status === "D",
        path,
        status,
      };
    });
  } catch (error) {
    log.debug(`git status 捕获失败: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * 捕获 Git diff 摘要(git diff --stat)。
 * 截断到 5000 字符避免内存占用过大。
 */
function captureGitDiff(projectDir: string): string {
  try {
    const output = execFileSync("git", ["-C", projectDir, "diff", "--stat"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();

    if (!output) {
      return "";
    }

    // 截断到 5000 字符
    return output.length > 5000 ? `${output.slice(0, 5000)}\n... (截断)` : output;
  } catch (error) {
    log.debug(`git diff 捕获失败: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

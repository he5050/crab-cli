/**
 * 压缩分支点管理模块
 *
 * 职责:
 *   - 保存压缩时的分支点元数据到磁盘
 *   - 读取和列出历史分支点
 *   - 为跨会话回滚提供数据基础
 *
 * 边界:
 *   - 仅处理分支点存储，不处理回滚逻辑
 *   - 分支点 ID 全局唯一(sessionId + compactionIndex + timestamp)
 *   - 存储路径:.crab/branch-points/*.json
 */

import fs from "fs/promises";
import path from "path";
import { createLogger } from "@/core/logging/logger";
import { nonce } from "@/core/id";
import type { ModelMessage } from "ai";

const log = createLogger("rollback:branchPoints");

const BRANCH_POINTS_DIR = ".crab/branch-points";

/** 类型安全地检测 ENOENT 错误（替代 `as any`） */
function isEnoent(error: unknown): error is { code: "ENOENT" } {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT";
}

// ── 类型定义 ─────────────────────────────────────────────────────

/** 压缩分支点:记录压缩前后的完整状态 */
export interface CompactionBranchPoint {
  id: string;
  sessionId: string;
  compactionIndex: number;
  timestamp: number;

  beforeState: {
    /** 压缩前完整上下文。旧分支点可能只保存被压缩片段，恢复时需要校验。 */
    messages: ModelMessage[];
    /** 被压缩的旧消息片段，仅用于审计/展示。 */
    compressedMessages?: ModelMessage[];
    rollbackEntries: string[];
    splitIndex: number;
  };

  afterState: {
    messages: ModelMessage[];
    summary: string;
  };

  metadata: {
    totalTokensBefore: number;
    totalTokensAfter: number;
    compressionRatio: number;
    originalSessionId?: string;
    preCompressionCheckpointId?: string;
  };
}

// ── 公共 API ─────────────────────────────────────────────────────

/**
 * 保存分支点到磁盘
 * @param bp - 分支点数据
 */
export async function saveBranchPoint(bp: CompactionBranchPoint): Promise<void> {
  const dir = path.join(process.cwd(), BRANCH_POINTS_DIR);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${bp.sessionId}-${bp.compactionIndex}.json`;
  const filepath = path.join(dir, filename);

  try {
    await fs.writeFile(filepath, JSON.stringify(bp, null, 2), "utf8");
    log.debug(`分支点已保存: ${bp.id}`);
  } catch (error) {
    log.warn(`保存分支点失败: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 根据 ID 读取分支点
 * @param id - 分支点 ID
 * @returns 分支点数据，不存在时返回 null
 */
export async function loadBranchPoint(id: string): Promise<CompactionBranchPoint | null> {
  const dir = path.join(process.cwd(), BRANCH_POINTS_DIR);

  try {
    const files = await fs.readdir(dir);

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const content = await fs.readFile(path.join(dir, file), "utf8");
      const bp = JSON.parse(content) as CompactionBranchPoint;

      if (bp.id === id) {
        log.debug(`加载分支点: ${id}`);
        return bp;
      }
    }

    log.debug(`分支点不存在: ${id}`);
    return null;
  } catch (error) {
    if (isEnoent(error)) {
      log.debug("分支点目录不存在");
      return null;
    }
    log.warn(`加载分支点失败: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 列出所有分支点(按时间倒序)
 * @param sessionId - 可选会话 ID 过滤
 * @returns 分支点数组
 */
export async function listBranchPoints(sessionId?: string): Promise<CompactionBranchPoint[]> {
  const dir = path.join(process.cwd(), BRANCH_POINTS_DIR);

  try {
    const files = await fs.readdir(dir);
    const points: CompactionBranchPoint[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const content = await fs.readFile(path.join(dir, file), "utf8");
      const bp = JSON.parse(content) as CompactionBranchPoint;

      if (!sessionId || bp.sessionId === sessionId) {
        points.push(bp);
      }
    }

    // 按时间倒序排序
    points.sort((a, b) => b.timestamp - a.timestamp);

    log.debug(`列出 ${points.length} 个分支点${sessionId ? ` (会话: ${sessionId})` : ""}`);
    return points;
  } catch (error) {
    if (isEnoent(error)) {
      log.debug("分支点目录不存在，返回空列表");
      return [];
    }
    log.warn(`列出分支点失败: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 生成分支点唯一 ID
 * @param sessionId - 会话 ID
 * @param compactionIndex - 压缩索引
 * @returns 唯一 ID 字符串
 */
/** generateBranchPointId 的实现 */
export function generateBranchPointId(sessionId: string, compactionIndex: number): string {
  return `bp-${sessionId}-${compactionIndex}-${nonce()}`;
}

/**
 * 删除指定分支点
 * @param id - 分支点 ID
 * @returns 是否成功删除
 */
export async function deleteBranchPoint(id: string): Promise<boolean> {
  const dir = path.join(process.cwd(), BRANCH_POINTS_DIR);

  try {
    const files = await fs.readdir(dir);

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const filepath = path.join(dir, file);
      const content = await fs.readFile(filepath, "utf8");
      const bp = JSON.parse(content) as CompactionBranchPoint;

      if (bp.id === id) {
        await fs.unlink(filepath);
        log.debug(`删除分支点: ${id}`);
        return true;
      }
    }

    log.debug(`分支点不存在，无法删除: ${id}`);
    return false;
  } catch (error) {
    if (isEnoent(error)) {
      log.debug("分支点目录不存在");
      return false;
    }
    log.warn(`删除分支点失败: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * 清理旧分支点(超过指定天数)
 */
export async function cleanupOldBranchPoints(daysToKeep: number): Promise<number> {
  const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const dir = path.join(process.cwd(), BRANCH_POINTS_DIR);

  try {
    const files = await fs.readdir(dir);
    let deletedCount = 0;

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const filepath = path.join(dir, file);
      const content = await fs.readFile(filepath, "utf8");
      const bp = JSON.parse(content) as CompactionBranchPoint;

      if (bp.timestamp < cutoffTime) {
        await fs.unlink(filepath);
        deletedCount++;
        log.debug(`清理旧分支点: ${bp.id} (${new Date(bp.timestamp).toISOString()})`);
      }
    }

    log.info(`清理了 ${deletedCount} 个旧分支点 (保留 ${daysToKeep} 天内)`);
    return deletedCount;
  } catch (error) {
    if (isEnoent(error)) {
      return 0;
    }
    log.warn(`清理分支点失败: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

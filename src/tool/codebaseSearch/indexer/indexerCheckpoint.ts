import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";

/** 索引进度回调 */
export interface IndexProgress {
  /** 阶段 */
  phase: "scanning" | "indexing" | "embedding" | "complete";
  /** 当前文件 */
  currentFile?: string;
  /** 已处理文件数 */
  filesProcessed: number;
  /** 总文件数 */
  filesTotal: number;
  /** 已生成分块数 */
  chunksGenerated: number;
}

/** 索引检查点(断点续索引) */
export interface IndexCheckpoint {
  status: "in_progress" | "completed" | "failed";
  phase: IndexProgress["phase"];
  filesTotal: number;
  filesProcessed: number;
  currentFile?: string;
  chunksGenerated: number;
  symbolsGenerated: number;
  processedFileList: string[];
  failedFiles?: number;
  consecutiveFailures?: number;
  lastError?: string;
  updatedAt: string;
}

/** 检查点持久化接口，抽象文件系统和 VectorDb 两种存储 */
export type CheckpointStateDb = Pick<VectorDb, "saveIndexCheckpoint" | "loadIndexCheckpoint" | "clearIndexCheckpoint">;

/** 获取索引检查点文件的路径 */
export function getCheckpointPath(rootDir: string): string {
  return join(rootDir, ".crab", "index-checkpoint.json");
}

/** 保存索引检查点到文件系统（可选同步到 stateDb） */
export function saveCheckpoint(rootDir: string, data: IndexCheckpoint, stateDb?: CheckpointStateDb): void {
  const dir = join(rootDir, ".crab");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const json = JSON.stringify(data, null, 2);
  writeFileSync(getCheckpointPath(rootDir), json, "utf8");
  stateDb?.saveIndexCheckpoint(rootDir, json, data.status, data.updatedAt);
}

/** 加载索引检查点，优先从文件系统读取，回退到 stateDb */
export function loadCheckpoint(rootDir: string, stateDb?: CheckpointStateDb): IndexCheckpoint | null {
  try {
    const filePath = getCheckpointPath(rootDir);
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, "utf8"));
      if (isRecoverableCheckpoint(data)) {
        return data;
      }
      return null;
    }
    const stored = stateDb?.loadIndexCheckpoint(rootDir);
    if (!stored) {
      return null;
    }
    const data = JSON.parse(stored.checkpointJson);
    if (isRecoverableCheckpoint(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/** 清除索引检查点（文件系统和 stateDb 双清理） */
export function clearCheckpoint(rootDir: string, stateDb?: CheckpointStateDb): void {
  try {
    const filePath = getCheckpointPath(rootDir);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    /* Ignore */
  }
  try {
    stateDb?.clearIndexCheckpoint(rootDir);
  } catch {
    /* Ignore */
  }
}

/** 仅从 stateDb (SQLite) 加载索引检查点 */
export function loadCheckpointFromSqlite(rootDir: string, stateDb: CheckpointStateDb): IndexCheckpoint | null {
  try {
    const stored = stateDb.loadIndexCheckpoint(rootDir);
    if (!stored) {
      return null;
    }
    const data = JSON.parse(stored.checkpointJson);
    if (isRecoverableCheckpoint(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

function isRecoverableCheckpoint(data: unknown): data is IndexCheckpoint {
  if (!data || typeof data !== "object") {
    return false;
  }
  const checkpoint = data as Partial<IndexCheckpoint>;
  return Boolean(checkpoint.status) && checkpoint.status !== "completed" && Array.isArray(checkpoint.processedFileList);
}

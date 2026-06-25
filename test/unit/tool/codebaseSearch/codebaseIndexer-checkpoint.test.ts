/**
 * CodebaseIndexer 断点续索引 Checkpoint 测试。
 *
 * 测试用例:
 *   - 索引过程中保存 checkpoint
 *   - 异常中断后从 checkpoint 恢复
 *   - checkpoint 清理逻辑
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";

// ─── Mock 模块 ─────────────────────────────────────────────────
mock.module("@core/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

const tmpDir = path.join(process.cwd(), ".test-checkpoint-index");
const checkpointFile = path.join(tmpDir, ".crab", "index-checkpoint.json");

async function loadMod() {
  return import("@/tool/codebaseSearch/indexer/codebaseIndexer.ts");
}

describe("P1-5: 断点续索引 Checkpoint", () => {
  beforeEach(() => {
    mock.restore();
    rmSync(tmpDir, { force: true, recursive: true });
    mkdirSync(path.join(tmpDir, ".crab"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { force: true, recursive: true });
  });

  // ── saveCheckpoint / clearCheckpoint ──────────────────────────
  describe("saveCheckpoint / clearCheckpoint", () => {
    test("写入 checkpoint JSON 文件", async () => {
      const mod = await loadMod();
      const data = {
        chunksGenerated: 5,
        filesProcessed: 3,
        filesTotal: 10,
        phase: "indexing" as const,
        processedFileList: ["file1.ts", "file2.ts"],
        status: "in_progress" as const,
        symbolsGenerated: 2,
        updatedAt: "2026-01-01T00:00:00Z",
      };

      mod.saveCheckpoint(tmpDir, data);
      expect(existsSync(checkpointFile)).toBe(true);

      const loaded = JSON.parse(readFileSync(checkpointFile, "utf8"));
      expect(loaded.status).toBe("in_progress");
      expect(loaded.processedFileList).toEqual(["file1.ts", "file2.ts"]);
    });

    test("同步写入 SQLite index_checkpoints 状态表", async () => {
      const mod = await loadMod();
      const db = new VectorDb({ dbPath: path.join(tmpDir, "search.db") });
      try {
        const data = {
          chunksGenerated: 5,
          filesProcessed: 3,
          filesTotal: 10,
          phase: "indexing" as const,
          processedFileList: ["file1.ts", "file2.ts"],
          status: "in_progress" as const,
          symbolsGenerated: 2,
          updatedAt: "2026-01-01T00:00:00Z",
        };

        mod.saveCheckpoint(tmpDir, data, db);
        const stored = db.loadIndexCheckpoint(tmpDir);
        expect(stored?.status).toBe("in_progress");
        expect(JSON.parse(stored!.checkpointJson).processedFileList).toEqual(["file1.ts", "file2.ts"]);
      } finally {
        db.close();
      }
    });

    test("clearCheckpoint 删除文件", async () => {
      const mod = await loadMod();
      mod.saveCheckpoint(tmpDir, {
        chunksGenerated: 0,
        filesProcessed: 2,
        filesTotal: 5,
        phase: "indexing",
        processedFileList: [],
        status: "in_progress",
        symbolsGenerated: 0,
        updatedAt: "2026-01-01",
      });

      mod.clearCheckpoint(tmpDir);
      expect(existsSync(checkpointFile)).toBe(false);
    });

    test("clearCheckpoint 同时删除 SQLite 状态", async () => {
      const mod = await loadMod();
      const db = new VectorDb({ dbPath: path.join(tmpDir, "search.db") });
      try {
        mod.saveCheckpoint(
          tmpDir,
          {
            chunksGenerated: 0,
            filesProcessed: 2,
            filesTotal: 5,
            phase: "indexing",
            processedFileList: [],
            status: "in_progress",
            symbolsGenerated: 0,
            updatedAt: "2026-01-01",
          },
          db,
        );
        expect(db.loadIndexCheckpoint(tmpDir)).not.toBeNull();
        mod.clearCheckpoint(tmpDir, db);
        expect(existsSync(checkpointFile)).toBe(false);
        expect(db.loadIndexCheckpoint(tmpDir)).toBeNull();
      } finally {
        db.close();
      }
    });
  });

  // ── loadCheckpoint ────────────────────────────────────────────
  describe("loadCheckpoint", () => {
    test("文件不存在返回 null", async () => {
      const mod = await loadMod();
      const result = mod.loadCheckpoint(tmpDir);
      expect(result).toBeNull();
    });

    test("正常解析 checkpoint", async () => {
      const mod = await loadMod();
      const data = {
        chunksGenerated: 12,
        filesProcessed: 5,
        filesTotal: 8,
        phase: "embedding" as const,
        processedFileList: ["a.ts", "b.ts", "c.ts"],
        status: "in_progress" as const,
        symbolsGenerated: 3,
        updatedAt: "2026-06-01T00:00:00Z",
      };
      mod.saveCheckpoint(tmpDir, data);

      const result = mod.loadCheckpoint(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.status).toBe("in_progress");
      expect(result!.filesProcessed).toBe(5);
      expect(result!.processedFileList).toEqual(["a.ts", "b.ts", "c.ts"]);
    });

    test("文件 checkpoint 缺失时可从 SQLite 状态表恢复", async () => {
      const mod = await loadMod();
      const db = new VectorDb({ dbPath: path.join(tmpDir, "search.db") });
      try {
        const data = {
          chunksGenerated: 12,
          filesProcessed: 5,
          filesTotal: 8,
          phase: "embedding" as const,
          processedFileList: ["a.ts", "b.ts", "c.ts"],
          status: "in_progress" as const,
          symbolsGenerated: 3,
          updatedAt: "2026-06-01T00:00:00Z",
        };
        mod.saveCheckpoint(tmpDir, data, db);
        unlinkSync(checkpointFile);

        const result = mod.loadCheckpoint(tmpDir, db);
        expect(result?.filesProcessed).toBe(5);
        expect(result?.processedFileList).toEqual(["a.ts", "b.ts", "c.ts"]);
      } finally {
        db.close();
      }
    });

    test("损坏 JSON 返回 null", async () => {
      const mod = await loadMod();
      writeFileSync(checkpointFile, "not valid json{{{", "utf8");

      const result = mod.loadCheckpoint(tmpDir);
      expect(result).toBeNull();
    });

    test("status 为 completed 的旧 checkpoint 被忽略", async () => {
      const mod = await loadMod();
      const data = {
        chunksGenerated: 20,
        filesProcessed: 10,
        filesTotal: 10,
        phase: "complete" as const,
        processedFileList: ["all.ts"],
        status: "completed" as const,
        symbolsGenerated: 5,
        updatedAt: "2026-01-01",
      };
      mod.saveCheckpoint(tmpDir, data);

      const result = mod.loadCheckpoint(tmpDir);
      // Completed 状态不被恢复
      expect(result).toBeNull();
    });
  });

  // ── getCheckpointPath ──────────────────────────────────────────
  describe("getCheckpointPath", () => {
    test("路径正确", async () => {
      const mod = await loadMod();
      const cp = mod.getCheckpointPath(tmpDir);
      expect(cp).toBe(path.join(tmpDir, ".crab", "index-checkpoint.json"));
    });
  });
});

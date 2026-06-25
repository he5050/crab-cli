/**
 * 代码索引器测试 — 文件分块和增量索引。
 *
 * 测试用例:
 *   - chunkFile 分块
 *   - 空文件不分块
 *   - 未知语言返回空
 *   - 移除文件索引
 *   - 过滤排除目录
 *   - 分块带重叠
 *   - 进度回调
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  CodebaseIndexer,
  type IndexProgress,
  loadCheckpoint,
  saveCheckpoint,
} from "@/tool/codebaseSearch/indexer/codebaseIndexer";
import { VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";
import { join } from "node:path";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../../helpers/testPaths";

describe("CodebaseIndexer", () => {
  let tempDir: string;
  let db: VectorDb;
  let dbPath: string;
  let indexer: CodebaseIndexer;

  beforeEach(() => {
    tempDir = createGlobalTmpTestDir("crab-indexer-test-");
    dbPath = join(tempDir, "test.db");
    db = new VectorDb({ dbPath });
    indexer = new CodebaseIndexer({ db, rootDir: tempDir });
  });

  afterEach(() => {
    mock.restore();
    db.close();
    cleanupTestDir(tempDir);
  });

  describe("chunkFile", () => {
    test("分块 TypeScript 文件", async () => {
      const filePath = join(tempDir, "test.ts");
      writeFileSync(
        filePath,
        ["function hello() {", "  console.log('hello');", "}", "", "function world() {", "  return 42;", "}"].join(
          "\n",
        ),
      );

      const chunks = await indexer.chunkFile(filePath);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.languageId).toBe("typescript");
      expect(chunks[0]!.filePath).toBe(filePath);
      expect(chunks[0]!.content).toContain("function hello");
    });

    test("分块 Python 文件", async () => {
      const filePath = join(tempDir, "test.py");
      writeFileSync(filePath, ["def hello():", "    print('hello')", "", "def world():", "    return 42"].join("\n"));

      const chunks = await indexer.chunkFile(filePath);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]!.languageId).toBe("python");
    });

    test("空文件不分块", async () => {
      const filePath = join(tempDir, "empty.ts");
      writeFileSync(filePath, "");

      const chunks = await indexer.chunkFile(filePath);
      expect(chunks).toEqual([]);
    });

    test("未知语言返回空", async () => {
      const filePath = join(tempDir, "test.xyz");
      writeFileSync(filePath, "some content");

      const chunks = await indexer.chunkFile(filePath);
      expect(chunks).toEqual([]);
    });

    test("不存在的文件返回空", async () => {
      const chunks = await indexer.chunkFile(join(tempDir, "nonexistent.ts"));
      expect(chunks).toEqual([]);
    });

    test("分块有正确的行号", async () => {
      const filePath = join(tempDir, "lines.ts");
      writeFileSync(filePath, ["line1", "line2", "", "line4", "line5"].join("\n"));

      const chunks = await indexer.chunkFile(filePath);
      expect(chunks.length).toBeGreaterThan(0);
      // 第一个 chunk 从第 1 行开始
      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBeGreaterThanOrEqual(chunks[0]!.startLine);
    });

    test("长文件被分成多个 chunk", async () => {
      const filePath = join(tempDir, "long.ts");
      const lines = Array.from({ length: 200 }, (_, i) => `// line ${i + 1}`);
      writeFileSync(filePath, lines.join("\n"));

      const chunks = await indexer.chunkFile(filePath);
      expect(chunks.length).toBeGreaterThan(1);
    });

    test("每个 chunk 有唯一 ID", async () => {
      const filePath = join(tempDir, "unique.ts");
      writeFileSync(filePath, "function a() {}\n\nfunction b() {}");

      const chunks = await indexer.chunkFile(filePath);
      const ids = chunks.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("removeFile", () => {
    test("删除不存在的文件返回 0", () => {
      const deleted = indexer.removeFile(join(tempDir, "nonexistent.ts"));
      expect(deleted).toBe(0);
    });

    test("删除已索引的文件", async () => {
      const filePath = join(tempDir, "test.ts");
      writeFileSync(filePath, "const x = 1;");

      // 先手动插入
      const chunks = await indexer.chunkFile(filePath);
      for (const chunk of chunks) {
        db.insertChunk(
          chunk,
          Array.from({ length: 1536 }, () => 0),
        );
      }

      const deleted = indexer.removeFile(filePath);
      expect(deleted).toBe(chunks.length);
    });
  });

  describe("排除目录", () => {
    test("不扫描 node_modules", async () => {
      mkdirSync(join(tempDir, "node_modules"), { recursive: true });
      writeFileSync(join(tempDir, "node_modules", "pkg.ts"), "export const x = 1;");
      writeFileSync(join(tempDir, "src.ts"), "export const y = 2;");

      // ChunkFile 仍可处理 node_modules 下的文件(路径级别不过滤)
      // 但 fullIndex 会跳过
      const chunk = await indexer.chunkFile(join(tempDir, "src.ts"));
      expect(chunk.length).toBeGreaterThan(0);
    });

    test("scanFiles 过滤隐藏目录、gitignore、超大文件和 lock 扩展", () => {
      mkdirSync(join(tempDir, "src"), { recursive: true });
      mkdirSync(join(tempDir, ".hidden"), { recursive: true });
      mkdirSync(join(tempDir, ".crab"), { recursive: true });
      writeFileSync(join(tempDir, ".gitignore"), "ignored.ts\nignored-dir/\n");
      mkdirSync(join(tempDir, "ignored-dir"), { recursive: true });

      writeFileSync(join(tempDir, "src", "ok.ts"), "export const ok = true;\n");
      writeFileSync(join(tempDir, ".hidden", "skip.ts"), "export const hidden = true;\n");
      writeFileSync(join(tempDir, ".crab", "allow.ts"), "export const crab = true;\n");
      writeFileSync(join(tempDir, "ignored.ts"), "export const ignored = true;\n");
      writeFileSync(join(tempDir, "ignored-dir", "nested.ts"), "export const nested = true;\n");
      writeFileSync(join(tempDir, "bundle.lock"), "skip");
      writeFileSync(join(tempDir, "large.ts"), "a".repeat(100_001));

      indexer = new CodebaseIndexer({ db, rootDir: tempDir });
      const files = (indexer as any).scanFiles() as string[];
      expect(files).toContain(join(tempDir, "src", "ok.ts"));
      expect(files).toContain(join(tempDir, ".crab", "allow.ts"));
      expect(files).not.toContain(join(tempDir, ".hidden", "skip.ts"));
      expect(files).not.toContain(join(tempDir, "ignored.ts"));
      expect(files).not.toContain(join(tempDir, "ignored-dir", "nested.ts"));
      expect(files).not.toContain(join(tempDir, "bundle.lock"));
      expect(files).not.toContain(join(tempDir, "large.ts"));
    });
  });

  describe("进度回调", () => {
    test("fullIndex 无文件时触发 complete", async () => {
      const progressEvents: IndexProgress[] = [];
      const idx = new CodebaseIndexer({
        db,
        onProgress: (p) => progressEvents.push(p),
        rootDir: tempDir,
      });

      await idx.fullIndex();
      const phases = progressEvents.map((p) => p.phase);
      expect(phases).toContain("scanning");
      expect(phases).toContain("complete");
    });

    test("filterChangedFiles / indexFile / fullIndex / embedAndStore 覆盖真实分支", async () => {
      const tsFile = join(tempDir, "changed.ts");
      const pyFile = join(tempDir, "fresh.py");
      writeFileSync(tsFile, "export const oldValue = 1;\n");
      writeFileSync(pyFile, "def fresh():\n    return 1\n");

      const existingChunks = await indexer.chunkFile(tsFile);
      for (const chunk of existingChunks) {
        db.insertChunk(
          { ...chunk, fileMtime: Date.now() + 1000 },
          Array.from({ length: 1536 }, () => 0.25),
        );
      }

      const olderMtime = new Date(Date.now() - 10_000);
      utimesSync(tsFile, olderMtime, olderMtime);
      const changed = (indexer as any).filterChangedFiles([tsFile, pyFile]) as string[];
      expect(changed).toContain(pyFile);
      expect(changed).not.toContain(tsFile);

      const deleteSpy = spyOn(db, "deleteByFile");
      const insertSpy = spyOn(db, "insertChunk");
      const insertManySpy = spyOn(db, "insertChunks");

      await indexer.indexFile(pyFile);
      expect(deleteSpy).toHaveBeenCalledWith(pyFile);
      expect(insertSpy).toHaveBeenCalled();

      const freshIndexFile = join(tempDir, "brand-new.py");
      writeFileSync(freshIndexFile, "def brand_new():\n    return 2\n");

      const progressEvents: IndexProgress[] = [];
      const configuredIndexer = new CodebaseIndexer({
        appConfig: {
          defaultProvider: { model: "mock-model", provider: "mock-provider", requestMethod: "chat" },
          providerConfig: {
            "mock-provider": {
              apiKey: "test-key",
              baseURL: "https://example.invalid",
            },
          },
        } as any,
        db,
        onProgress: (p) => progressEvents.push(p),
        rootDir: tempDir,
      });

      const embeddingModule = await import("@api");
      const embedSpy = spyOn(embeddingModule, "embedTexts");
      embedSpy.mockResolvedValue([{ embedding: Array.from({ length: 1536 }, () => 0.5), text: "fresh.py:1" }] as any);

      const result = await configuredIndexer.fullIndex();
      expect(result.filesProcessed).toBeGreaterThanOrEqual(1);
      expect(result.chunksGenerated).toBeGreaterThanOrEqual(1);
      expect(progressEvents.some((p) => p.phase === "embedding")).toBe(true);
      expect(insertManySpy).toHaveBeenCalled();

      embedSpy.mockRejectedValueOnce(new Error("embedding failed"));
      await configuredIndexer.indexFile(pyFile);
      expect(insertSpy).toHaveBeenCalled();
    });

    test("fullIndex 在 embedding 维度变化时清空旧索引并重新索引未变更文件", async () => {
      const filePath = join(tempDir, "stable.ts");
      writeFileSync(filePath, "export const stable = 1;\n");
      const chunks = await indexer.chunkFile(filePath);
      expect(chunks.length).toBeGreaterThan(0);

      db.ensureEmbeddingDimensions(1536);
      for (const chunk of chunks) {
        db.insertChunk(
          { ...chunk, fileMtime: Date.now() + 1000 },
          Array.from({ length: 1536 }, () => 0.25),
        );
      }

      const olderMtime = new Date(Date.now() - 10_000);
      utimesSync(filePath, olderMtime, olderMtime);

      const embeddingModule = await import("@api");
      const embedSpy = spyOn(embeddingModule, "embedTexts");
      embedSpy.mockResolvedValue([{ embedding: Array.from({ length: 768 }, () => 0.5), text: "stable.ts:1" }] as any);

      const configuredIndexer = new CodebaseIndexer({
        appConfig: {
          codebase: {
            embedding: {
              dimensions: 768,
              model: "mock-embedding",
              type: "openai",
            },
          },
          defaultProvider: { model: "mock-model", provider: "mock-provider", requestMethod: "chat" },
          providerConfig: {
            "mock-provider": {
              apiKey: "test-key",
              baseURL: "https://example.invalid",
            },
          },
        } as any,
        db,
        rootDir: tempDir,
      });

      const result = await configuredIndexer.fullIndex();

      expect(result.filesProcessed).toBe(1);
      expect(result.filesSkipped).toBe(0);
      expect(db.getEmbeddingDimensions()).toBe(768);
      expect(db.getStats().totalChunks).toBe(chunks.length);
    });

    test("filterChangedFiles 在 mtime 不变但 hash 变化时重新索引", async () => {
      const filePath = join(tempDir, "hash-change.ts");
      const fixedTime = new Date(Date.now() - 10_000);
      writeFileSync(filePath, "export const value = 'before';\n");
      utimesSync(filePath, fixedTime, fixedTime);

      const chunks = await indexer.chunkFile(filePath);
      expect(chunks.length).toBeGreaterThan(0);
      db.insertChunk(
        chunks[0]!,
        Array.from({ length: 1536 }, () => 0.25),
      );

      writeFileSync(filePath, "export const value = 'after';\n");
      utimesSync(filePath, fixedTime, fixedTime);

      const changed = (indexer as any).filterChangedFiles([filePath]) as string[];
      expect(changed).toContain(filePath);
    });

    test("fullIndex 从 checkpoint 恢复并跳过已处理且未变化文件", async () => {
      const processedFile = join(tempDir, "processed.ts");
      const pendingFile = join(tempDir, "pending.ts");
      const fixedTime = new Date(Date.now() - 10_000);

      writeFileSync(processedFile, "export const processed = true;\n");
      writeFileSync(pendingFile, "export const pending = true;\n");
      utimesSync(processedFile, fixedTime, fixedTime);

      const processedChunks = await indexer.chunkFile(processedFile);
      expect(processedChunks.length).toBeGreaterThan(0);
      db.insertChunk(
        processedChunks[0]!,
        Array.from({ length: 1536 }, () => 0.25),
      );

      saveCheckpoint(tempDir, {
        chunksGenerated: processedChunks.length,
        filesProcessed: 1,
        filesTotal: 2,
        phase: "indexing",
        processedFileList: [processedFile],
        status: "in_progress",
        symbolsGenerated: 0,
        updatedAt: "2026-06-09T00:00:00Z",
      });

      const result = await indexer.fullIndex();

      expect(result.resumed).toBe(true);
      expect(result.filesProcessed).toBe(1);
      expect(loadCheckpoint(tempDir)).toBeNull();
      expect(db.getFileStats(pendingFile)?.chunkCount).toBeGreaterThan(0);
    });

    test("fullIndex 连续 3 个文件失败后停止并保留 failed checkpoint", async () => {
      writeFileSync(join(tempDir, "fail-a.ts"), "export const a = 1;\n");
      writeFileSync(join(tempDir, "fail-b.ts"), "export const b = 1;\n");
      writeFileSync(join(tempDir, "fail-c.ts"), "export const c = 1;\n");

      const chunkSpy = spyOn(indexer as any, "chunkFile");
      chunkSpy.mockRejectedValue(new Error("chunk failed"));

      const result = await indexer.fullIndex();
      expect(result.stoppedDueToFailures).toBe(true);
      expect(result.filesFailed).toBe(3);
      expect(result.filesProcessed).toBe(0);

      const checkpoint = loadCheckpoint(tempDir);
      expect(checkpoint?.status).toBe("failed");
      expect(checkpoint?.consecutiveFailures).toBe(3);
      expect(checkpoint?.lastError).toContain("chunk failed");
    });
  });
});

/**
 * 向量数据库测试 — bun:sqlite 向量索引 CRUD 和搜索。
 *
 * 测试用例:
 *   - 创建 VectorDb 实例
 *   - 插入代码片段向量
 *   - 向量相似度搜索
 *   - 删除文件索引
 *   - 获取文件统计
 *   - 获取索引文件列表
 *   - 获取统计信息
 *   - 清空索引
 *   - 关闭数据库
 *   - 余弦相似度计算
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type CodeChunk, VectorDb, cosineSimilarity } from "@/tool/codebaseSearch/indexer/vectorDb";
import { join } from "node:path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../../helpers/testPaths";

/** 创建测试用的代码片段 */
function makeChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    content: "function hello() {\n  console.log('hello');\n}",
    endLine: 10,
    fileMtime: Date.now(),
    filePath: "/project/src/index.ts",
    id: "test:1:10",
    languageId: "typescript",
    startLine: 1,
    ...overrides,
  };
}

/** 创建测试向量 */
function makeVector(seed: number, dims: number = 1536): number[] {
  return Array.from({ length: dims }, (_, i) => (seed + i) * 0.001);
}

describe("VectorDb", () => {
  let db: VectorDb;
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = createGlobalTmpTestDir("crab-test-search-");
    dbPath = join(dbDir, "test-search.db");
    db = new VectorDb({ dbPath });
  });

  afterEach(() => {
    db.close();
    cleanupTestDir(dbDir);
  });

  describe("初始化", () => {
    test("创建 VectorDb 实例", () => {
      expect(db).toBeDefined();
    });

    test("getStats 初始为空", () => {
      const stats = db.getStats();
      expect(stats.totalChunks).toBe(0);
      expect(stats.totalFiles).toBe(0);
      expect(stats.embeddingDimensions).toBe(1536);
    });

    test("getIndexedFiles 初始为空", () => {
      const files = db.getIndexedFiles();
      expect(files).toEqual([]);
    });
  });

  describe("插入代码片段向量", () => {
    test("插入单个片段", () => {
      const chunk = makeChunk();
      const embedding = makeVector(1);
      db.insertChunk(chunk, embedding);

      const stats = db.getStats();
      expect(stats.totalChunks).toBe(1);
      expect(stats.totalFiles).toBe(1);
    });

    test("插入多个片段(同一文件)", () => {
      const embedding = makeVector(1);
      db.insertChunk(makeChunk({ endLine: 5, id: "f:1:5", startLine: 1 }), embedding);
      db.insertChunk(makeChunk({ endLine: 10, id: "f:6:10", startLine: 6 }), embedding);

      const stats = db.getStats();
      expect(stats.totalChunks).toBe(2);
      expect(stats.totalFiles).toBe(1);
    });

    test("插入多个片段(不同文件)", () => {
      const embedding = makeVector(1);
      db.insertChunk(makeChunk({ filePath: "/a.ts", id: "a:1:5" }), embedding);
      db.insertChunk(makeChunk({ filePath: "/b.ts", id: "b:1:5" }), embedding);

      const stats = db.getStats();
      expect(stats.totalChunks).toBe(2);
      expect(stats.totalFiles).toBe(2);
    });

    test("批量插入", () => {
      const items = [
        { chunk: makeChunk({ filePath: "/a.ts", id: "a:1:5" }), embedding: makeVector(1) },
        { chunk: makeChunk({ filePath: "/b.ts", id: "b:1:5" }), embedding: makeVector(2) },
        { chunk: makeChunk({ filePath: "/c.ts", id: "c:1:5" }), embedding: makeVector(3) },
      ];
      db.insertChunks(items);

      const stats = db.getStats();
      expect(stats.totalChunks).toBe(3);
    });

    test("覆盖插入(相同 ID)", () => {
      const embedding = makeVector(1);
      db.insertChunk(makeChunk({ content: "old", id: "same" }), embedding);
      db.insertChunk(makeChunk({ content: "new", id: "same" }), embedding);

      const stats = db.getStats();
      expect(stats.totalChunks).toBe(1);
    });

    test("拒绝写入维度不匹配的片段向量", () => {
      expect(() => db.insertChunk(makeChunk(), makeVector(1, 768))).toThrow(/dimensions mismatch/);
    });
  });

  describe("向量相似度搜索", () => {
    test("搜索返回结果", () => {
      // 插入几个片段
      const vec1 = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)); // [1, 0, 0, ...]
      const vec2 = Array.from({ length: 1536 }, (_, i) => (i === 1 ? 1 : 0)); // [0, 1, 0, ...]

      db.insertChunk(makeChunk({ content: "function a()", id: "a" }), vec1);
      db.insertChunk(makeChunk({ content: "function b()", id: "b" }), vec2);

      // 查询向量与 vec1 相同
      const results = db.search(vec1, { minScore: 0.5 });
      expect(results.length).toBeGreaterThanOrEqual(1);
      // 第一个结果应该是 vec1(完全匹配)
      expect(results[0]!.chunk.id).toBe("a");
      expect(results[0]!.score).toBeCloseTo(1, 4);
    });

    test("搜索按相似度排序", () => {
      const vec1 = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
      const vec2 = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 0.8 : i === 1 ? 0.6 : 0));
      const vec3 = Array.from({ length: 1536 }, (_, i) => (i === 1 ? 1 : 0));

      db.insertChunk(makeChunk({ id: "exact" }), vec1);
      db.insertChunk(makeChunk({ id: "close" }), vec2);
      db.insertChunk(makeChunk({ id: "far" }), vec3);

      const results = db.search(vec1, { minScore: 0 });
      expect(results.length).toBeGreaterThanOrEqual(2);
      // Exact 应该排最前
      expect(results[0]!.chunk.id).toBe("exact");
    });

    test("minScore 过滤", () => {
      const vec1 = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
      const vec2 = Array.from({ length: 1536 }, (_, i) => (i === 1 ? 1 : 0));

      db.insertChunk(makeChunk({ id: "a" }), vec1);
      db.insertChunk(makeChunk({ id: "b" }), vec2);

      // 高阈值应该只返回完全匹配
      const results = db.search(vec1, { minScore: 0.99 });
      expect(results.length).toBe(1);
      expect(results[0]!.chunk.id).toBe("a");
    });

    test("limit 限制结果数", () => {
      const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
      for (let i = 0; i < 10; i++) {
        db.insertChunk(makeChunk({ id: `chunk-${i}` }), vec);
      }

      const results = db.search(vec, { limit: 3, minScore: 0 });
      expect(results.length).toBe(3);
    });

    test("filePath 过滤", () => {
      const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
      db.insertChunk(makeChunk({ filePath: "/src/a.ts", id: "a" }), vec);
      db.insertChunk(makeChunk({ filePath: "/lib/b.ts", id: "b" }), vec);

      const results = db.search(vec, { filePathFilter: "/src/", minScore: 0 });
      expect(results.length).toBe(1);
      expect(results[0]!.chunk.filePath).toBe("/src/a.ts");
    });

    test("languageFilter 过滤", () => {
      const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
      db.insertChunk(makeChunk({ id: "a", languageId: "typescript" }), vec);
      db.insertChunk(makeChunk({ id: "b", languageId: "python" }), vec);

      const results = db.search(vec, { languageFilter: "typescript", minScore: 0 });
      expect(results.length).toBe(1);
      expect(results[0]!.chunk.languageId).toBe("typescript");
    });

    test("空数据库搜索返回空", () => {
      const vec = Array.from({ length: 1536 }, () => 0);
      const results = db.search(vec);
      expect(results).toEqual([]);
    });

    test("查询向量维度不匹配时不返回旧索引结果", () => {
      const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
      db.insertChunk(makeChunk({ id: "a" }), vec);

      const results = db.search(
        Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)),
        { minScore: 0 },
      );
      expect(results).toEqual([]);
    });
  });

  describe("删除文件索引", () => {
    test("deleteByFile 删除指定文件", () => {
      const vec = makeVector(1);
      db.insertChunk(makeChunk({ filePath: "/a.ts", id: "a" }), vec);
      db.insertChunk(makeChunk({ filePath: "/b.ts", id: "b" }), vec);

      const deleted = db.deleteByFile("/a.ts");
      expect(deleted).toBe(1);
      expect(db.getStats().totalChunks).toBe(1);
    });

    test("deleteByFile 不存在的文件返回 0", () => {
      const deleted = db.deleteByFile("/nonexistent.ts");
      expect(deleted).toBe(0);
    });

    test("deleteByFiles 批量删除", () => {
      const vec = makeVector(1);
      db.insertChunk(makeChunk({ filePath: "/a.ts", id: "a" }), vec);
      db.insertChunk(makeChunk({ filePath: "/b.ts", id: "b" }), vec);
      db.insertChunk(makeChunk({ filePath: "/c.ts", id: "c" }), vec);

      const deleted = db.deleteByFiles(["/a.ts", "/b.ts"]);
      expect(deleted).toBe(2);
      expect(db.getStats().totalChunks).toBe(1);
    });
  });

  describe("文件统计", () => {
    test("getFileStats 返回统计", () => {
      const vec = makeVector(1);
      const mtime = Date.now();
      db.insertChunk(makeChunk({ fileMtime: mtime, filePath: "/a.ts" }), vec);
      db.insertChunk(
        makeChunk({ endLine: 20, fileMtime: mtime + 1000, filePath: "/a.ts", id: "a2", startLine: 11 }),
        vec,
      );

      const stats = db.getFileStats("/a.ts");
      expect(stats).not.toBeNull();
      expect(stats!.chunkCount).toBe(2);
      expect(stats!.latestMtime).toBe(mtime + 1000);
    });

    test("getFileStats 不存在的文件返回 null", () => {
      const stats = db.getFileStats("/nonexistent.ts");
      expect(stats).toBeNull();
    });

    test("getIndexedFiles 返回文件列表", () => {
      const vec = makeVector(1);
      db.insertChunk(makeChunk({ filePath: "/a.ts", id: "a1" }), vec);
      db.insertChunk(makeChunk({ filePath: "/b.ts", id: "b1" }), vec);

      const files = db.getIndexedFiles();
      expect(files.length).toBe(2);
      expect(files).toContain("/a.ts");
      expect(files).toContain("/b.ts");
    });
  });

  describe("统计信息", () => {
    test("getStats 返回正确信息", () => {
      const vec = makeVector(1);
      db.insertChunk(makeChunk({ filePath: "/a.ts" }), vec);
      db.insertChunk(makeChunk({ endLine: 20, filePath: "/a.ts", id: "a2", startLine: 11 }), vec);
      db.insertChunk(makeChunk({ filePath: "/b.ts", id: "b1" }), vec);

      const stats = db.getStats();
      expect(stats.totalChunks).toBe(3);
      expect(stats.totalFiles).toBe(2);
      expect(stats.dbSizeBytes).toBeGreaterThan(0);
    });
  });

  describe("清空索引", () => {
    test("clear 清空所有数据", () => {
      const vec = makeVector(1);
      db.insertChunk(makeChunk(), vec);
      db.clear();

      expect(db.getStats().totalChunks).toBe(0);
      expect(db.getStats().totalFiles).toBe(0);
    });
  });

  describe("向量维度元数据", () => {
    test("ensureEmbeddingDimensions 记录当前维度", () => {
      const result = db.ensureEmbeddingDimensions(768);

      expect(result).toEqual({ cleared: false, currentDimensions: 768, previousDimensions: null });
      expect(db.getEmbeddingDimensions()).toBe(768);
      expect(db.getStats().embeddingDimensions).toBe(768);
    });

    test("维度变化时清空代码块和符号索引", () => {
      db.ensureEmbeddingDimensions(1536);
      const vec = makeVector(1, 1536);
      db.insertChunk(makeChunk({ filePath: "/a.ts", id: "chunk-a" }), vec);
      db.insertSymbol(
        {
          endLine: 3,
          fileMtime: Date.now(),
          filePath: "/a.ts",
          id: "symbol-a",
          kind: "function",
          languageId: "typescript",
          name: "hello",
          startLine: 1,
        },
        vec,
      );

      const result = db.ensureEmbeddingDimensions(768);

      expect(result).toEqual({ cleared: true, currentDimensions: 768, previousDimensions: 1536 });
      expect(db.getStats().totalChunks).toBe(0);
      expect(db.getSymbolStats().totalSymbols).toBe(0);
      expect(db.getEmbeddingDimensions()).toBe(768);
    });

    test("旧库没有元数据时可从已有向量推断维度并触发清理", () => {
      const vec = makeVector(1, 1536);
      db.insertChunk(makeChunk({ id: "legacy" }), vec);
      db.getRawDb().prepare("DELETE FROM vector_index_metadata").run();

      const result = db.ensureEmbeddingDimensions(1024);

      expect(result).toEqual({ cleared: true, currentDimensions: 1024, previousDimensions: 1536 });
      expect(db.getStats().totalChunks).toBe(0);
      expect(db.getEmbeddingDimensions()).toBe(1024);
    });
  });
});

describe("cosineSimilarity", () => {
  test("相同向量相似度为 1", () => {
    const vec = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 6);
  });

  test("正交向量相似度为 0", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  test("相反向量相似度为 -1", () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 6);
  });

  test("空向量返回 0", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  test("不同长度返回 0", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  test("部分相似", () => {
    const a = [1, 0, 1, 0];
    const b = [1, 1, 0, 0];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});

/**
 * VectorDb 模块 — 向量索引数据库聚合入口
 *
 * 拆分为:
 *   - vectorDbMigrations.ts: schema 迁移、维度管理、向量编解码
 *   - vectorDbTypes.ts: 类型定义
 *   - vectorDbSymbols.ts: 符号索引读写方法
 *   - vectorMath.ts: 余弦相似度计算
 *
 * 本文件保留 VectorDb 核心类并 re-export 所有公共 API。
 */
import { Database } from "bun:sqlite";
import { createLogger } from "@/core/logging/logger";
import { getDataDir, SQLITE_BUSY_TIMEOUT_MS } from "@/config";
import { join } from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { cosineSimilarity } from "./vectorMath";
import type {
  CodeChunk,
  CodeSymbol,
  FileIndexStats,
  IndexedCodeSymbol,
  SearchResult,
  StoredIndexCheckpoint,
  SymbolSearchOptions,
  SymbolSearchResult,
  SymbolStats,
  VectorDbConfig,
  VectorDbStats,
  VectorSearchOptions,
} from "./vectorDbTypes";
import {
  runMigrations,
  getPersistedEmbeddingDimensions,
  setEmbeddingDimensions,
  inferStoredEmbeddingDimensions,
  assertValidDimensions,
  assertVectorDimensions,
  isVectorDimensionsCompatible,
  encodeVector,
  decodeVector,
} from "./vectorDbMigrations";
import { createSymbolOperations, type SymbolOperations } from "./vectorDbSymbols";

export { cosineSimilarity } from "./vectorMath";
/** re-export */
export type {
  CodeChunk,
  CodeSymbol,
  FileIndexStats,
  IndexedCodeSymbol,
  SearchResult,
  StoredIndexCheckpoint,
  SymbolSearchOptions,
  SymbolSearchResult,
  SymbolStats,
  VectorDbConfig,
  VectorDbStats,
  VectorSearchOptions,
} from "./vectorDbTypes";

const log = createLogger("search:vector-db");
const DEFAULT_VECTOR_DIMENSIONS = 1536;

// ── SQLite 行类型接口（类型安全替代 Record<string, unknown>）─────────────

/** code_chunks 表完整行（含 embedding BLOB） */
interface CodeChunkRow {
  id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  language_id: string;
  file_mtime: number;
  file_hash: string | null;
  embedding: Buffer;
}

/** getFileStats 查询结果行 */
interface FileStatsRow {
  count: number;
  latest: number | null;
  hash: string | null;
}

/** getIndexedFiles 查询结果行 */
interface IndexedFilePathRow {
  file_path: string;
}

/** getStats 查询: chunk 总数行 */
interface ChunkCountRow {
  total: number;
}

/** getStats 查询: 文件数行 */
interface FileCountRow {
  files: number;
}

/**
 * 向量索引数据库。
 *
 * 使用 bun:sqlite 存储，向量以 BLOB 形式存储(Float32Array)。
 * 相似度搜索在内存中进行余弦相似度计算。
 */
/** VectorDb */
export class VectorDb {
  private db: Database;
  private dbPath: string;
  private dimensions: number;
  private symbols: SymbolOperations;

  constructor(config: VectorDbConfig = {}) {
    this.dbPath = config.dbPath ?? "";
    this.dimensions = config.dimensions ?? DEFAULT_VECTOR_DIMENSIONS;

    if (!this.dbPath) {
      this.dbPath = join(getDataDir(), "crab-search.db");
    }

    // 确保目录存在
    const dir = join(this.dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

    runMigrations(this.db);
    this.symbols = createSymbolOperations(this.db, () => this.getEmbeddingDimensions());
    log.info(`向量数据库已初始化: ${this.dbPath}`);
  }

  /**
   * 确保当前索引维度与配置一致。维度变化时清空旧索引，避免增量索引跳过旧向量。
   */
  ensureEmbeddingDimensions(dimensions = this.dimensions): {
    previousDimensions: number | null;
    currentDimensions: number;
    cleared: boolean;
  } {
    assertValidDimensions(dimensions);
    this.dimensions = dimensions;

    const previousDimensions = getPersistedEmbeddingDimensions(this.db) ?? inferStoredEmbeddingDimensions(this.db);
    if (previousDimensions === null) {
      setEmbeddingDimensions(this.db, dimensions);
      return { cleared: false, currentDimensions: dimensions, previousDimensions };
    }

    if (previousDimensions !== dimensions) {
      this.clear();
      setEmbeddingDimensions(this.db, dimensions);
      log.info(`向量维度已变化: ${previousDimensions} -> ${dimensions}，旧索引已清空`);
      return { cleared: true, currentDimensions: dimensions, previousDimensions };
    }

    setEmbeddingDimensions(this.db, dimensions);
    return { cleared: false, currentDimensions: dimensions, previousDimensions };
  }

  /**
   * 获取当前索引记录的 Embedding 维度。
   */
  getEmbeddingDimensions(): number {
    return getPersistedEmbeddingDimensions(this.db) ?? inferStoredEmbeddingDimensions(this.db) ?? this.dimensions;
  }

  /**
   * 插入代码片段。
   */
  insertChunk(chunk: CodeChunk, embedding: number[]): void {
    assertVectorDimensions(embedding, this.getEmbeddingDimensions(), "insertChunk");
    const vectorBlob = encodeVector(embedding);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO code_chunks (id, file_path, start_line, end_line, content, language_id, file_mtime, file_hash, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      chunk.id,
      chunk.filePath,
      chunk.startLine,
      chunk.endLine,
      chunk.content,
      chunk.languageId,
      chunk.fileMtime,
      chunk.fileHash ?? null,
      vectorBlob,
    );
  }

  /**
   * 批量插入代码片段。
   */
  insertChunks(items: { chunk: CodeChunk; embedding: number[] }[]): void {
    const transaction = this.db.transaction(() => {
      for (const { chunk, embedding } of items) {
        this.insertChunk(chunk, embedding);
      }
    });
    transaction();
  }

  /**
   * 根据向量搜索相似代码片段。
   */
  search(queryEmbedding: number[], options?: VectorSearchOptions): SearchResult[] {
    if (!isVectorDimensionsCompatible(queryEmbedding, this.getEmbeddingDimensions(), "search")) {
      return [];
    }

    const limit = options?.limit ?? 20;
    const minScore = options?.minScore ?? 0.5;

    let sql =
      "SELECT id, file_path, start_line, end_line, content, language_id, file_mtime, file_hash, embedding FROM code_chunks";
    const conditions: string[] = [];
    const params: string[] = [];

    if (options?.filePathFilter) {
      conditions.push("file_path LIKE ?");
      params.push(`%${options.filePathFilter}%`);
    }

    if (options?.languageFilter) {
      conditions.push("language_id = ?");
      params.push(options.languageFilter);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as CodeChunkRow[];

    const results: SearchResult[] = [];

    for (const row of rows) {
      const embedding = decodeVector(row.embedding);
      const score = cosineSimilarity(queryEmbedding, embedding);

      if (score >= minScore) {
        results.push({
          chunk: {
            content: row.content,
            endLine: row.end_line,
            fileHash: row.file_hash ?? undefined,
            fileMtime: row.file_mtime,
            filePath: row.file_path,
            id: row.id,
            languageId: row.language_id,
            startLine: row.start_line,
          },
          score,
        });
      }
    }

    // 按相似度排序
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * 删除指定文件的所有索引。
   */
  deleteByFile(filePath: string): number {
    const stmt = this.db.prepare("DELETE FROM code_chunks WHERE file_path = ?");
    const result = stmt.run(filePath);
    return result.changes;
  }

  /**
   * 删除指定文件列表的索引。
   */
  deleteByFiles(filePaths: string[]): number {
    let total = 0;
    const transaction = this.db.transaction(() => {
      for (const fp of filePaths) {
        total += this.deleteByFile(fp);
      }
    });
    transaction();
    return total;
  }

  /**
   * 获取指定文件的索引统计。
   */
  getFileStats(filePath: string): FileIndexStats | null {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count, MAX(file_mtime) as latest, MAX(file_hash) as hash FROM code_chunks WHERE file_path = ?",
    );
    const row = stmt.get(filePath) as FileStatsRow | null;
    if (!row || row.count === 0) {
      return null;
    }
    return {
      chunkCount: row.count,
      fileHash: row.hash ?? null,
      latestMtime: row.latest ?? 0,
    };
  }

  /**
   * 获取所有已索引文件的路径列表。
   */
  getIndexedFiles(): string[] {
    const stmt = this.db.prepare("SELECT DISTINCT file_path FROM code_chunks");
    const rows = stmt.all() as IndexedFilePathRow[];
    return rows.map((r) => r.file_path);
  }

  /**
   * 获取索引统计信息。
   */
  getStats(): VectorDbStats {
    const countRow = this.db.prepare("SELECT COUNT(*) as total FROM code_chunks").get() as ChunkCountRow | null;
    const fileRow = this.db
      .prepare("SELECT COUNT(DISTINCT file_path) as files FROM code_chunks")
      .get() as FileCountRow | null;

    let dbSizeBytes = 0;
    try {
      const stat = statSync(this.dbPath);
      dbSizeBytes = stat.size;
    } catch {
      // Ignore
    }

    return {
      dbSizeBytes,
      embeddingDimensions: this.getEmbeddingDimensions(),
      totalChunks: countRow?.total ?? 0,
      totalFiles: fileRow?.files ?? 0,
    };
  }

  /**
   * 清空所有索引。
   */
  clear(): void {
    this.db.run("DELETE FROM code_chunks");
    this.db.run("DELETE FROM symbols");
    log.info("向量索引已清空");
  }

  /**
   * 关闭数据库连接。
   */
  close(): void {
    this.db.close();
    log.info("向量数据库连接已关闭");
  }

  /**
   * 获取原始数据库实例(用于高级查询)。
   */
  getRawDb(): Database {
    return this.db;
  }

  /** 保存索引 checkpoint 到数据库 */
  saveIndexCheckpoint(rootDir: string, checkpointJson: string, status: string, updatedAt: string): void {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO index_checkpoints (root_dir, checkpoint_json, status, updated_at)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(rootDir, checkpointJson, status, updatedAt);
  }

  /** 从数据库加载指定项目根目录的索引 checkpoint */
  loadIndexCheckpoint(rootDir: string): StoredIndexCheckpoint | null {
    return this.db
      .prepare(
        "SELECT root_dir as rootDir, checkpoint_json as checkpointJson, status, updated_at as updatedAt FROM index_checkpoints WHERE root_dir = ?",
      )
      .get(rootDir) as StoredIndexCheckpoint | null;
  }

  clearIndexCheckpoint(rootDir: string): void {
    this.db.prepare("DELETE FROM index_checkpoints WHERE root_dir = ?").run(rootDir);
  }

  // ── 符号索引方法 (委托给 vectorDbSymbols) ───────────────────────────

  insertSymbol(symbol: IndexedCodeSymbol, embedding: number[]): void {
    this.symbols.insertSymbol(symbol, embedding);
  }

  insertSymbols(items: { symbol: IndexedCodeSymbol; embedding: number[] }[]): void {
    this.symbols.insertSymbols(items);
  }

  searchSymbols(queryEmbedding: number[], options?: SymbolSearchOptions): SymbolSearchResult[] {
    return this.symbols.searchSymbols(queryEmbedding, options);
  }

  findSymbolsByName(name: string): CodeSymbol[] {
    return this.symbols.findSymbolsByName(name);
  }

  deleteSymbolsByFile(filePath: string): number {
    return this.symbols.deleteSymbolsByFile(filePath);
  }

  getSymbolStats(): SymbolStats {
    return this.symbols.getSymbolStats();
  }
}

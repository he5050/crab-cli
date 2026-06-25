/**
 * VectorDb 迁移与维度管理 — 从 vectorDb.ts 拆分
 *
 * 职责:
 *   - 数据库 schema 迁移 (创建表、索引、列)
 *   - Embedding 维度持久化与推断
 *   - 向量编解码 (Float32Array <-> Buffer)
 *   - 维度校验辅助方法
 */

import { createLogger } from "@/core/logging/logger";
import { UserError } from "@/core/errors/appError";

const log = createLogger("search:vector-db");
const METADATA_KEY_EMBEDDING_DIMENSIONS = "embedding_dimensions";

/**
 * 执行数据库 schema 迁移 — 创建表和索引。
 * 从 VectorDb.runMigrations() 拆出。
 */
/** runMigrations 的实现 */
export function runMigrations(db: {
  run(sql: string): void;
  prepare(sql: string): { all(): Record<string, unknown>[] };
}): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS vector_index_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS index_checkpoints (
      root_dir TEXT PRIMARY KEY,
      checkpoint_json TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_index_checkpoints_status ON index_checkpoints(status)`);

  // 代码片段表
  db.run(`
    CREATE TABLE IF NOT EXISTS code_chunks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL,
      language_id TEXT NOT NULL,
      file_mtime INTEGER NOT NULL DEFAULT 0,
      file_hash TEXT,
      embedding BLOB NOT NULL
    )
  `);
  ensureColumn(db, "code_chunks", "file_hash", "TEXT");

  db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_file ON code_chunks(file_path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_language ON code_chunks(language_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_mtime ON code_chunks(file_mtime)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_hash ON code_chunks(file_hash)`);

  // 符号表(函数、类、接口、方法等)
  db.run(`
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      signature TEXT,
      container_name TEXT,
      language_id TEXT NOT NULL,
      file_mtime INTEGER NOT NULL DEFAULT 0,
      embedding BLOB NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_language ON symbols(language_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_mtime ON symbols(file_mtime)`);
}

/**
 * 确保表中存在指定列。
 */
function ensureColumn(
  db: {
    run(sql: string): void;
    prepare(sql: string): { all(): Record<string, unknown>[] };
  },
  table: string,
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Record<string, unknown>[];
  if (rows.some((row) => row.name === column)) {
    return;
  }
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// ── Embedding 维度管理 ────────────────────────────────────────────

/**
 * 获取持久化的 Embedding 维度。
 */
/** getPersistedEmbeddingDimensions 的实现 */
export function getPersistedEmbeddingDimensions(db: {
  prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | null };
}): number | null {
  const row = db
    .prepare("SELECT value FROM vector_index_metadata WHERE key = ?")
    .get(METADATA_KEY_EMBEDDING_DIMENSIONS) as Record<string, unknown> | null;
  const value = Number(row?.value);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * 持久化 Embedding 维度。
 */
/** setEmbeddingDimensions 的实现 */
export function setEmbeddingDimensions(
  db: {
    prepare(sql: string): { run(...params: unknown[]): void };
  },
  dimensions: number,
): void {
  db.prepare("INSERT OR REPLACE INTO vector_index_metadata (key, value) VALUES (?, ?)").run(
    METADATA_KEY_EMBEDDING_DIMENSIONS,
    String(dimensions),
  );
}

/**
 * 从存储的 BLOB 数据推断 Embedding 维度。
 */
/** inferStoredEmbeddingDimensions 的实现 */
export function inferStoredEmbeddingDimensions(db: {
  prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | null };
}): number | null {
  const chunkRow = db.prepare("SELECT embedding FROM code_chunks LIMIT 1").get() as Record<string, unknown> | null;
  const chunkDimensions = getBlobDimensions(chunkRow?.embedding);
  if (chunkDimensions !== null) {
    return chunkDimensions;
  }

  const symbolRow = db.prepare("SELECT embedding FROM symbols LIMIT 1").get() as Record<string, unknown> | null;
  return getBlobDimensions(symbolRow?.embedding);
}

function getBlobDimensions(value: unknown): number | null {
  if (!value) {
    return null;
  }
  const { byteLength } = value as Buffer;
  if (!Number.isInteger(byteLength) || byteLength <= 0 || byteLength % 4 !== 0) {
    return null;
  }
  return byteLength / 4;
}

// ── 维度校验 ──────────────────────────────────────────────────────

/**
 * 校验维度值是否合法。
 */
/** assertValidDimensions 的实现 */
export function assertValidDimensions(dimensions: number): void {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new UserError("USER-202", `Invalid embedding dimensions: ${dimensions}`, {
      context: { dimensions, module: "VectorDb" },
    });
  }
}

/**
 * 校验向量维度是否与期望一致。
 */
/** assertVectorDimensions 的实现 */
export function assertVectorDimensions(embedding: number[], expected: number, operation: string): void {
  if (embedding.length !== expected) {
    throw new UserError(
      "USER-202",
      `${operation} embedding dimensions mismatch: expected ${expected}, got ${embedding.length}`,
      {
        context: {
          actual: embedding.length,
          expected,
          module: "VectorDb",
          operation,
        },
      },
    );
  }
}

/**
 * 检查向量维度兼容性(不抛异常，返回布尔值)。
 */
/** isVectorDimensionsCompatible 的实现 */
export function isVectorDimensionsCompatible(embedding: number[], expected: number, operation: string): boolean {
  if (embedding.length === expected) {
    return true;
  }
  log.warn(`${operation} 向量维度不匹配: expected=${expected}, got=${embedding.length}`);
  return false;
}

// ── 向量编解码 ────────────────────────────────────────────────────

/**
 * 将 Float64 向量编码为 BLOB(Float32Array)。
 */
/** encodeVector 的实现 */
export function encodeVector(embedding: number[]): Buffer {
  const f32 = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    f32[i] = embedding[i]!;
  }
  return Buffer.from(f32.buffer) as Buffer;
}

/**
 * 从 BLOB 解码为 Float64 向量。
 */
/** decodeVector 的实现 */
export function decodeVector(blob: Buffer): number[] {
  const f32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  return [...f32];
}

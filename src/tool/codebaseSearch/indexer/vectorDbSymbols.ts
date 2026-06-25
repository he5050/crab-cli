/**
 * vectorDbSymbols — 符号索引读写方法
 *
 * 从 vectorDb.ts 提取:
 *   - insertSymbol / insertSymbols: 符号写入
 *   - searchSymbols: 向量相似度符号搜索
 *   - findSymbolsByName: 按名称精确查找
 *   - deleteSymbolsByFile: 删除指定文件的符号
 *   - getSymbolStats: 符号统计
 */
import { cosineSimilarity } from "./vectorMath";
import type {
  CodeSymbol,
  IndexedCodeSymbol,
  SymbolSearchOptions,
  SymbolSearchResult,
  SymbolStats,
} from "./vectorDbTypes";
import { assertVectorDimensions, isVectorDimensionsCompatible, encodeVector, decodeVector } from "./vectorDbMigrations";
import type { Database } from "bun:sqlite";

// ── SQLite 行类型接口（类型安全替代 Record<string, unknown>）─────────────

/** symbols 表完整行（含 embedding BLOB） */
interface SymbolRow {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  signature: string | null;
  container_name: string | null;
  language_id: string;
  embedding: Buffer;
}

/** symbols 表行（无 embedding，用于 findSymbolsByName） */
interface SymbolBasicRow {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  start_line: number;
  end_line: number;
  signature: string | null;
  container_name: string | null;
  language_id: string;
}

/** getSymbolStats 查询: 符号总数行 */
interface SymbolCountRow {
  total: number;
}

/** getSymbolStats 查询: 文件数行 */
interface SymbolFileCountRow {
  files: number;
}

/** getSymbolStats 查询: 按 kind 分组行 */
interface SymbolKindCountRow {
  kind: string;
  count: number;
}

/**
 * 为 VectorDb 附加符号索引方法。
 *
 * 以工厂函数形式使用:返回包含所有符号方法的对象，
 * 绑定到 VectorDb 实例的内部 db 和 dimensions 访问器。
 */
/** createSymbolOperations 的实现 */
export function createSymbolOperations(db: Database, getEmbeddingDimensions: () => number) {
  return {
    /**
     * 插入符号。
     */
    insertSymbol(symbol: IndexedCodeSymbol, embedding: number[]): void {
      assertVectorDimensions(embedding, getEmbeddingDimensions(), "insertSymbol");
      const vectorBlob = encodeVector(embedding);

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO symbols (id, name, kind, file_path, start_line, end_line, signature, container_name, language_id, file_mtime, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        symbol.id,
        symbol.name,
        symbol.kind,
        symbol.filePath,
        symbol.startLine,
        symbol.endLine,
        symbol.signature ?? null,
        symbol.containerName ?? null,
        symbol.languageId,
        symbol.fileMtime,
        vectorBlob,
      );
    },

    /**
     * 批量插入符号。
     */
    insertSymbols(items: { symbol: IndexedCodeSymbol; embedding: number[] }[]): void {
      const transaction = db.transaction(() => {
        for (const { symbol, embedding } of items) {
          this.insertSymbol(symbol, embedding);
        }
      });
      transaction();
    },

    /**
     * 根据向量搜索相似符号。
     */
    searchSymbols(queryEmbedding: number[], options?: SymbolSearchOptions): SymbolSearchResult[] {
      if (!isVectorDimensionsCompatible(queryEmbedding, getEmbeddingDimensions(), "searchSymbols")) {
        return [];
      }

      const limit = options?.limit ?? 20;
      const minScore = options?.minScore ?? 0.5;

      let sql =
        "SELECT id, name, kind, file_path, start_line, end_line, signature, container_name, language_id, embedding FROM symbols";
      const conditions: string[] = [];
      const params: string[] = [];

      if (options?.kindFilter) {
        conditions.push("kind = ?");
        params.push(options.kindFilter);
      }

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

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as SymbolRow[];

      const results: SymbolSearchResult[] = [];

      for (const row of rows) {
        const embedding = decodeVector(row.embedding);
        const score = cosineSimilarity(queryEmbedding, embedding);

        if (score >= minScore) {
          results.push({
            score,
            symbol: {
              containerName: row.container_name ?? undefined,
              endLine: row.end_line,
              filePath: row.file_path,
              id: row.id,
              kind: row.kind,
              languageId: row.language_id,
              name: row.name,
              signature: row.signature ?? undefined,
              startLine: row.start_line,
            },
          });
        }
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit);
    },

    /**
     * 按名称精确查找符号。
     */
    findSymbolsByName(name: string): CodeSymbol[] {
      const stmt = db.prepare(`
        SELECT id, name, kind, file_path, start_line, end_line, signature, container_name, language_id
        FROM symbols
        WHERE name = ?
      `);
      const rows = stmt.all(name) as SymbolBasicRow[];

      return rows.map((row) => ({
        containerName: row.container_name ?? undefined,
        endLine: row.end_line,
        filePath: row.file_path,
        id: row.id,
        kind: row.kind,
        languageId: row.language_id,
        name: row.name,
        signature: row.signature ?? undefined,
        startLine: row.start_line,
      }));
    },

    /**
     * 删除指定文件的所有符号。
     */
    deleteSymbolsByFile(filePath: string): number {
      const stmt = db.prepare("DELETE FROM symbols WHERE file_path = ?");
      const result = stmt.run(filePath);
      return result.changes;
    },

    /**
     * 获取符号统计信息。
     */
    getSymbolStats(): SymbolStats {
      const countRow = db.prepare("SELECT COUNT(*) as total FROM symbols").get() as SymbolCountRow | null;
      const fileRow = db
        .prepare("SELECT COUNT(DISTINCT file_path) as files FROM symbols")
        .get() as SymbolFileCountRow | null;

      const kindRows = db
        .prepare("SELECT kind, COUNT(*) as count FROM symbols GROUP BY kind")
        .all() as SymbolKindCountRow[];
      const byKind: Record<string, number> = {};
      for (const row of kindRows) {
        byKind[row.kind] = row.count;
      }

      return {
        byKind,
        totalFiles: fileRow?.files ?? 0,
        totalSymbols: countRow?.total ?? 0,
      };
    },
  };
}

/** 符号操作类型 */
export type SymbolOperations = ReturnType<typeof createSymbolOperations>;

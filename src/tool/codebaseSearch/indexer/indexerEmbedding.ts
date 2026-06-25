/**
 * CodebaseIndexer Embedding 存储方法 — 从 codebaseIndexer.ts 拆分
 *
 * 职责:
 *   - 对代码分块进行 Embedding 并存入向量数据库
 *   - 对符号进行 Embedding 并存入向量数据库
 *   - 分批处理与错误回退
 */

import { createLogger } from "@/core/logging/logger";
import type { CodeChunk, VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";
import { embedTexts, getEmbeddingConfig } from "@/api";
import type { AppConfigSchema } from "@/schema/config";
import { relative } from "node:path";
import { statSync } from "node:fs";

const log = createLogger("search:indexer");
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_BATCH_SIZE = 20;

/**
 * 获取 Embedding 维度(从 appConfig 或使用默认值)。
 */
/** getEmbeddingDimensionValue 的实现 */
export function getEmbeddingDimensionValue(appConfig?: AppConfigSchema): number {
  if (!appConfig) {
    return DEFAULT_EMBEDDING_DIMENSIONS;
  }
  return getEmbeddingConfig(appConfig).dimensions;
}

/**
 * 对分块进行 Embedding 并存入向量数据库。
 */
export async function embedAndStoreChunks(
  chunks: CodeChunk[],
  rootDir: string,
  db: VectorDb,
  appConfig?: AppConfigSchema,
): Promise<void> {
  if (!appConfig) {
    // 无 API 配置时跳过 Embedding，直接存储(无向量搜索能力)
    log.warn("无 API 配置，跳过 Embedding，仅存储文本索引");
    for (const chunk of chunks) {
      // 用零向量占位
      // oxlint-disable-next-line unicorn/no-new-array
      db.insertChunk(chunk, new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0));
    }
    return;
  }

  // 分批 Embedding
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE)!;

    // 准备文本(包含文件路径上下文)
    const texts = batch.map((chunk) => {
      const relPath = relative(rootDir, chunk.filePath);
      return `${relPath}:${chunk.startLine}\n${chunk.content}`;
    });

    try {
      const results = await embedTexts(appConfig, texts);

      // 存储
      const items = batch.map((chunk, j) => ({
        chunk,
        // oxlint-disable-next-line unicorn/no-new-array
        embedding: results[j]?.embedding ?? new Array(getEmbeddingConfig(appConfig).dimensions).fill(0),
      }));
      db.insertChunks(items);
    } catch (error) {
      log.error(`Embedding 批次失败 (${i}-${i + batch.length})`, {
        error: error instanceof Error ? error.message : String(error),
      });
      // 失败时用零向量存储，保证索引不丢失
      for (const chunk of batch) {
        // oxlint-disable-next-line unicorn/no-new-array
        db.insertChunk(chunk, new Array(getEmbeddingConfig(appConfig).dimensions).fill(0));
      }
    }
  }
}

/**
 * 对符号进行 Embedding 并存入向量数据库。
 */
export async function indexSymbols(
  symbols: {
    id: string;
    name: string;
    kind: string;
    filePath: string;
    startLine: number;
    endLine: number;
    signature?: string;
    containerName?: string;
    languageId: string;
  }[],
  filePath: string,
  rootDir: string,
  db: VectorDb,
  appConfig?: AppConfigSchema,
): Promise<void> {
  if (!appConfig) {
    // 无 API 配置时跳过 Embedding
    log.warn("无 API 配置，跳过符号 Embedding");
    for (const symbol of symbols) {
      const stat = statSync(filePath);
      db.insertSymbol(
        { ...symbol, fileMtime: stat.mtimeMs },
        // oxlint-disable-next-line unicorn/no-new-array
        new Array(DEFAULT_EMBEDDING_DIMENSIONS).fill(0),
      );
    }
    return;
  }

  // 分批 Embedding
  for (let i = 0; i < symbols.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = symbols.slice(i, i + EMBEDDING_BATCH_SIZE)!;

    // 准备文本(符号名称 + 签名 + 容器上下文)
    const texts = batch.map((symbol) => {
      const parts = [symbol.name];
      if (symbol.signature) {
        parts.push(symbol.signature);
      }
      if (symbol.containerName) {
        parts.push(`in ${symbol.containerName}`);
      }
      parts.push(`(${symbol.kind})`);
      return parts.join(" ");
    });

    try {
      const results = await embedTexts(appConfig, texts);

      // 存储
      const stat = statSync(filePath);
      const items = batch.map((symbol, j) => ({
        // oxlint-disable-next-line unicorn/no-new-array
        embedding: results[j]?.embedding ?? new Array(getEmbeddingConfig(appConfig).dimensions).fill(0),
        symbol: { ...symbol, fileMtime: stat.mtimeMs },
      }));
      db.insertSymbols(items);
    } catch (error) {
      log.error(`符号 Embedding 批次失败 (${i}-${i + batch.length})`, {
        error: error instanceof Error ? error.message : String(error),
      });
      // 失败时用零向量存储
      const stat = statSync(filePath);
      for (const symbol of batch) {
        db.insertSymbol(
          { ...symbol, fileMtime: stat.mtimeMs },
          // oxlint-disable-next-line unicorn/no-new-array
          new Array(getEmbeddingConfig(appConfig).dimensions).fill(0),
        );
      }
    }
  }
}

/**
 * CodebaseIndexer 模块 — 代码库索引器聚合入口
 *
 * 拆分为:
 *   - indexerEmbedding.ts: Embedding 与符号存储方法
 *   - indexerChunker.ts: 文件分块逻辑
 *   - indexerCheckpoint.ts: 断点续索引 checkpoint 管理
 *   - indexerScanner.ts: 文件扫描与增量过滤
 *   - gitignoreMatcher.ts: .gitignore 规则匹配
 *   - symbolExtractor.ts: 符号提取
 *
 * 本文件保留 CodebaseIndexer 核心类并 re-export checkpoint 相关 API。
 */
import { createLogger } from "@/core/logging/logger";
import type { VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";
import { type CodeChunk } from "@/tool/codebaseSearch/indexer/vectorDb";
import type { AppConfigSchema } from "@/schema/config";
import { loadGitignoreRules } from "@/tool/codebaseSearch/indexer/gitignoreMatcher";
import { DOCUMENT_EXTENSIONS, chunkIndexableFile } from "@/tool/codebaseSearch/indexer/indexerChunker";
import {
  type IndexProgress,
  clearCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
} from "@/tool/codebaseSearch/indexer/indexerCheckpoint";
import { SymbolExtractor } from "@/tool/codebaseSearch/indexer/symbolExtractor";
import { relative, extname } from "node:path";
import { getEmbeddingDimensionValue, embedAndStoreChunks, indexSymbols } from "./indexerEmbedding";
import {
  buildExcludeSets,
  scanFiles as scanFilesImpl,
  filterChangedFiles as filterChangedFilesImpl,
  shouldIncludeFile as shouldIncludeFileImpl,
} from "./indexerScanner";

export {
  clearCheckpoint,
  getCheckpointPath,
  loadCheckpoint,
  loadCheckpointFromSqlite,
  saveCheckpoint,
} from "@/tool/codebaseSearch/indexer/indexerCheckpoint";
/** re-export */
export type {
  CheckpointStateDb,
  IndexCheckpoint,
  IndexProgress,
} from "@/tool/codebaseSearch/indexer/indexerCheckpoint";

const log = createLogger("search:indexer");
const MAX_CONSECUTIVE_INDEX_FAILURES = 3;

/** 索引器配置 */
export interface IndexerConfig {
  rootDir: string;
  db: VectorDb;
  appConfig?: AppConfigSchema;
  excludeDirs?: string[];
  excludeExtensions?: string[];
  onProgress?: (progress: IndexProgress) => void;
}

/** 代码库索引器。 */
export class CodebaseIndexer {
  private rootDir: string;
  private db: VectorDb;
  private appConfig?: AppConfigSchema;
  private excludeDirs: Set<string>;
  private excludeExtensions: Set<string>;
  private onProgress?: (progress: IndexProgress) => void;
  private symbolExtractor: SymbolExtractor;

  constructor(config: IndexerConfig) {
    this.rootDir = config.rootDir;
    this.db = config.db;
    this.appConfig = config.appConfig;
    const { excludeDirs, excludeExtensions } = buildExcludeSets(config.excludeDirs, config.excludeExtensions);
    this.excludeDirs = excludeDirs;
    this.excludeExtensions = excludeExtensions;
    this.onProgress = config.onProgress;
    this.symbolExtractor = new SymbolExtractor(config.rootDir);
  }

  /** 全量索引项目目录。支持断点续索引:中断后可从 checkpoint 恢复。 */
  async fullIndex(): Promise<{
    filesProcessed: number;
    chunksGenerated: number;
    symbolsGenerated: number;
    filesSkipped: number;
    resumed: boolean;
    filesFailed: number;
    stoppedDueToFailures: boolean;
  }> {
    log.info(`开始全量索引: ${this.rootDir}`);

    // 阶段 1:扫描文件
    this.emitProgress({ chunksGenerated: 0, filesProcessed: 0, filesTotal: 0, phase: "scanning" });
    const files = scanFilesImpl(
      this.rootDir,
      this.excludeDirs,
      this.excludeExtensions,
      loadGitignoreRules(this.rootDir),
      this.appConfig,
    );
    log.info(`扫描到 ${files.length} 个源文件`);

    const dimensionCheck = this.db.ensureEmbeddingDimensions(this.getEmbeddingDimensions());
    if (dimensionCheck.cleared) {
      clearCheckpoint(this.rootDir, this.db);
      log.info(
        `Embedding 维度变化，已清空旧索引并重建: ${dimensionCheck.previousDimensions} -> ${dimensionCheck.currentDimensions}`,
      );
    }

    // 阶段 2:增量过滤 + checkpoint 恢复
    const checkpoint = loadCheckpoint(this.rootDir, this.db);
    const processedFiles: string[] = checkpoint?.status === "in_progress" ? [...checkpoint.processedFileList] : [];
    const resumed = processedFiles.length > 0;
    if (resumed) {
      log.info(`从 checkpoint 恢复: 已处理 ${processedFiles.length} 文件`);
    }

    const changedFiles = filterChangedFilesImpl(this.rootDir, files, this.db);
    log.info(`变更文件: ${changedFiles.length}/${files.length}`);

    if (changedFiles.length === 0) {
      log.info("没有需要索引的变更文件");
      clearCheckpoint(this.rootDir, this.db);
      this.emitProgress({ chunksGenerated: 0, filesProcessed: 0, filesTotal: files.length, phase: "complete" });
      return {
        chunksGenerated: 0,
        filesFailed: 0,
        filesProcessed: 0,
        filesSkipped: files.length,
        resumed,
        stoppedDueToFailures: false,
        symbolsGenerated: 0,
      };
    }

    // 写入初始 checkpoint
    saveCheckpoint(
      this.rootDir,
      {
        chunksGenerated: 0,
        filesProcessed: 0,
        filesTotal: changedFiles.length,
        phase: "indexing",
        processedFileList: [...processedFiles],
        status: "in_progress",
        symbolsGenerated: 0,
        updatedAt: new Date().toISOString(),
      },
      this.db,
    );

    // 阶段 3-4:逐文件处理(chunk → embed → symbol → saveCheckpoint)
    let totalChunks = 0;
    let totalSymbols = 0;
    let processed = 0;
    let failedFiles = checkpoint?.failedFiles ?? 0;
    let consecutiveFailures = checkpoint?.consecutiveFailures ?? 0;
    let stoppedDueToFailures = false;

    for (const file of changedFiles) {
      this.emitProgress({
        chunksGenerated: totalChunks,
        currentFile: relative(this.rootDir, file),
        filesProcessed: processed + processedFiles.length,
        filesTotal: changedFiles.length,
        phase: "indexing",
      });

      try {
        this.db.deleteByFile(file);
        this.db.deleteSymbolsByFile(file);
        const chunks = await this.chunkFile(file);

        if (chunks.length > 0) {
          this.emitProgress({
            chunksGenerated: totalChunks,
            currentFile: relative(this.rootDir, file),
            filesProcessed: processed + processedFiles.length,
            filesTotal: changedFiles.length,
            phase: "embedding",
          });
          await embedAndStoreChunks(chunks, this.rootDir, this.db, this.appConfig);
          totalChunks += chunks.length;
        }

        // 符号提取
        const ext = extname(file).toLowerCase();
        const isDocument = DOCUMENT_EXTENSIONS.has(ext);
        if (!isDocument) {
          try {
            const symbols = await this.symbolExtractor.extractSymbols(file);
            if (symbols.length > 0) {
              await indexSymbols(symbols, file, this.rootDir, this.db, this.appConfig);
              totalSymbols += symbols.length;
            }
          } catch {
            /* Skip symbol errors */
          }
        }

        processedFiles.push(file);
        processed++;
        consecutiveFailures = 0;

        // 每文件后保存 checkpoint
        saveCheckpoint(
          this.rootDir,
          {
            chunksGenerated: totalChunks,
            consecutiveFailures,
            currentFile: relative(this.rootDir, file),
            failedFiles,
            filesProcessed: processedFiles.length,
            filesTotal: changedFiles.length,
            phase: "indexing",
            processedFileList: [...processedFiles],
            status: "in_progress",
            symbolsGenerated: totalSymbols,
            updatedAt: new Date().toISOString(),
          },
          this.db,
        );
      } catch (error) {
        failedFiles++;
        consecutiveFailures++;
        const lastError = error instanceof Error ? error.message : String(error);
        const status = consecutiveFailures >= MAX_CONSECUTIVE_INDEX_FAILURES ? "failed" : "in_progress";

        saveCheckpoint(
          this.rootDir,
          {
            chunksGenerated: totalChunks,
            consecutiveFailures,
            currentFile: relative(this.rootDir, file),
            failedFiles,
            filesProcessed: processedFiles.length,
            filesTotal: changedFiles.length,
            lastError,
            phase: "indexing",
            processedFileList: [...processedFiles],
            status,
            symbolsGenerated: totalSymbols,
            updatedAt: new Date().toISOString(),
          },
          this.db,
        );

        log.warn(`索引文件失败: ${relative(this.rootDir, file)}`, { consecutiveFailures, error: lastError });
        if (status === "failed") {
          stoppedDueToFailures = true;
          break;
        }
      }
    }

    if (stoppedDueToFailures) {
      log.warn(`索引因连续失败停止: consecutiveFailures=${consecutiveFailures}, failedFiles=${failedFiles}`);
      return {
        chunksGenerated: totalChunks,
        filesFailed: failedFiles,
        filesProcessed: processed,
        filesSkipped: files.length - processed - failedFiles,
        resumed,
        stoppedDueToFailures,
        symbolsGenerated: totalSymbols,
      };
    }

    // 完成:清除 checkpoint
    clearCheckpoint(this.rootDir, this.db);
    this.emitProgress({
      chunksGenerated: totalChunks,
      filesProcessed: changedFiles.length,
      filesTotal: files.length,
      phase: "complete",
    });
    log.info(`索引完成: ${changedFiles.length} 文件, ${totalChunks} 分块, ${totalSymbols} 符号, resumed=${resumed}`);

    return {
      chunksGenerated: totalChunks,
      filesFailed: failedFiles,
      filesProcessed: changedFiles.length,
      filesSkipped: files.length - changedFiles.length,
      resumed,
      stoppedDueToFailures,
      symbolsGenerated: totalSymbols,
    };
  }

  /** 从断点恢复索引。若无 checkpoint 则等同于 fullIndex。 */
  async resumeIndex(): Promise<{
    filesProcessed: number;
    chunksGenerated: number;
    symbolsGenerated: number;
    filesSkipped: number;
    resumed: boolean;
    filesFailed: number;
    stoppedDueToFailures: boolean;
  }> {
    return this.fullIndex();
  }

  /** 增量索引:处理单个文件的变更。 */
  async indexFile(filePath: string): Promise<number> {
    this.db.ensureEmbeddingDimensions(this.getEmbeddingDimensions());
    this.db.deleteByFile(filePath);
    this.db.deleteSymbolsByFile(filePath);
    const chunks = await this.chunkFile(filePath);

    if (chunks.length > 0) {
      await embedAndStoreChunks(chunks, this.rootDir, this.db, this.appConfig);
    }

    // 提取并索引符号(仅代码文件)
    const ext = extname(filePath).toLowerCase();
    const isDocument = DOCUMENT_EXTENSIONS.has(ext);
    if (!isDocument) {
      const symbols = await this.symbolExtractor.extractSymbols(filePath);
      if (symbols.length > 0) {
        await indexSymbols(symbols, filePath, this.rootDir, this.db, this.appConfig);
      }
      const totalIndexed = chunks.length + symbols.length;
      log.debug(`索引文件: ${relative(this.rootDir, filePath)} → ${chunks.length} 分块, ${symbols.length} 符号`);
      return totalIndexed;
    }
    log.debug(`索引文档: ${relative(this.rootDir, filePath)} → ${chunks.length} 分块`);
    return chunks.length;
  }

  /** 删除文件索引(包括代码块和符号)。 */
  removeFile(filePath: string): number {
    const deletedChunks = this.db.deleteByFile(filePath);
    const deletedSymbols = this.db.deleteSymbolsByFile(filePath);
    log.debug(`删除索引: ${relative(this.rootDir, filePath)} → ${deletedChunks} 分块, ${deletedSymbols} 符号`);
    return deletedChunks + deletedSymbols;
  }

  async chunkFile(filePath: string): Promise<CodeChunk[]> {
    return chunkIndexableFile(filePath);
  }

  /** @internal 扫描项目目录(委托给 indexerScanner，供测试使用) */
  scanFiles(): string[] {
    return scanFilesImpl(
      this.rootDir,
      this.excludeDirs,
      this.excludeExtensions,
      loadGitignoreRules(this.rootDir),
      this.appConfig,
    );
  }

  /** @internal 增量过滤(委托给 indexerScanner，供测试使用) */
  filterChangedFiles(files: string[]): string[] {
    return filterChangedFilesImpl(this.rootDir, files, this.db);
  }

  /** @internal 判断文件是否应索引(委托给 indexerScanner，供测试使用) */
  shouldIncludeFile(filePath: string): boolean {
    return shouldIncludeFileImpl(filePath, this.excludeExtensions, this.appConfig);
  }

  private emitProgress(progress: IndexProgress): void {
    this.onProgress?.(progress);
  }

  private getEmbeddingDimensions(): number {
    return getEmbeddingDimensionValue(this.appConfig);
  }
}

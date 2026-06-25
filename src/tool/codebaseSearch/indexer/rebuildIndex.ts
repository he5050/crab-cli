/**
 * 搜索索引重建模块 — 提供一键重建代码库与向量索引的能力。
 *
 * 职责:
 *   - 重新扫描代码库并写入向量库
 *   - 暴露进度与结果统计
 *   - 支持从 checkpoint 恢复
 *
 * 模块功能:
 *   - rebuildSearchIndex: 重建搜索索引
 *   - RebuildIndexResult: 重建结果统计
 *   - RebuildIndexNotifier: 通知回调
 */
import { loadConfig } from "@/config";
import type { AppConfigSchema } from "@/schema/config";
import { CodebaseIndexer } from "@/tool/codebaseSearch/indexer/codebaseIndexer";
import type { IndexProgress } from "@/tool/codebaseSearch/indexer/indexerCheckpoint";
import { VectorDb } from "@/tool/codebaseSearch/indexer/vectorDb";

/** 索引重建通知回调，用于展示 toast 和日志消息 */
export interface RebuildIndexNotifier {
  showToast?: (message: string, variant?: "success" | "warning" | "error" | "info") => void;
  publishLog?: (level: "info" | "warn" | "error", message: string) => void;
}

/** 索引重建结果统计，包含处理文件数、分块数、跳过数等 */
export interface RebuildIndexResult {
  filesProcessed: number;
  chunksGenerated: number;
  symbolsGenerated: number;
  filesSkipped: number;
  resumed: boolean;
  filesFailed: number;
  stoppedDueToFailures: boolean;
}

interface RebuildIndexDeps {
  loadConfig: typeof loadConfig;
  createVectorDb: () => VectorDb;
  createCodebaseIndexer: (input: {
    rootDir: string;
    db: VectorDb;
    appConfig?: AppConfigSchema;
    onProgress: (progress: IndexProgress) => void;
  }) => { fullIndex: () => Promise<RebuildIndexResult> };
  getCwd: () => string;
}

const rebuildIndexDeps: RebuildIndexDeps = {
  createCodebaseIndexer: (input) => new CodebaseIndexer(input),
  createVectorDb: () => new VectorDb(),
  getCwd: () => process.cwd(),
  loadConfig,
};

/** 替换重建索引的内部依赖（仅测试用） @param overrides 需要覆盖的依赖项 */
export function __setRebuildIndexDepsForTesting(overrides: Partial<RebuildIndexDeps>): void {
  Object.assign(rebuildIndexDeps, overrides);
}

/** 测试专用：重置重建索引的内部依赖为默认实现 */
export function __resetRebuildIndexDepsForTesting(): void {
  rebuildIndexDeps.loadConfig = loadConfig;
  rebuildIndexDeps.createVectorDb = () => new VectorDb();
  rebuildIndexDeps.createCodebaseIndexer = (input) => new CodebaseIndexer(input);
  rebuildIndexDeps.getCwd = () => process.cwd();
}

function publishProgressToast(notifier: RebuildIndexNotifier, progress: IndexProgress): void {
  if (progress.phase === "scanning") {
    notifier.showToast?.("扫描文件中...", "info");
  } else if (progress.phase === "indexing") {
    notifier.showToast?.(
      `分块 ${progress.currentFile ?? ""} (${progress.filesProcessed}/${progress.filesTotal})`,
      "info",
    );
  } else if (progress.phase === "embedding") {
    notifier.showToast?.(`生成向量 (${progress.filesProcessed}/${progress.filesTotal})`, "info");
  }
}

/** 重建代码库索引，扫描文件、生成分块与向量，支持断点恢复 @param notifier 通知回调 @returns 重建结果统计 */
export async function rebuildCodebaseIndex(notifier: RebuildIndexNotifier = {}): Promise<RebuildIndexResult> {
  notifier.showToast?.("正在重建代码库索引...", "info");

  let appConfig: AppConfigSchema | undefined;
  try {
    appConfig = await rebuildIndexDeps.loadConfig();
  } catch {
    // 配置不可用时仍允许重建索引，只是失去 embedding 配置。
  }

  const db = rebuildIndexDeps.createVectorDb();
  try {
    const indexer = rebuildIndexDeps.createCodebaseIndexer({
      appConfig,
      db,
      onProgress: (progress) => publishProgressToast(notifier, progress),
      rootDir: rebuildIndexDeps.getCwd(),
    });
    const result = await indexer.fullIndex();

    notifier.showToast?.(
      `索引完成: ${result.filesProcessed} 文件, ${result.chunksGenerated} 分块, ${result.filesSkipped} 跳过`,
      "success",
    );
    notifier.publishLog?.(
      "info",
      `代码库索引重建完成:\n  处理文件: ${result.filesProcessed}\n  生成分块: ${result.chunksGenerated}\n  跳过文件: ${result.filesSkipped}`,
    );
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    notifier.showToast?.(`重建索引失败: ${msg}`, "error");
    throw error;
  } finally {
    db.close();
  }
}

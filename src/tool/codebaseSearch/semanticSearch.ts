import { createLogger } from "@/core/logging/logger";
import { getCodebaseSearchErrorMessage } from "./errors";
import { runRg, buildExcludeArgs } from "./searchHelpers";

const log = createLogger("tool:codebase-search");

/** 语义搜索结果项（含分数） */
interface SemanticSearchResultItem {
  file: string;
  line: number;
  text: string;
  score: number;
  type: string;
}

/** 精确搜索结果项（无分数） */
interface ExactSearchResultItem {
  file: string;
  line: number;
  text: string;
  type: string;
}

// ── 文本搜索(被语义搜索作为回退使用)───────────────────────────────

/** 使用 ripgrep 执行纯文本搜索 */
export async function searchText(
  query: string,
  cwd: string,
  include?: string,
  exclude?: string[],
  limit?: number,
): Promise<Record<string, unknown>> {
  const args = ["--line-number", "--no-heading", "--color=never", "--max-count", String(limit ?? 50)];
  if (include) {
    args.push("--glob", include);
  }
  args.push(...buildExcludeArgs(exclude));
  args.push("--", query, cwd);

  const results = await runRg(args, cwd);
  const parsed = results.map((r) => ({
    ...r,
    type: "text" as const,
  }));

  return { engine: "ripgrep", mode: "text", query, results: parsed, total: parsed.length };
}

// ── 语义搜索 ──────────────────────────────────────────────────────

/** 使用向量数据库执行语义搜索，支持 Rerank 重排序，失败回退到文本搜索 */
export async function searchSemantic(
  query: string,
  cwd: string,
  include?: string,
  exclude?: string[],
  limit?: number,
  useRerank?: boolean,
  rerankTopN?: number,
): Promise<Record<string, unknown>> {
  try {
    // 动态导入避免硬依赖
    const { VectorDb } = await import("@/tool/codebaseSearch/indexer/vectorDb");
    const { embedText } = await import("@api");

    // 尝试获取 appConfig
    let appConfig: import("@/schema/config").AppConfigSchema | undefined;
    try {
      const { config } = await import("@config");
      appConfig = await config();
    } catch (error) {
      log.debug("语义搜索配置加载失败，回退到文本搜索", {
        cwd,
        error: getCodebaseSearchErrorMessage(error),
        query,
      });
    }

    if (!appConfig) {
      log.warn("无法获取应用配置，回退到文本搜索");
      return searchText(query, cwd, include, exclude, limit);
    }

    // 生成查询向量
    const { embedding } = await embedText(appConfig, query);

    // 打开向量数据库
    const db = new VectorDb();
    try {
      const stats = db.getStats();
      if (stats.totalChunks === 0) {
        // 索引为空，回退到文本搜索
        return {
          ...(await searchText(query, cwd, include, exclude, limit)),
          reason: "索引为空",
          semanticFallback: true,
        };
      }

      // 获取更多结果用于 rerank
      const searchLimit = useRerank ? Math.max((limit ?? 50) * 2, 100) : (limit ?? 50);

      const results = db.search(embedding, {
        filePathFilter: include ?? undefined,
        limit: searchLimit,
        minScore: 0.3,
      });

      let parsed = results.map((r) => ({
        endLine: r.chunk.endLine,
        file: r.chunk.filePath,
        language: r.chunk.languageId,
        line: r.chunk.startLine,
        score: r.score,
        text: r.chunk.content.slice(0, 200),
        type: "semantic" as const,
      }));

      // 使用 Rerank 重排序
      if (useRerank && parsed.length > 0) {
        try {
          const { rerank } = await import("@api");
          const documents = parsed.map((p) => `${p.file}:${p.line} ${p.text}`);

          const rerankResult = await rerank(appConfig, {
            documents,
            query,
            topN: rerankTopN ?? limit ?? 20,
          });

          // 根据 rerank 结果重新排序
          const reranked = rerankResult.results
            .map((r) => ({
              ...parsed[r.index]!,
              rerankScore: r.relevanceScore,
              score: r.relevanceScore,
            }))
            .slice(0, limit ?? 20);

          parsed = reranked;

          return {
            engine: "vector+rerank",
            indexedChunks: stats.totalChunks,
            mode: "semantic",
            query,
            rerankModel: rerankResult.model,
            results: parsed,
            total: parsed.length,
          };
        } catch (error) {
          const msg = getCodebaseSearchErrorMessage(error);
          log.warn(`Rerank 失败，使用原始语义搜索结果: ${msg}`);
          // 继续使用原始结果
        }
      }

      return {
        engine: "vector",
        indexedChunks: stats.totalChunks,
        mode: "semantic",
        query,
        results: parsed,
        total: parsed.length,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    const msg = getCodebaseSearchErrorMessage(error);
    log.warn(`语义搜索失败，回退到文本搜索: ${msg}`);
    // 回退到文本搜索
    const result = await searchText(query, cwd, include, exclude, limit);
    return { ...result, reason: msg, semanticFallback: true };
  }
}

// ── 混合搜索(语义 + Rerank + 精确搜索)───────────────────────────────

/** 执行混合搜索：语义搜索 + 精确搜索，去重合并后按相关性排序 */
export async function searchHybrid(
  query: string,
  cwd: string,
  include?: string,
  exclude?: string[],
  limit?: number,
  rerankTopN?: number,
): Promise<Record<string, unknown>> {
  log.debug(`执行混合搜索: ${query}`);

  // 1. 执行语义搜索(获取更多结果用于 rerank)
  const semanticResult = await searchSemantic(
    query,
    cwd,
    include,
    exclude,
    Math.max((limit ?? 50) * 2, 100),
    true,
    rerankTopN,
  );

  // 2. 执行精确搜索
  const exactResult = await searchText(query, cwd, include, exclude, limit);

  // 3. 合并结果
  const semanticResults = (semanticResult.results as SemanticSearchResultItem[]) || [];
  const exactResults = (exactResult.results as ExactSearchResultItem[]) || [];

  // 去重(优先保留语义搜索结果)
  const seen = new Set<string>();
  const merged: { file: string; line: number; text: string; score: number; type: string; source: string }[] = [];

  for (const r of semanticResults) {
    const key = `${r.file}:${r.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ ...r, source: "semantic" });
    }
  }

  for (const r of exactResults) {
    const key = `${r.file}:${r.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ ...r, score: 0.5, source: "exact" });
    }
  }

  // 4. 排序:语义搜索优先，然后按分数
  merged.sort((a, b) => {
    if (a.source === "semantic" && b.source !== "semantic") {
      return -1;
    }
    if (a.source !== "semantic" && b.source === "semantic") {
      return 1;
    }
    return b.score - a.score;
  });

  const finalResults = merged.slice(0, limit ?? 50);

  return {
    engine: "vector+rerank+ripgrep",
    mode: "hybrid",
    query,
    results: finalResults,
    sources: {
      exact: exactResults.length,
      semantic: semanticResults.length,
    },
    total: finalResults.length,
  };
}

/**
 * ACE 增强搜索引擎 — 多源融合搜索
 *
 * 职责:
 *   - 优先查询 SQLite 符号索引(快速、结构化)
 *   - 回退到 ctags/regex 文件解析(无索引时)
 *   - 可选融合 vectorDb 语义搜索
 *   - 返回统一的 RankedResult
 *
 * 模块功能:
 *   - enhancedSearch: 多源融合搜索主函数，返回排序后的结果和来源统计
 *   - EnhancedSearchParams: 搜索参数接口定义
 *
 * 使用场景:
 *   - IDE/编辑器中的代码导航搜索
 *   - 代码库符号快速定位
 *   - 跨文件的定义和引用搜索
 *
 * 边界:
 * 1. vectorDb 搜索需 embedding API 可用，否则跳过
 * 2. ctags 不可用时自动回退到正则解析
 * 3. grep 作为最后的兜底搜索方式
 *
 * 流程:
 * 1. 尝试 SQLite 符号索引搜索(最快)
 * 2. 回退到 ctags/regex 解析补充结果
 * 3. 可选:向量数据库语义搜索
 * 4. 最终兜底:grep 全文搜索
 * 5. 所有结果通过 rankResults 统一排序
 */

import { createLogger } from "@/core/logging/logger";
import { exec } from "@/bus";
import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";
import { type RankableResult, rankResults } from "./resultRanker";

const log = createLogger("ace-enhanced:engine");

const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  "vendor",
  "__pycache__",
  ".tox",
  "target",
];

/** 增强搜索的参数配置 */
export interface EnhancedSearchParams {
  query: string;
  cwd?: string;
  include?: string;
  exclude?: string[];
  maxResults?: number;
  enableSemantic?: boolean;
  symbolType?: string;
  language?: string;
}

/** 多源融合搜索主函数，依次查询索引、ctags、语义和 grep，返回排序后的结果与来源统计 @param params 搜索参数 @returns 排序结果、查询语句和各来源命中数 */
export async function enhancedSearch(params: EnhancedSearchParams): Promise<{
  results: ReturnType<typeof rankResults>;
  query: string;
  sources: { index: number; ctags: number; semantic: number; grep: number };
  searchTimeMs: number;
}> {
  const start = performance.now();
  const { query } = params;
  const cwd = params.cwd ?? process.cwd();
  const limit = params.maxResults ?? 50;
  const excludeSet = new Set([...DEFAULT_EXCLUDES, ...(params.exclude ?? [])]);

  const results: RankableResult[] = [];
  let indexCount = 0;
  let ctagsCount = 0;
  let semanticCount = 0;
  let grepCount = 0;

  // 1. SQLite 符号索引(最快)
  try {
    // aceCore/symbolIndex 为尚未实现的 SQLite 符号索引，暂不可用
    // @ts-expect-error module not yet implemented
    const { symbolIndex } = await import("@/tool/codebaseSearch/aceCore/symbolIndex");
    await symbolIndex.init();

    const indexResults = await symbolIndex.searchByName(query, Math.min(limit * 3, 150));
    for (const sym of indexResults) {
      if (params.language && sym.language !== params.language) {
        continue;
      }
      if (params.symbolType && sym.type !== params.symbolType) {
        continue;
      }
      if (excludeDirCheck(sym.filePath, excludeSet)) {
        continue;
      }

      results.push({
        documentation: sym.documentation,
        endLine: sym.endLine ?? sym.line,
        filePath: sym.filePath,
        isFromIndex: true,
        kind: sym.type,
        language: sym.language,
        line: sym.line,
        modifiers: sym.modifiers,
        name: sym.name,
        signature: sym.signature,
      });
      indexCount++;
    }
  } catch (error) {
    log.debug("符号索引查询失败，回退到 ctags", { error: getCodebaseSearchErrorMessage(error) });
  }

  // 2. ctags/regex 解析(补充未索引的文件)
  if (results.length < limit) {
    try {
      const { parseLegacyFileSymbols: parseFileSymbols } = await import("@/tool/codebaseSearch/aceRuntime");
      const files = collectSourceFiles(cwd, excludeSet, params.include, Math.min(limit - results.length, 100));

      for (const file of files) {
        if (results.length >= limit * 2) {
          break;
        }
        try {
          const symbols = await parseFileSymbols(file);
          for (const sym of symbols) {
            if (sym.name.toLowerCase().includes(query.toLowerCase())) {
              if (results.some((r) => r.filePath === file && r.line === sym.line)) {
                continue;
              }
              results.push({
                context: sym.parent,
                filePath: file,
                isFromIndex: false,
                kind: sym.kind,
                language: sym.language,
                line: sym.line,
                name: sym.name,
                signature: sym.signature,
                type: sym.kind,
              });
              ctagsCount++;
            }
          }
        } catch (error) {
          log.debug("增强搜索符号解析失败，跳过当前文件", {
            error: getCodebaseSearchErrorMessage(error),
            file,
          });
        }
      }
    } catch (error) {
      log.debug("ctags 解析失败", { error: getCodebaseSearchErrorMessage(error) });
    }
  }

  // 3. 语义搜索(可选)
  if (params.enableSemantic && results.length < limit * 3) {
    try {
      const { VectorDb } = await import("@/tool/codebaseSearch/indexer/vectorDb");
      const { embedText } = await import("@api");

      let appConfig: any;
      try {
        const { config } = await import("@config");
        appConfig = await config();
      } catch (error) {
        log.debug("增强搜索配置加载失败，跳过语义搜索", {
          error: getCodebaseSearchErrorMessage(error),
        });
      }

      if (appConfig) {
        const { embedding } = await embedText(appConfig, query);
        const db = new VectorDb();
        try {
          const vectorResults = db.search(embedding, {
            filePathFilter: params.include,
            limit: Math.min((limit - results.length) * 2, 100),
            minScore: 0.35,
          });

          for (const r of vectorResults) {
            if (excludeDirCheck(r.chunk.filePath, excludeSet)) {
              continue;
            }
            if (
              results.some((existing) => existing.filePath === r.chunk.filePath && existing.line === r.chunk.startLine)
            ) {
              continue;
            }

            results.push({
              context: r.chunk.content.slice(0, 150),
              endLine: r.chunk.endLine,
              filePath: r.chunk.filePath,
              isFromIndex: false,
              language: r.chunk.languageId ?? "unknown",
              line: r.chunk.startLine,
              name: "",
              semanticScore: r.score,
            });
            semanticCount++;
          }
        } finally {
          db.close();
        }
      }
    } catch (error) {
      log.debug("语义搜索跳过", { error: getCodebaseSearchErrorMessage(error) });
    }
  }

  // 4. grep 兜底(结果仍不足时)
  if (results.length < 10) {
    try {
      const grepResults = await runGrep(query, cwd, params.include, params.exclude, limit - results.length);
      for (const r of grepResults) {
        if (results.some((existing) => existing.filePath === r.file && existing.line === r.line)) {
          continue;
        }
        results.push({
          context: r.text,
          filePath: r.file,
          isFromIndex: false,
          language: "unknown",
          line: r.line,
          name: query,
        });
        grepCount++;
      }
    } catch (error) {
      log.debug("增强搜索 grep 兜底失败，返回已有结果", {
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  }

  const ranked = rankResults(results, query, limit);
  const searchTimeMs = performance.now() - start;

  return {
    query,
    results: ranked,
    searchTimeMs,
    sources: { ctags: ctagsCount, grep: grepCount, index: indexCount, semantic: semanticCount },
  };
}

function excludeDirCheck(filePath: string, excludeSet: Set<string>): boolean {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.some((p) => excludeSet.has(p));
}

function collectSourceFiles(cwd: string, excludeSet: Set<string>, include?: string, maxFiles = 100): string[] {
  const { readdirSync } = require("node:fs");
  const { join } = require("node:path");
  const files: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 10 || files.length >= maxFiles) {
      return;
    }
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (excludeSet.has(entry.name)) {
          continue;
        }
        if (entry.name.startsWith(".") && entry.name !== ".") {
          continue;
        }
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else {
          if (include && !fullPath.endsWith(include.replace("*", ""))) {
            continue;
          }
          if (
            fullPath.endsWith(".ts") ||
            fullPath.endsWith(".tsx") ||
            fullPath.endsWith(".js") ||
            fullPath.endsWith(".jsx") ||
            fullPath.endsWith(".py") ||
            fullPath.endsWith(".go") ||
            fullPath.endsWith(".rs") ||
            fullPath.endsWith(".java") ||
            fullPath.endsWith(".kt") ||
            fullPath.endsWith(".swift") ||
            fullPath.endsWith(".rb") ||
            fullPath.endsWith(".php") ||
            fullPath.endsWith(".c") ||
            fullPath.endsWith(".cpp") ||
            fullPath.endsWith(".cs")
          ) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      log.debug("增强搜索目录读取失败，跳过当前目录", {
        dir,
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  }

  walk(cwd, 0);
  return files;
}

async function runGrep(
  query: string,
  cwd: string,
  include?: string,
  exclude?: string[],
  limit = 30,
): Promise<{ file: string; line: number; text: string }[]> {
  const args = ["--line-number", "--no-heading", "--color=never", "--max-count", String(limit), "--word-regexp"];
  if (include) {
    args.push("--glob", include);
  }
  const excludes = [...DEFAULT_EXCLUDES, ...(exclude ?? [])];
  for (const ex of excludes) {
    args.push("--glob", `!${ex}`);
  }
  args.push("--", query, cwd);

  try {
    const result = await exec(["rg", ...args], { timeout: 10_000 });
    if (result.exitCode !== 0) {
      return [];
    }
    const output: { file: string; line: number; text: string }[] = [];
    for (const line of result.stdout.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
      if (match) {
        output.push({ file: match[1]!, line: parseInt(match[2]!, 10), text: match[3]! });
      }
    }
    return output;
  } catch (error) {
    log.debug("增强搜索 ripgrep 执行失败，返回空结果", {
      cwd,
      error: getCodebaseSearchErrorMessage(error),
    });
    return [];
  }
}

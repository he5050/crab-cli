import { createLogger } from "@/core/logging/logger";
import { escapeRegex } from "@/tool/shared";
import { isSSHPath, splitSshUrl } from "./aceRuntime/pathRemote";
import { createCodebaseSearchError, getCodebaseSearchErrorMessage, toCodebaseSearchFailure } from "./errors";
import { DEFAULT_EXCLUDES, buildExcludeArgs, runRg, collectFilePaths, collectFiles } from "./searchHelpers";
import { searchText, searchSemantic, searchHybrid } from "./semanticSearch";

const log = createLogger("tool:codebase-search");

/** 代码库搜索的运行参数配置 */
export interface RunSearchOptions {
  query: string;
  mode: string;
  cwd: string;
  include?: string;
  exclude?: string[];
  limit: number;
  useRerank: boolean;
  rerankTopN: number;
}

/** 根据搜索模式（text/symbols/references/semantic/hybrid/ace/path）执行代码库搜索 */
export async function runCodebaseSearch(options: RunSearchOptions): Promise<Record<string, unknown>> {
  if (isSSHPath(options.cwd)) {
    return searchRemote(options);
  }

  switch (options.mode) {
    case "symbols": {
      return searchSymbols(options.query, options.cwd, options.include, options.exclude, options.limit);
    }
    case "references": {
      return searchReferences(options.query, options.cwd, options.include, options.exclude, options.limit);
    }
    case "semantic": {
      return searchSemantic(
        options.query,
        options.cwd,
        options.include,
        options.exclude,
        options.limit,
        options.useRerank,
        options.rerankTopN,
      );
    }
    case "hybrid": {
      return searchHybrid(
        options.query,
        options.cwd,
        options.include,
        options.exclude,
        options.limit,
        options.rerankTopN,
      );
    }
    case "ace": {
      return searchAceSymbols(options.query, options.cwd, options.include, options.exclude, options.limit);
    }
    case "path": {
      return fuzzySearchPaths(options.query, options.cwd, options.exclude, options.limit);
    }
    case "text":
    default: {
      return searchText(options.query, options.cwd, options.include, options.exclude, options.limit);
    }
  }
}

async function searchRemote(options: RunSearchOptions): Promise<Record<string, unknown>> {
  const parts = splitSshUrl(options.cwd);
  if (!parts) {
    const failure = toCodebaseSearchFailure(
      createCodebaseSearchError(
        `无效的 SSH 搜索路径: ${options.cwd}`,
        {
          mode: options.mode,
          operation: "remote-search",
          path: options.cwd,
          query: options.query,
        },
        "param",
      ),
    );
    return {
      engine: "ssh",
      mode: options.mode,
      query: options.query,
      results: [],
      total: 0,
      ...failure,
    };
  }

  const remoteMode = normalizeRemoteSearchMode(options.mode);
  if (!remoteMode) {
    const failure = toCodebaseSearchFailure(
      createCodebaseSearchError(
        `SSH 远程搜索暂不支持 ${options.mode} 模式`,
        {
          mode: options.mode,
          operation: "remote-search",
          path: options.cwd,
          query: options.query,
        },
        "unavailable",
      ),
    );
    return {
      engine: "ssh",
      mode: options.mode,
      query: options.query,
      results: [],
      total: 0,
      ...failure,
    };
  }

  const { remoteSearch } = await import("./aceRuntime");
  const results = await remoteSearch(
    {
      host: parts.host,
      port: parts.port,
      username: parts.username,
    },
    options.query,
    parts.root,
    remoteMode,
    options.limit,
  );

  return {
    engine: "ssh-grep",
    mode: options.mode,
    path: options.cwd,
    query: options.query,
    results,
    total: results.length,
  };
}

function normalizeRemoteSearchMode(mode: string): "symbols" | "references" | "text" | null {
  if (mode === "symbols" || mode === "references" || mode === "text") {
    return mode;
  }
  return null;
}

// ── 符号搜索 ──────────────────────────────────────────────────────

async function searchSymbols(
  query: string,
  cwd: string,
  include?: string,
  exclude?: string[],
  limit?: number,
): Promise<Record<string, unknown>> {
  // 使用 ripgrep 搜索定义模式
  // 匹配:function xxx, class xxx, const xxx, let xxx, var xxx, type xxx, interface xxx, export xxx
  const patterns = [
    `function\\s+${escapeRegex(query)}`,
    `(?:export\\s+)?(?:default\\s+)?(?:class|interface|type|enum)\\s+${escapeRegex(query)}`,
    `(?:export\\s+)?(?:const|let|var)\\s+${escapeRegex(query)}`,
  ];

  const args = ["--line-number", "--no-heading", "--color=never", "--max-count", String(limit ?? 50)];
  if (include) {
    args.push("--glob", include);
  }
  args.push(...buildExcludeArgs(exclude));
  args.push("--", patterns.map((p) => `(${p})`).join("|"), cwd);

  const results = await runRg(args, cwd);
  const parsed = results.map((r) => ({
    ...r,
    type: "symbol" as const,
  }));

  return { engine: "ripgrep", mode: "symbols", query, results: parsed, total: parsed.length };
}

// ── 引用搜索 ──────────────────────────────────────────────────────

async function searchReferences(
  query: string,
  cwd: string,
  include?: string,
  exclude?: string[],
  limit?: number,
): Promise<Record<string, unknown>> {
  const args = ["--line-number", "--no-heading", "--color=never", "--max-count", String(limit ?? 50), "--word-regexp"];
  if (include) {
    args.push("--glob", include);
  }
  args.push(...buildExcludeArgs(exclude));
  args.push("--", query, cwd);

  const results = await runRg(args, cwd);
  const parsed = results.map((r) => ({
    ...r,
    type: "reference" as const,
  }));

  return { engine: "ripgrep", mode: "references", query, results: parsed, total: parsed.length };
}

// ── ACE 增强搜索 ─────────────────────────────────────────────────

async function searchAceSymbols(
  query: string,
  cwd: string,
  include?: string,
  exclude?: string[],
  limit?: number,
): Promise<Record<string, unknown>> {
  const {
    parseLegacyFileSymbols: parseFileSymbols,
    detectLegacyLanguage: detectLanguage,
    getSymbolPatterns,
  } = await import("./aceRuntime");

  log.debug(`ACE 增强搜索: ${query}`);

  const extFilter = include?.replace("*", "") ?? undefined;
  const excludeSet = new Set([...DEFAULT_EXCLUDES, ...(exclude ?? [])]);
  const files = collectFiles(cwd, excludeSet, extFilter, limit ?? 200);

  const allSymbols: {
    name: string;
    kind: string;
    file: string;
    line: number;
    endLine?: number;
    language: string;
    signature?: string;
    parent?: string;
    type: string;
  }[] = [];

  // 解析每个文件的符号
  for (const file of files) {
    try {
      const symbols = await parseFileSymbols(file);
      for (const sym of symbols) {
        if (sym.name.toLowerCase().includes(query.toLowerCase())) {
          allSymbols.push({ ...sym, type: "ace-symbol" });
        }
      }
    } catch (error) {
      log.debug("ACE 符号解析失败，跳过当前文件", {
        error: getCodebaseSearchErrorMessage(error),
        file,
      });
    }
    if (allSymbols.length >= (limit ?? 50)) {
      break;
    }
  }

  // 如果符号搜索结果不足，补充 grep 结果
  if (allSymbols.length < (limit ?? 50)) {
    const lang = files.length > 0 ? detectLanguage(files[0]!) : "Unknown";
    const patterns = getSymbolPatterns(lang, query);
    for (const pattern of patterns) {
      const grepArgs = [
        "--line-number",
        "--no-heading",
        "--color=never",
        "--max-count",
        String((limit ?? 50) - allSymbols.length),
      ];
      if (include) {
        grepArgs.push("--glob", include);
      }
      grepArgs.push(...buildExcludeArgs(exclude));
      grepArgs.push("--", pattern.source, cwd);

      const grepResults = await runRg(grepArgs, cwd);
      for (const r of grepResults) {
        if (!allSymbols.some((s) => s.file === r.file && s.line === r.line)) {
          allSymbols.push({
            file: r.file,
            kind: "unknown",
            language: detectLanguage(r.file),
            line: r.line,
            name: query,
            type: "ace-grep",
          });
        }
      }
    }
  }

  return {
    engine: "ctags+ripgrep",
    mode: "ace",
    query,
    results: allSymbols.slice(0, limit ?? 50),
    total: allSymbols.length,
  };
}

// ── 路径模糊搜索 ─────────────────────────────────────────────────

async function fuzzySearchPaths(
  query: string,
  cwd: string,
  exclude?: string[],
  limit?: number,
): Promise<Record<string, unknown>> {
  const { fuzzyPathSearch } = await import("./aceRuntime");

  log.debug(`路径搜索: ${query}`);

  const excludeSet = new Set([...DEFAULT_EXCLUDES, ...(exclude ?? [])]);
  const allPaths = collectFilePaths(cwd, excludeSet);

  const results = fuzzyPathSearch(query, allPaths, limit ?? 50);

  return {
    engine: "fuzzy",
    mode: "path",
    query,
    results: results.map((r) => ({
      path: r.path,
      score: r.score,
      segments: r.segments,
      type: "path" as const,
    })),
    total: results.length,
  };
}

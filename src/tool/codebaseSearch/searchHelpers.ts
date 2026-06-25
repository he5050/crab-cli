import { createLogger } from "@/core/logging/logger";
import { exec, commandExists } from "@/bus";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getCodebaseSearchErrorMessage } from "./errors";

const log = createLogger("tool:codebase-search");

/** 缓存 rg 是否可用，避免重复检查 */
let rgAvailable: boolean | null = null;

/** 默认排除的目录 */
export const DEFAULT_EXCLUDES = [
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

// ── 构造排除参数 ──────────────────────────────────────────────────

/** 构建 ripgrep 排除参数列表，合并默认排除和自定义排除 */
export function buildExcludeArgs(exclude?: string[]): string[] {
  const excludes = [...DEFAULT_EXCLUDES, ...(exclude ?? [])];
  const args: string[] = [];
  for (const pattern of excludes) {
    args.push("--glob", `!${pattern}`);
  }
  return args;
}

// ── 文件收集工具 ──────────────────────────────────────────────────

/** 收集文件路径(用于路径搜索) */
export function collectFilePaths(dir: string, excludeSet: Set<string>, maxFiles = 5000): string[] {
  const paths: string[] = [];

  function walk(d: string, depth: number) {
    if (depth > 10 || paths.length >= maxFiles) {
      return;
    }
    try {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        if (excludeSet.has(entry.name)) {
          continue;
        }
        if (entry.name.startsWith(".") && entry.name !== ".") {
          continue;
        }
        const fullPath = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else {
          paths.push(fullPath);
        }
      }
    } catch (error) {
      log.debug("路径搜索目录读取失败，跳过当前目录", {
        dir: d,
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  }

  walk(dir, 0);
  return paths;
}

/** 收集文件(用于 ACE 搜索，带扩展名过滤) */
export function collectFiles(dir: string, excludeSet: Set<string>, extFilter?: string, maxFiles = 200): string[] {
  const files: string[] = [];

  function walk(d: string, depth: number) {
    if (depth > 10 || files.length >= maxFiles) {
      return;
    }
    try {
      const entries = readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        if (excludeSet.has(entry.name)) {
          continue;
        }
        if (entry.name.startsWith(".") && entry.name !== ".") {
          continue;
        }
        const fullPath = join(d, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else {
          if (extFilter && !fullPath.endsWith(extFilter)) {
            continue;
          }
          files.push(fullPath);
        }
      }
    } catch (error) {
      log.debug("ACE 文件收集目录读取失败，跳过当前目录", {
        dir: d,
        error: getCodebaseSearchErrorMessage(error),
      });
    }
  }

  walk(dir, 0);
  return files;
}

// ── ripgrep 执行工具 ──────────────────────────────────────────────

/** 执行 ripgrep 命令并解析输出为结构化结果数组；rg 不可用时回退到 grep */
export async function runRg(args: string[], cwd: string): Promise<{ file: string; line: number; text: string }[]> {
  try {
    // 首次调用时检查 rg 是否可用
    if (rgAvailable === null) {
      rgAvailable = await commandExists("rg");
    }

    if (rgAvailable) {
      const result = await exec(["rg", ...args], { timeout: 10_000 });
      if (result.exitCode !== 0) {
        return [];
      }
      return parseOutput(result.stdout);
    }

    // rg 不可用，回退到 grep
    log.debug("ripgrep 不可用，回退到 grep", { cwd });
    const grepResult = await runGrepFallback(args, cwd);
    return grepResult;
  } catch (error) {
    log.debug("搜索执行失败，返回空结果", {
      cwd,
      error: getCodebaseSearchErrorMessage(error),
    });
    return [];
  }
}

/**
 * 将 rg 参数转换为 grep 命令并执行。
 * 支持 rg 常用参数: --line-number, --no-heading, --color=never,
 * --max-count, --glob, --word-regexp, 以及 -- 分隔符后的 pattern + path。
 */
async function runGrepFallback(rgArgs: string[], cwd: string): Promise<{ file: string; line: number; text: string }[]> {
  // 解析 rg 参数
  let maxCount = 50;
  let wordRegexp = false;
  let includePattern: string | null = null;
  const excludePatterns: string[] = [];
  let pattern = "";
  let searchPath = cwd;

  let pastSeparator = false;
  for (let i = 0; i < rgArgs.length; i++) {
    const arg = rgArgs[i]!;
    if (pastSeparator) {
      if (!pattern) {
        pattern = arg;
      } else {
        searchPath = arg;
      }
      continue;
    }
    if (arg === "--") {
      pastSeparator = true;
      continue;
    }
    if (arg === "--line-number" || arg === "--no-heading" || arg === "--color=never") {
      continue;
    }
    if (arg === "--word-regexp") {
      wordRegexp = true;
      continue;
    }
    if (arg === "--max-count") {
      maxCount = parseInt(rgArgs[++i] ?? "50", 10);
      continue;
    }
    if (arg === "--glob") {
      const globVal = rgArgs[++i] ?? "";
      if (globVal.startsWith("!")) {
        excludePatterns.push(globVal.slice(1));
      } else {
        includePattern = globVal;
      }
      continue;
    }
    // 其他未知参数跳过
  }

  if (!pattern) {
    return [];
  }

  // 构建 grep 命令
  const grepArgs: string[] = ["-rn", "--color=never"];
  if (wordRegexp) {
    grepArgs.push("-w");
  }

  // 添加 include/exclude
  if (includePattern) {
    // 将 glob 模式转为 grep --include 格式
    const inc = includePattern.replace(/^\*\./, "*.");
    grepArgs.push(`--include=${inc}`);
  }
  for (const exc of excludePatterns) {
    const excNormalized = exc.replace(/^\*\./, "*.");
    grepArgs.push(`--exclude=${excNormalized}`);
    grepArgs.push(`--exclude-dir=${exc}`);
  }
  // 默认排除常见目录
  for (const defaultExc of DEFAULT_EXCLUDES) {
    grepArgs.push(`--exclude-dir=${defaultExc}`);
  }

  grepArgs.push("--", pattern, searchPath);

  const result = await exec(["grep", ...grepArgs], { timeout: 10_000 });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    // grep exit code 1 = no matches, which is fine
    return [];
  }

  const parsed = parseOutput(result.stdout);

  // 应用 maxCount 限制（按文件分组后限制每个文件的结果数）
  if (maxCount > 0) {
    const fileCountMap = new Map<string, number>();
    const limited: { file: string; line: number; text: string }[] = [];
    for (const r of parsed) {
      const count = fileCountMap.get(r.file) ?? 0;
      if (count < maxCount) {
        limited.push(r);
        fileCountMap.set(r.file, count + 1);
      }
    }
    return limited;
  }

  return parsed;
}

/** 解析 ripgrep/搜索工具输出为结构化结果数组 */
export function parseOutput(output: string): { file: string; line: number; text: string }[] {
  const results: { file: string; line: number; text: string }[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
    if (match) {
      results.push({ file: match[1]!, line: parseInt(match[2]!, 10), text: match[3]! });
    }
  }
  return results;
}

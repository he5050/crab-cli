/**
 * 远程命令构建器 — 从 remote.ts 拆分
 *
 * 职责:
 *   - 构建远程文本搜索命令(git grep → ripgrep → grep)
 *   - 构建远程引用搜索命令(word-bounded)
 *   - 构建远程定义搜索命令(grep 模式)
 *   - 构建远程 ctags 列表命令
 *   - 解析 ctags NDJSON 输出
 *   - 解析远程 grep 输出
 *   - ctags kind 到 SymbolType 映射
 */

import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";
import type { CodeSymbol, SymbolType } from "./types";
import { createLogger } from "@/core/logging/logger";
import { detectLanguage } from "./language";
import { REMOTE_EXCLUDE_DIRS, escapeShellArg } from "./remote";

const log = createLogger("ace:remote");

// ─── 命令构建 ──────────────────────────────────────────────────

/**
 * 构建远程文本搜索命令。
 * 优先级: git grep → ripgrep → grep
 */
/** buildRemoteTextSearchCommand 的实现 */
export function buildRemoteTextSearchCommand(opts: {
  remoteRoot: string;
  pattern: string;
  fileGlob?: string;
  isRegex: boolean;
  maxResults: number;
  toolset: { isGitRepo: boolean; hasGit: boolean; hasRg: boolean; hasGrep: boolean };
}): { command: string; tool: "git-grep" | "rg" | "grep" } | null {
  const { remoteRoot, pattern, fileGlob, isRegex, maxResults, toolset } = opts;
  const root = escapeShellArg(remoteRoot);
  const cd = `cd ${root} && `;
  const limit = Math.max(1, maxResults);
  const patternArg = escapeShellArg(pattern);

  // Strategy 1: git grep
  if (toolset.isGitRepo && toolset.hasGit) {
    let cmd = `git grep -n --no-color --untracked --ignore-case`;
    cmd += isRegex ? ` -E` : ` -F`;
    cmd += ` ${patternArg}`;
    if (fileGlob) {
      cmd += ` -- ${escapeShellArg(fileGlob)}`;
    }
    cmd += ` | head -n ${limit}`;
    return { command: cd + cmd, tool: "git-grep" };
  }

  // Strategy 2: ripgrep
  if (toolset.hasRg) {
    const flags: string[] = ["-n", "--no-heading", "--color=never"];
    if (!isRegex) {
      flags.push("-F");
    }
    if (fileGlob) {
      flags.push("-g", escapeShellArg(fileGlob));
    }
    for (const dir of REMOTE_EXCLUDE_DIRS) {
      flags.push("-g", escapeShellArg(`!${dir}/**`));
    }
    const cmd = `rg ${flags.join(" ")} ${patternArg} . | head -n ${limit}`;
    return { command: cd + cmd, tool: "rg" };
  }

  // Strategy 3: grep
  if (toolset.hasGrep) {
    let cmd = `grep -rn --color=never`;
    if (!isRegex) {
      cmd += ` -F`;
    }
    for (const dir of REMOTE_EXCLUDE_DIRS) {
      cmd += ` --exclude-dir=${escapeShellArg(dir)}`;
    }
    if (fileGlob) {
      cmd += ` --include=${escapeShellArg(fileGlob)}`;
    }
    cmd += ` ${patternArg} .`;
    cmd += ` | head -n ${limit}`;
    return { command: cd + cmd, tool: "grep" };
  }

  return null;
}

/**
 * 构建远程引用搜索命令(word-bounded)。
 */
/** buildRemoteReferencesCommand 的实现 */
export function buildRemoteReferencesCommand(opts: {
  remoteRoot: string;
  symbolName: string;
  maxResults: number;
  toolset: { isGitRepo: boolean; hasGit: boolean; hasRg: boolean; hasGrep: boolean };
}): { command: string } | null {
  const { remoteRoot, symbolName, maxResults, toolset } = opts;
  const root = escapeShellArg(remoteRoot);
  const cd = `cd ${root} && `;
  const limit = Math.max(1, maxResults);
  const symArg = escapeShellArg(symbolName);

  if (toolset.isGitRepo && toolset.hasGit) {
    return {
      command: `${cd}git grep -n --no-color --untracked --ignore-case -w -F ${symArg} | head -n ${limit}`,
    };
  }
  if (toolset.hasRg) {
    const excludes = REMOTE_EXCLUDE_DIRS.map((d) => `-g ${escapeShellArg(`!${d}/**`)}`).join(" ");
    return {
      command: `${cd}rg -n --no-heading --color=never -w -F ${excludes} ${symArg} . | head -n ${limit}`,
    };
  }
  if (toolset.hasGrep) {
    const excludes = REMOTE_EXCLUDE_DIRS.map((d) => `--exclude-dir=${escapeShellArg(d)}`).join(" ");
    return {
      command: `${cd}grep -rnw --color=never -F ${excludes} ${symArg} . | head -n ${limit}`,
    };
  }
  return null;
}

/**
 * 构建远程定义搜索命令(grep 模式)。
 */
/** buildRemoteDefinitionGrepCommand 的实现 */
export function buildRemoteDefinitionGrepCommand(opts: {
  remoteRoot: string;
  symbolName: string;
  toolset: { isGitRepo: boolean; hasGit: boolean; hasRg: boolean; hasGrep: boolean };
  maxResults: number;
}): { command: string } | null {
  const { remoteRoot, symbolName, toolset, maxResults } = opts;
  const sym = symbolName.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const pattern = `\\b(function|class|interface|def|func|const|let|var|type|enum|struct|trait|impl|fn)[[:space:]]+${sym}\\b`;
  const root = escapeShellArg(remoteRoot);
  const cd = `cd ${root} && `;
  const patternArg = escapeShellArg(pattern);
  const limit = Math.max(1, maxResults);

  if (toolset.isGitRepo && toolset.hasGit) {
    return {
      command: `${cd}git grep -n --no-color --untracked -E ${patternArg} | head -n ${limit}`,
    };
  }
  if (toolset.hasRg) {
    const excludes = REMOTE_EXCLUDE_DIRS.map((d) => `-g ${escapeShellArg(`!${d}/**`)}`).join(" ");
    return {
      command: `${cd}rg -n --no-heading --color=never ${excludes} ${patternArg} . | head -n ${limit}`,
    };
  }
  if (toolset.hasGrep) {
    const excludes = REMOTE_EXCLUDE_DIRS.map((d) => `--exclude-dir=${escapeShellArg(d)}`).join(" ");
    return {
      command: `${cd}grep -rnE --color=never ${excludes} ${patternArg} . | head -n ${limit}`,
    };
  }
  return null;
}

// ─── ctags 输出解析 ────────────────────────────────────────────

/**
 * 将 ctags kind 映射到 SymbolType。
 */
function ctagsKindToSymbolType(kind: string | undefined): SymbolType {
  const k = (kind || "").toLowerCase();
  switch (k) {
    case "function":
    case "func":
    case "subroutine": {
      return "function";
    }
    case "method": {
      return "method";
    }
    case "class": {
      return "class";
    }
    case "interface": {
      return "interface";
    }
    case "enum":
    case "enumerator": {
      return "enum";
    }
    case "struct":
    case "typedef":
    case "type":
    case "alias": {
      return "type";
    }
    case "variable":
    case "var":
    case "field":
    case "member":
    case "property": {
      return "variable";
    }
    case "constant":
    case "const":
    case "macro": {
      return "constant";
    }
    default: {
      return "function";
    }
  }
}

interface CtagsJsonEntry {
  _type?: string;
  name?: string;
  path?: string;
  line?: number;
  kind?: string;
  scope?: string;
  signature?: string;
  language?: string;
}

/**
 * 解析 ctags NDJSON 输出为 CodeSymbol[]。
 */
/** parseCtagsJsonOutput 的实现 */
export function parseCtagsJsonOutput(
  stdout: string,
  options: {
    remoteRoot: string;
    maxSymbols?: number;
  },
): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  if (!stdout) {
    return symbols;
  }

  const lines = stdout.split("\n");
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed[0] !== "{") {
      continue;
    }

    let entry: CtagsJsonEntry;
    try {
      entry = JSON.parse(trimmed) as CtagsJsonEntry;
    } catch (error) {
      log.debug("parseCtagsJsonOutput: skip malformed ctags JSON line", {
        error: getCodebaseSearchErrorMessage(error),
      });
      continue;
    }

    if (entry._type && entry._type !== "tag") {
      continue;
    }
    if (!entry.name || !entry.path || typeof entry.line !== "number") {
      continue;
    }

    let filePath = entry.path.replace(/\\/g, "/");
    if (filePath.startsWith("./")) {
      filePath = filePath.slice(2);
    }

    const language = entry.language?.toLowerCase() || detectLanguage(filePath) || "plaintext";

    symbols.push({
      column: 1,
      filePath,
      language,
      line: entry.line,
      name: entry.name,
      scope: entry.scope,
      signature: entry.signature,
      type: ctagsKindToSymbolType(entry.kind),
    });

    if (options.maxSymbols && symbols.length >= options.maxSymbols) {
      break;
    }
  }

  return symbols;
}

/**
 * 构建远程 ctags 列表命令。
 */
/** buildRemoteCtagsListCommand 的实现 */
export function buildRemoteCtagsListCommand(remoteRoot: string): string {
  const root = escapeShellArg(remoteRoot);
  const excludes = REMOTE_EXCLUDE_DIRS.map((d) => `--exclude=${escapeShellArg(d)}`).join(" ");
  return `cd ${root} && ctags -R --output-format=json --fields=+nKzs ${excludes} -f - .`;
}

// ─── 远程 grep 输出解析 ────────────────────────────────────────

/** 远程 grep 命中结果 */
export interface RemoteGrepHit {
  filePath: string;
  line: number;
  column: number;
  content: string;
}

/**
 * 解析远程 grep 输出(path:line:content 格式)。
 */
/** parseRemoteGrepOutput 的实现 */
export function parseRemoteGrepOutput(stdout: string): RemoteGrepHit[] {
  const results: RemoteGrepHit[] = [];
  if (!stdout) {
    return results;
  }

  const lines = stdout.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim()) {
      continue;
    }
    const first = raw.indexOf(":");
    if (first === -1) {
      continue;
    }
    const second = raw.indexOf(":", first + 1);
    if (second === -1) {
      continue;
    }

    const filePathRaw = raw.substring(0, first);
    const lineStr = raw.substring(first + 1, second);
    const content = raw.substring(second + 1);
    const lineNumber = parseInt(lineStr, 10);
    if (isNaN(lineNumber)) {
      continue;
    }

    const filePath = filePathRaw.startsWith("./") ? filePathRaw.slice(2) : filePathRaw;

    results.push({
      column: 1,
      content: content.trim(),
      filePath: filePath.replace(/\\/g, "/"),
      line: lineNumber,
    });
  }

  return results;
}

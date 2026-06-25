/**
 * 远程 ACE 搜索工具 — SSH 远程代码搜索聚合入口
 *
 * 拆分为:
 *   - remoteCommandBuilder.ts: 命令构建与输出解析
 *
 * 本文件保留:
 *   - 工具检测与缓存管理
 *   - Shell 参数转义
 *   - 远程 ctags 运行
 *   - re-export 命令构建与解析 API
 */

import { getCodebaseSearchErrorMessage } from "@/tool/codebaseSearch/errors";
import type { CodeSymbol, SymbolType } from "./types";
import { createLogger } from "@/core/logging/logger";
import { TEXT_SEARCH_TIMEOUT_MS } from "./constants";
import {
  buildRemoteTextSearchCommand,
  buildRemoteReferencesCommand,
  buildRemoteDefinitionGrepCommand,
  parseCtagsJsonOutput,
  buildRemoteCtagsListCommand,
  parseRemoteGrepOutput,
} from "./remoteCommandBuilder";
export {
  buildRemoteTextSearchCommand,
  buildRemoteReferencesCommand,
  buildRemoteDefinitionGrepCommand,
  parseCtagsJsonOutput,
  buildRemoteCtagsListCommand,
  parseRemoteGrepOutput,
  type RemoteGrepHit,
} from "./remoteCommandBuilder";

const log = createLogger("ace:remote");

/** 远程工具检测缓存 TTL */
export const REMOTE_CACHE_TTL_MS = 60 * 1000;

/** 远程排除目录 */
export const REMOTE_EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "target",
  ".next",
  ".nuxt",
  "coverage",
  "out",
  ".cache",
  "vendor",
];

/** 远程源代码扩展名 */
export const REMOTE_SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "cs",
  "rb",
  "php",
  "cpp",
  "cc",
  "cxx",
  "c",
  "h",
  "hpp",
];

/** 远程可用工具集 */
export interface RemoteToolset {
  hasGrep: boolean;
  hasRg: boolean;
  hasGit: boolean;
  hasCtags: boolean;
  isGitRepo: boolean;
}

interface RemoteExecClient {
  exec(
    command: string,
    options?: { timeout?: number; signal?: AbortSignal; dangerousAllow?: boolean },
  ): Promise<{ stdout: string }>;
}

/**
 * 自定义错误:远程工具不可用。
 */
/** RemoteToolUnavailableError */
export class RemoteToolUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteToolUnavailableError";
  }
}

// ─── 缓存 ──────────────────────────────────────────────────────

interface CacheBucket {
  tools?: { value: RemoteToolset; expiresAt: number };
  ctags?: { value: string; expiresAt: number };
}

const cacheByRemote = new Map<string, CacheBucket>();

function getBucket(remoteKey: string): CacheBucket {
  let bucket = cacheByRemote.get(remoteKey);
  if (!bucket) {
    bucket = {};
    cacheByRemote.set(remoteKey, bucket);
  }
  return bucket;
}

/** 使远程缓存失效 */
export function invalidateRemoteCache(remoteKey?: string): void {
  if (remoteKey) {
    cacheByRemote.delete(remoteKey);
  } else {
    cacheByRemote.clear();
  }
}

// ─── Shell 参数转义 ────────────────────────────────────────────

/**
 * 安全地将字符串引用为单个 shell 参数。
 * 使用单引号包裹，内嵌单引号转为 `'\''`。
 */
/** escapeShellArg 的实现 */
export function escapeShellArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, String.raw`'\''`)}'`;
}

// ─── 工具检测 ──────────────────────────────────────────────────

/**
 * 检测远程主机上可用的命令行工具。
 * 结果按 remoteKey 缓存 REMOTE_CACHE_TTL_MS。
 */
export async function detectRemoteTools(
  client: RemoteExecClient,
  remoteRoot: string,
  remoteKey: string,
): Promise<RemoteToolset> {
  const bucket = getBucket(remoteKey);
  const now = Date.now();
  if (bucket.tools && bucket.tools.expiresAt > now) {
    return bucket.tools.value;
  }

  const rootArg = escapeShellArg(remoteRoot);
  const probe = [
    `command -v grep >/dev/null 2>&1 && echo GREP=1 || echo GREP=0`,
    `command -v rg >/dev/null 2>&1 && echo RG=1 || echo RG=0`,
    `command -v git >/dev/null 2>&1 && echo GIT=1 || echo GIT=0`,
    `(command -v ctags >/dev/null 2>&1 && ctags --version 2>/dev/null | grep -qi universal && echo CTAGS=1) || echo CTAGS=0`,
    `(cd ${rootArg} 2>/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1 && echo GITREPO=1) || echo GITREPO=0`,
  ].join("; ");

  let stdout = "";
  try {
    const res = await client.exec(probe, { dangerousAllow: true, timeout: 15_000 });
    stdout = res.stdout;
  } catch (error) {
    log.warn("detectRemoteTools: probe exec failed", {
      payload: { error: getCodebaseSearchErrorMessage(error) },
    });
  }

  const flag = (key: string) => new RegExp(`^${key}=1\\b`, "m").test(stdout);
  const toolset: RemoteToolset = {
    hasCtags: flag("CTAGS"),
    hasGit: flag("GIT"),
    hasGrep: flag("GREP"),
    hasRg: flag("RG"),
    isGitRepo: flag("GITREPO"),
  };

  bucket.tools = { expiresAt: now + REMOTE_CACHE_TTL_MS, value: toolset };
  return toolset;
}

// ─── 远程 ctags 运行 ────────────────────────────────────────────

/**
 * 运行远程 ctags 并返回 NDJSON stdout(带缓存)。
 */
export async function runRemoteCtags(
  client: RemoteExecClient,
  remoteRoot: string,
  remoteKey: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const bucket = getBucket(remoteKey);
  const now = Date.now();
  if (bucket.ctags && bucket.ctags.expiresAt > now) {
    return bucket.ctags.value;
  }

  const command = buildRemoteCtagsListCommand(remoteRoot);
  const res = await client.exec(command, {
    dangerousAllow: true,
    signal: abortSignal,
    timeout: TEXT_SEARCH_TIMEOUT_MS,
  });

  const stdout = res.stdout || "";
  bucket.ctags = { expiresAt: now + REMOTE_CACHE_TTL_MS, value: stdout };
  return stdout;
}

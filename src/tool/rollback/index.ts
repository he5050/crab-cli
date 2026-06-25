/**
 * Rollback 模块 — 文件变更回滚与跨会话分支点管理。
 *
 * 职责:
 *   - 记录每次文件修改前后的内容
 *   - 提供回滚入口与跨会话回滚
 *   - 管理压缩分支点的加载/回滚
 *
 * 模块功能:
 *   - recordFileMutation: 记录文件变更
 *   - rollbackEntry: 回滚单条记录
 *   - branchPoints: 压缩分支点
 *   - crossSession: 跨会话回滚
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInternalError } from "@/core/errors/appError";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:rollback");

/** 文件变更记录输入 */
export interface RecordFileMutationInput {
  projectDir: string;
  filePath: string;
  before: string;
  after: string;
  beforeExists?: boolean;
  afterExists?: boolean;
  sessionId?: string;
  reason?: string;
}

/** 文件回滚条目，记录变更前后的完整内容和元数据 */
export interface RollbackEntry {
  id: string;
  filePath: string;
  before: string;
  after: string;
  beforeHash: string;
  afterHash: string;
  beforeExists: boolean;
  afterExists: boolean;
  sessionId?: string;
  reason?: string;
  createdAt: string;
}

/** 回滚预览，包含当前文件状态和差异信息 */
export interface RollbackPreview {
  id: string;
  filePath: string;
  status: "clean" | "conflict" | "missing";
  beforeHash: string;
  afterHash: string;
  currentHash?: string;
  diff: string;
}

/** 回滚操作结果 */
export type RollbackApplyResult =
  | { ok: true; status: "applied"; filePath: string }
  | { ok: false; status: "missing" | "conflict" | "not_found"; filePath?: string };

/** 回滚操作选项，支持按行范围回滚 */
export interface RollbackApplyOptions {
  range?: {
    startLine: number;
    endLine: number;
  };
}

/** 非 Git 工作区时的备用快照提示 */
export const NO_GIT_FILE_SNAPSHOT_NOTICE =
  "当前项目不是 Git worktree，crab-cli 已启用备用文件快照保护。建议安装 Git 并在项目中执行 git init，以获得更完整可靠的文件级回滚能力。";

/**
 * 构建备用快照提示，非 Git 工作区时返回提示文本
 * @param projectDir - 项目目录路径
 * @returns 非 Git 工作区时返回提示文本，否则返回 undefined
 */
/** buildFallbackSnapshotNotice 的实现 */
export function buildFallbackSnapshotNotice(projectDir: string): string | undefined {
  return isInsideGitWorkTree(projectDir) ? undefined : NO_GIT_FILE_SNAPSHOT_NOTICE;
}

/**
 * 记录文件变更，保存回滚条目到磁盘。
 *
 * @param input - 文件变更输入参数
 * @returns 回滚条目
 */
/** recordFileMutation 的实现 */
export function recordFileMutation(input: RecordFileMutationInput): RollbackEntry {
  const projectDir = resolve(input.projectDir);
  const filePath = toProjectRelativePath(projectDir, input.filePath);
  const beforeExists = input.beforeExists ?? true;
  const afterExists = input.afterExists ?? true;
  const entry: RollbackEntry = {
    id: `rb_${randomUUID()}`,
    filePath,
    before: input.before,
    after: input.after,
    beforeHash: hashContent(input.before),
    afterHash: hashContent(input.after),
    beforeExists,
    afterExists,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    createdAt: new Date().toISOString(),
  };

  const dir = rollbackDir(projectDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(entryPath(projectDir, entry.id), JSON.stringify(entry, null, 2));
  return entry;
}

/**
 * 预览回滚条目的当前状态（clean/conflict/missing）
 * @param projectDir - 项目目录路径
 * @param id - 回滚条目 ID
 * @returns 回滚预览信息，条目不存在时返回 null
 */
/** previewRollbackEntry 的实现 */
export function previewRollbackEntry(projectDir: string, id: string): RollbackPreview | null {
  const entry = readEntry(projectDir, id);
  if (!entry) {
    return null;
  }

  const absolutePath = join(resolve(projectDir), entry.filePath);
  if (!existsSync(absolutePath)) {
    return {
      afterHash: entry.afterHash,
      beforeHash: entry.beforeHash,
      diff: buildSimpleDiff(entry.after, entry.before),
      filePath: entry.filePath,
      id: entry.id,
      status: entry.afterExists === false ? "clean" : "missing",
    };
  }

  const current = readFileSync(absolutePath, "utf8");
  const currentHash = hashContent(current);
  return {
    afterHash: entry.afterHash,
    beforeHash: entry.beforeHash,
    currentHash,
    diff: buildSimpleDiff(current, entry.before),
    filePath: entry.filePath,
    id: entry.id,
    status: currentHash === entry.afterHash ? "clean" : "conflict",
  };
}

/**
 * 应用回滚条目，将文件恢复到变更前的状态。
 * 支持全文件回滚和行范围回滚。
 */
/** applyRollbackEntry 的实现 */
export function applyRollbackEntry(
  projectDir: string,
  id: string,
  options: RollbackApplyOptions = {},
): RollbackApplyResult {
  const entry = readEntry(projectDir, id);
  if (!entry) {
    return { ok: false, status: "not_found" };
  }

  const absolutePath = join(resolve(projectDir), entry.filePath);
  const currentExists = existsSync(absolutePath);
  if (!currentExists) {
    if (entry.afterExists === false) {
      if (entry.beforeExists) {
        mkdirSync(dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, entry.before);
      }
      return { filePath: entry.filePath, ok: true, status: "applied" };
    }
    return { filePath: entry.filePath, ok: false, status: "missing" };
  }

  const current = readFileSync(absolutePath, "utf8");
  if (options.range) {
    const next = buildRangeRollbackContent(current, entry, options.range);
    if (next === null) {
      return { filePath: entry.filePath, ok: false, status: "conflict" };
    }
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, next);
    return { filePath: entry.filePath, ok: true, status: "applied" };
  }

  if (hashContent(current) !== entry.afterHash) {
    return { filePath: entry.filePath, ok: false, status: "conflict" };
  }

  if (entry.beforeExists === false) {
    unlinkSync(absolutePath);
  } else {
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, entry.before);
  }
  return { filePath: entry.filePath, ok: true, status: "applied" };
}

/**
 * 列出项目所有回滚条目，按创建时间倒序排列
 * @param projectDir - 项目目录路径
 * @returns 回滚条目数组
 */
/** listRollbackEntries 的实现 */
export function listRollbackEntries(projectDir: string): RollbackEntry[] {
  const dir = rollbackDir(resolve(projectDir));
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readEntryByPath(join(dir, file)))
    .filter((entry): entry is RollbackEntry => entry !== null)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 列出指定会话在某个时间点之后的回滚条目 */
export function listRollbackEntriesForSessionSince(
  projectDir: string,
  sessionId: string,
  sinceMs: number,
): RollbackEntry[] {
  return listRollbackEntries(projectDir)
    .filter((entry) => entry.sessionId === sessionId && Date.parse(entry.createdAt) >= sinceMs)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** 判断项目目录是否在 Git 工作区内 */
export function isInsideGitWorkTree(projectDir: string): boolean {
  try {
    const output = execFileSync("git", ["-C", resolve(projectDir), "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output === "true";
  } catch (error) {
    log.debug(`rollback: git worktree 检测失败: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function readEntry(projectDir: string, id: string): RollbackEntry | null {
  return readEntryByPath(entryPath(resolve(projectDir), id));
}

function readEntryByPath(path: string): RollbackEntry | null {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as RollbackEntry;
}

function entryPath(projectDir: string, id: string): string {
  return join(rollbackDir(projectDir), `${id}.json`);
}

/**
 * 清理过期的 rollback 条目。
 *
 * 策略:
 *   1. 删除 createdAt 超过 maxAgeMs 的条目（TTL 清理）
 *   2. 当剩余条目仍超过 maxCount 时，按时间倒序保留最新的 maxCount 条
 *
 * @returns 被清理的条目数
 */
/** cleanupStaleRollbackEntries 的实现 */
export function cleanupStaleRollbackEntries(
  projectDir: string,
  options: { maxAgeMs?: number; maxCount?: number } = {},
): number {
  const { maxAgeMs = 7 * 24 * 60 * 60 * 1000, maxCount = 500 } = options;
  const dir = rollbackDir(resolve(projectDir));
  if (!existsSync(dir)) {
    return 0;
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    return 0;
  }

  const now = Date.now();
  let removed = 0;

  // Phase 1: TTL 清理
  for (const file of files) {
    const path = join(dir, file);
    try {
      const entry = readEntryByPath(path);
      if (entry && now - Date.parse(entry.createdAt) > maxAgeMs) {
        unlinkSync(path);
        removed++;
      }
    } catch {
      log.debug(`rollback: 清理损坏条目: ${path}`);
      unlinkSync(path);
      removed++;
    }
  }

  // Phase 2: 数量上限清理（重新扫描）
  if (maxCount > 0) {
    const remaining = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return { file: f, entry: readEntryByPath(join(dir, f)) };
        } catch (error) {
          log.debug(`rollback: 读取条目失败: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      })
      .filter((item): item is { file: string; entry: RollbackEntry } => item !== null)
      .toSorted((a, b) => b.entry.createdAt.localeCompare(a.entry.createdAt));

    if (remaining.length > maxCount) {
      for (let i = maxCount; i < remaining.length; i++) {
        unlinkSync(join(dir, remaining[i]!.file));
        removed++;
      }
    }
  }

  return removed;
}

function rollbackDir(projectDir: string): string {
  return join(projectDir, ".crab", "rollback");
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function buildRangeRollbackContent(
  current: string,
  entry: RollbackEntry,
  range: { startLine: number; endLine: number },
): string | null {
  if (range.startLine < 1 || range.endLine < range.startLine) {
    return null;
  }
  const startIndex = range.startLine - 1;
  const endIndex = range.endLine;
  const currentLines = current.split("\n");
  const beforeLines = entry.before.split("\n");
  const afterLines = entry.after.split("\n");

  const currentRange = currentLines.slice(startIndex, endIndex).join("\n");
  const afterRange = afterLines.slice(startIndex, endIndex).join("\n");
  if (currentRange !== afterRange) {
    return null;
  }

  currentLines.splice(startIndex, endIndex - startIndex, ...beforeLines.slice(startIndex, endIndex));
  return currentLines.join("\n");
}

function toProjectRelativePath(projectDir: string, filePath: string): string {
  const absolutePath = resolve(filePath);
  const rel = relative(projectDir, absolutePath);
  if (rel.startsWith("..") || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw createInternalError("INTERNAL_ERROR", `File is outside project: ${filePath}`);
  }
  return rel.split(sep).join("/");
}

function buildSimpleDiff(from: string, to: string): string {
  const fromLines = from.split("\n");
  const toLines = to.split("\n");
  const lines = ["--- current", "+++ rollback"];
  const max = Math.max(fromLines.length, toLines.length);
  for (let i = 0; i < max; i++) {
    const before = fromLines[i];
    const after = toLines[i];
    if (before === after) {
      if (before !== undefined && before !== "") {
        lines.push(` ${before}`);
      }
      continue;
    }
    if (before !== undefined && before !== "") {
      lines.push(`-${before}`);
    }
    if (after !== undefined && after !== "") {
      lines.push(`+${after}`);
    }
  }
  return lines.join("\n");
}

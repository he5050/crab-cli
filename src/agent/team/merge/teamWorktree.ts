/**
 * [Team Worktree 管理]
 *
 * 职责:
 *   - 为每个队友创建独立 Git worktree
 *   - 管理 worktree 路径重写
 *   - 自动提交 worktree 变更
 *   - 处理分支合并和冲突解决
 *
 * 模块功能:
 *   - createWorktree:创建 Git worktree
 *   - removeWorktree:移除 worktree
 *   - cleanupTeamWorktrees:清理团队所有 worktree
 *   - enforceWorktreePath:强制执行 worktree 路径
 *   - rewriteToolArgsForWorktree:重写工具参数路径
 *   - autoCommitWorktreeChanges:自动提交变更
 *   - mergeTeammateBranch:合并队友分支
 *   - getConflictedFiles:获取冲突文件列表
 *   - isInMergeState:检查是否在合并状态
 *   - completeMerge:完成合并
 *   - abortMerge:中止合并
 *   - getTeammateDiffSummary:获取 diff 摘要
 *   - isGitRepo:检查是否在 Git 仓库中
 *
 * 使用场景:
 *   - 多队友并行开发
 *   - 隔离代码变更
 *   - 分支管理和合并
 *   - 冲突检测和解决
 *
 * 边界:
 *   1. 需要 Git 仓库环境
 *   2. worktree 路径不能重叠
 *   3. 合并冲突需要手动解决
 *   4. 路径重写仅支持特定工具
 *
 * 流程:
 *   1. 创建 worktree(基于队友 ID)
 *   2. 队友在 worktree 内执行操作
 *   3. 路径重写确保文件操作隔离
 *   4. 自动提交变更到分支
 *   5. 合并分支到主分支
 *   6. 处理冲突(如存在)
 *   7. 清理 worktree
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createLogger } from "@/core/logging/logger";
import { createInternalError } from "@/core/errors/appError";

const log = createLogger("team:worktree");

// ─── Worktree 创建/清理 ──────────────────────────────────────

function formatTeammateWorktreeSuffix(mateId: string): string {
  return mateId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40);
}

function decodeSpawnOutput(output: Uint8Array | undefined): string {
  if (!output || output.length === 0) {
    return "";
  }
  return new TextDecoder().decode(output).trim();
}

function formatWorktreeFailure(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  return String(reason);
}

/** 创建 Git worktree */
export async function createWorktree(mateId: string, basePath: string, projectDir: string): Promise<string> {
  const worktreeSuffix = formatTeammateWorktreeSuffix(mateId);
  const worktreeDir = resolve(projectDir, basePath, `mate-${worktreeSuffix}`);

  const base = resolve(projectDir, basePath);
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
  }

  try {
    const branchName = `team/${worktreeSuffix}`;
    const proc = Bun.spawnSync(["git", "worktree", "add", worktreeDir, "-b", branchName], {
      cwd: projectDir,
      stderr: "pipe",
      stdout: "pipe",
    });

    if (proc.exitCode !== 0) {
      const retryProc = Bun.spawnSync(["git", "worktree", "add", worktreeDir, branchName], {
        cwd: projectDir,
        stderr: "pipe",
        stdout: "pipe",
      });

      if (retryProc.exitCode !== 0) {
        const primaryError = decodeSpawnOutput(proc.stderr) || decodeSpawnOutput(proc.stdout);
        const retryError = decodeSpawnOutput(retryProc.stderr) || decodeSpawnOutput(retryProc.stdout);
        const detail = [primaryError, retryError].filter(Boolean).join(" | ");
        throw createInternalError("INTERNAL_ERROR", detail || `git worktree add exited with ${retryProc.exitCode}`);
      }
    }

    log.info(`Worktree 已创建: ${worktreeDir}`);
    return worktreeDir;
  } catch (error) {
    const detail = formatWorktreeFailure(error);
    log.warn(`Git worktree 创建失败: ${detail}`);
    throw createInternalError("INTERNAL_ERROR", `Git worktree 创建失败，未创建普通目录降级: ${detail}`);
  }
}

/** 清理 Git worktree */
export async function removeWorktree(worktreePath: string, projectDir: string): Promise<boolean> {
  if (!existsSync(worktreePath)) {
    return true;
  }

  try {
    const proc = Bun.spawnSync(["git", "worktree", "remove", worktreePath, "--force"], {
      cwd: projectDir,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (proc.exitCode !== 0) {
      rmSync(worktreePath, { force: true, recursive: true });
    }
    log.info(`Worktree 已清理: ${worktreePath}`);
    return true;
  } catch {
    try {
      rmSync(worktreePath, { force: true, recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

/** 清理团队所有 worktree */
export async function cleanupTeamWorktrees(projectDir: string, basePath: string): Promise<number> {
  const worktreeBase = resolve(projectDir, basePath);
  if (!existsSync(worktreeBase)) {
    return 0;
  }

  let count = 0;
  try {
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(worktreeBase, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("mate-")) {
        const wtPath = join(worktreeBase, entry.name);
        await removeWorktree(wtPath, projectDir);
        count++;
      }
    }
  } catch {
    /* Best effort */
  }
  return count;
}

// ─── 路径强制执行 ────────────────────────────────────────────

/**
 * 确保文件路径解析到队友的 worktree 内。
 *
 * enforceWorktreePath:
 *   - 相对路径 → 相对于 worktree 解析
 *   - 绝对路径在主工作区内 → 重映射到 worktree 等效路径
 *   - 绝对路径在 worktree 内 → 直接通过
 *   - SSH URL → 直接通过
 *   - 在两个工作区外 → 返回 null(被阻止)
 */
export function enforceWorktreePath(filePath: string, worktreePath: string): string | null {
  if (!filePath || filePath.trim() === "") {
    return null;
  }
  // SSH URL 直接通过
  if (filePath.startsWith("ssh://")) {
    return filePath;
  }

  const resolvedWorktree = resolve(worktreePath);

  if (isAbsolute(filePath)) {
    const resolved = resolve(filePath);

    // 在 worktree 内 → 通过
    if (resolved === resolvedWorktree || resolved.startsWith(`${resolvedWorktree}/`)) {
      return resolved;
    }

    // 在主工作区内 → 重映射到 worktree 等效路径
    const mainRoot = resolve(process.cwd());
    if (resolved === mainRoot || resolved.startsWith(`${mainRoot}/`)) {
      const rel = relative(mainRoot, resolved);
      return resolve(resolvedWorktree, rel);
    }

    // 在两个工作区外 → 拒绝
    return null;
  }

  // 相对路径 → 相对于 worktree 解析
  return resolve(resolvedWorktree, filePath);
}

// ─── 路径重写 ────────────────────────────────────────────────

/**
 * 将工具参数中的文件路径重映射到队友的 worktree。
 *
 *  rewriteToolArgsForWorktree:
 *   - 覆盖 filesystem-*(filePath / path 字段)、terminal-execute(cwd)
 *   - 覆盖搜索工具(glob、grep、search 等)
 *   - 在 terminal 中阻止 git push
 *   - 支持数组类型的 filePath
 */
export function rewriteToolArgsForWorktree(
  toolName: string,
  args: Record<string, unknown>,
  worktreePath: string,
): { args: Record<string, unknown>; error?: string } {
  const rw = (p: string) => enforceWorktreePath(p, worktreePath);
  let newArgs = { ...args };

  // ── filesystem-* 工具 ──
  if (toolName.startsWith("filesystem-")) {
    const isWrite =
      toolName === "filesystem-write" || toolName === "filesystem-edit" || toolName === "filesystem-create";

    // 兼容 filePath 和 path 两种字段名
    const field =
      typeof newArgs.filePath === "string" || Array.isArray(newArgs.filePath)
        ? "filePath"
        : typeof newArgs.path === "string" || Array.isArray(newArgs.path)
          ? "path"
          : null;

    if (field) {
      const value = newArgs[field];
      if (typeof value === "string") {
        const newPath = rw(value);
        if (newPath === null) {
          return {
            args: newArgs,
            error:
              `[Worktree 强制执行] 路径 "${value}" 在你的 worktree 之外。` +
              `你只能在以下目录内${isWrite ? "修改" : "访问"}文件: ${worktreePath}。` +
              `使用相对路径如 "src/foo.ts" — 会自动解析到你的 worktree。`,
          };
        }
        newArgs = { ...newArgs, [field]: newPath };
      } else if (Array.isArray(value)) {
        const mapped: unknown[] = [];
        for (const item of value) {
          if (typeof item === "string") {
            const np = rw(item);
            if (np === null) {
              return {
                args: newArgs,
                error: `[Worktree 强制执行] 路径 "${item}" 在你的 worktree 之外 (${worktreePath})。`,
              };
            }
            mapped.push(np);
          } else if (typeof item === "object" && item !== null && "path" in item) {
            const np = rw((item as { path: string }).path);
            if (np === null) {
              return {
                args: newArgs,
                error: `[Worktree 强制执行] 路径 "${(item as { path: string }).path}" 在你的 worktree 之外 (${worktreePath})。`,
              };
            }
            mapped.push({ ...item, path: np });
          } else {
            mapped.push(item);
          }
        }
        newArgs = { ...newArgs, [field]: mapped };
      }
    }
  }

  // ── terminal-execute:强制工作目录到 worktree + 阻止 git push ──
  if (toolName === "terminal-execute" || toolName === "terminal") {
    const cwd = newArgs.cwd as string | undefined;
    const workingDirectory = newArgs.workingDirectory as string | undefined;
    const dir = workingDirectory ?? cwd;

    if (!dir || (!dir.startsWith("ssh://") && !dir.startsWith("SSH://"))) {
      const newDir = dir ? rw(dir) : null;
      newArgs = {
        ...newArgs,
        workingDirectory: newDir || worktreePath,
        ...(cwd !== undefined ? { cwd: newDir || worktreePath } : {}),
      };
    }

    // 阻止队友执行 git push
    const cmd = String(newArgs.command ?? newArgs.cmd ?? "").trim();
    if (/\bgit\s+push\b/i.test(cmd)) {
      return {
        args: newArgs,
        error: "[Worktree 强制执行] 队友不允许执行 `git push`。" + "所有 push 由 team lead 在合并后处理。",
      };
    }
  }

  // ── 搜索工具:重写 path/directory 字段 ──
  if (toolName === "glob" || toolName === "grep") {
    if (typeof newArgs.path === "string") {
      const np = rw(newArgs.path);
      if (np) {
        newArgs = { ...newArgs, path: np };
      }
    }
  }
  if (toolName === "codebase-search" && typeof newArgs.directory === "string") {
    const np = rw(newArgs.directory);
    if (np) {
      newArgs = { ...newArgs, directory: np };
    }
  }
  if (toolName === "ace-search") {
    if (typeof newArgs.filePath === "string") {
      const np = rw(newArgs.filePath);
      if (np) {
        newArgs = { ...newArgs, filePath: np };
      }
    }
    if (typeof newArgs.directory === "string") {
      const np = rw(newArgs.directory);
      if (np) {
        newArgs = { ...newArgs, directory: np };
      }
    }
  }

  return { args: newArgs };
}

// ─── 自动提交 ────────────────────────────────────────────────

/** 检查目录自身是否为 Git worktree 根，防止普通子目录向上污染主仓库。 */
export function isGitWorktreeRoot(dir: string): boolean {
  if (!existsSync(dir)) {
    return false;
  }
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (proc.exitCode !== 0) {
      return false;
    }
    const topLevel = new TextDecoder().decode(proc.stdout).trim();
    return resolve(topLevel) === resolve(dir);
  } catch {
    return false;
  }
}

/** 自动提交 worktree 中的变更 */
export function autoCommitWorktreeChanges(worktreePath: string, mateName: string): boolean {
  if (!existsSync(worktreePath)) {
    return false;
  }
  if (!isGitWorktreeRoot(worktreePath)) {
    log.warn(`跳过 Worktree 自动提交: ${worktreePath} 不是独立 Git worktree 根目录`);
    return false;
  }

  try {
    // Git add -A
    const addProc = Bun.spawnSync(["git", "add", "-A"], {
      cwd: worktreePath,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (addProc.exitCode !== 0) {
      return false;
    }

    // Git commit(允许空提交)
    const commitProc = Bun.spawnSync(["git", "commit", "-m", `[team] ${mateName} auto-commit`, "--allow-empty"], {
      cwd: worktreePath,
      stderr: "pipe",
      stdout: "pipe",
    });

    const ok = commitProc.exitCode === 0;
    if (ok) {
      log.info(`Worktree 自动提交: ${worktreePath}`);
    }
    return ok;
  } catch (error) {
    log.warn(`Worktree 自动提交失败: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// ─── 分支合并 ────────────────────────────────────────────────

export type MergeStrategy = "manual" | "theirs" | "ours" | "auto" | "ours-prefer";

/** 单个冲突文件的 LLM 决策 */
export interface LlmConflictDecision {
  file: string;
  side: "ours" | "theirs";
  reasoning?: string;
}

/** LLM 冲突 resolver 注入点(默认 = 全选 ours) */
export type LlmConflictResolver = (conflictedFiles: string[], projectDir: string) => Promise<LlmConflictDecision[]>;

/** 默认 resolver:无 LLM 时全选 ours(等价于纯 ours 策略) */
export const defaultLlmConflictResolver: LlmConflictResolver = async () => [];

/** 合并队友分支到主分支 */
export async function mergeTeammateBranch(
  worktreePath: string,
  projectDir: string,
  strategy: MergeStrategy = "manual",
  llmResolver: LlmConflictResolver = defaultLlmConflictResolver,
): Promise<{ success: boolean; conflicts?: string[]; error?: string }> {
  if (!existsSync(worktreePath)) {
    return { error: "Worktree 不存在", success: false };
  }

  try {
    // 获取分支名
    const branchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: worktreePath,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (branchProc.exitCode !== 0) {
      return { error: "无法获取分支名", success: false };
    }
    const branchName = new TextDecoder().decode(branchProc.stdout).trim();

    // 先自动提交
    autoCommitWorktreeChanges(worktreePath, "merge-prep");

    // 在主项目目录执行 merge
    if (strategy === "theirs") {
      const proc = Bun.spawnSync(["git", "merge", branchName, "-X", "theirs", "--no-edit"], {
        cwd: projectDir,
        stderr: "pipe",
        stdout: "pipe",
      });
      if (proc.exitCode !== 0) {
        return { error: "合并失败(theirs 策略)", success: false };
      }
      return { success: true };
    }

    if (strategy === "ours") {
      const proc = Bun.spawnSync(["git", "merge", branchName, "-X", "ours", "--no-edit"], {
        cwd: projectDir,
        stderr: "pipe",
        stdout: "pipe",
      });
      if (proc.exitCode !== 0) {
        return { error: "合并失败(ours 策略)", success: false };
      }
      return { success: true };
    }

    if (strategy === "ours-prefer") {
      // 1) 优先尝试 ours 策略
      const proc = Bun.spawnSync(["git", "merge", branchName, "-X", "ours", "--no-edit"], {
        cwd: projectDir,
        stderr: "pipe",
        stdout: "pipe",
      });
      if (proc.exitCode === 0) {
        return { success: true };
      }

      // 2) 失败:扫描冲突
      const conflicts = getConflictedFiles(projectDir);
      if (conflicts.length === 0) {
        const stderr = new TextDecoder().decode(proc.stderr);
        return { error: stderr || "合并失败(ours-prefer 策略)", success: false };
      }

      // 3) 调 resolver 获取每文件 side 决策
      let decisions: LlmConflictDecision[];
      try {
        decisions = await llmResolver(conflicts, projectDir);
      } catch (error) {
        log.warn("LLM 冲突 resolver 抛错", {
          error: error instanceof Error ? error.message : String(error),
        });
        return { conflicts, success: false };
      }

      // 4) 应用决策:每个文件 checkout --ours|--theours + git add
      for (const decision of decisions) {
        const checkoutFlag = decision.side === "ours" ? "--ours" : "--theirs";
        const checkoutProc = Bun.spawnSync(["git", "checkout", checkoutFlag, "--", decision.file], {
          cwd: projectDir,
          stderr: "pipe",
          stdout: "pipe",
        });
        if (checkoutProc.exitCode !== 0) {
          log.warn(`git checkout ${checkoutFlag} 失败: ${decision.file}`);
        }
        Bun.spawnSync(["git", "add", "--", decision.file], {
          cwd: projectDir,
          stderr: "pipe",
          stdout: "pipe",
        });
      }

      // 5) 提交
      const committed = await completeMerge(projectDir);
      if (!committed) {
        return { conflicts, success: false };
      }
      return { success: true };
    }

    // Manual 策略
    const proc = Bun.spawnSync(["git", "merge", branchName, "--no-edit"], {
      cwd: projectDir,
      stderr: "pipe",
      stdout: "pipe",
    });

    if (proc.exitCode !== 0) {
      // 检查是否有冲突
      const conflicts = getConflictedFiles(projectDir);
      if (conflicts.length > 0) {
        return { conflicts, success: false };
      }
      const stderr = new TextDecoder().decode(proc.stderr);
      return { error: stderr || "合并失败", success: false };
    }

    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), success: false };
  }
}

/** 获取冲突文件列表 */
export function getConflictedFiles(projectDir: string): string[] {
  try {
    const proc = Bun.spawnSync(["git", "diff", "--name-only", "--diff-filter=U"], {
      cwd: projectDir,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (proc.exitCode !== 0) {
      return [];
    }
    const output = new TextDecoder().decode(proc.stdout).trim();
    return output ? output.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** 检查是否在 merge 状态 */
export function isInMergeState(projectDir: string): boolean {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"], {
      cwd: projectDir,
      stderr: "pipe",
      stdout: "pipe",
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/** 完成合并(解决冲突后) */
export async function completeMerge(projectDir: string): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(["git", "commit", "--no-edit"], { cwd: projectDir, stderr: "pipe", stdout: "pipe" });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/** 中止合并 */
export async function abortMerge(projectDir: string): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(["git", "merge", "--abort"], { cwd: projectDir, stderr: "pipe", stdout: "pipe" });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/** 获取队友 worktree 的 diff 摘要 */
export function getTeammateDiffSummary(worktreePath: string, projectDir: string): string {
  try {
    const proc = Bun.spawnSync(["git", "diff", "--stat", "HEAD"], {
      cwd: worktreePath,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (proc.exitCode !== 0) {
      return "无变更";
    }
    return new TextDecoder().decode(proc.stdout).trim() || "无变更";
  } catch {
    return "无法获取 diff";
  }
}

/** 检查是否在 Git 仓库中 */
export function isGitRepo(dir: string): boolean {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

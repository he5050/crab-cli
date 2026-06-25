/**
 * TODO 工具 — 文件锁机制。
 *
 * 提供基于 mkdir 的文件锁实现，支持 stale lock 自动清理。
 */

import fs from "node:fs";
import path from "node:path";
import { ToolError } from "@/core/errors/appError";
import { createLogger } from "@/core/logging/logger";
import type { TodoStore } from "./todoTypes";

const log = createLogger("tool:todo:lock");

// ── 锁参数 ──────────────────────────────────────────────────────

/** 锁重试间隔（毫秒） */
const TODO_LOCK_RETRY_DELAY_MS = 20;

/** 锁最大重试次数 */
const TODO_LOCK_MAX_RETRIES = 500;

/** 过期锁阈值（毫秒）——超过此时间的锁视为 stale */
const TODO_LOCK_STALE_MS = 60_000;

// ── 文件路径辅助 ──────────────────────────────────────────────────

/** 获取 TODO 存储文件路径 */
export function getTodoFilePath(projectDir: string): string {
  return path.join(projectDir, ".crab", "todos.json");
}

/** 获取 TODO 锁文件路径 */
function getTodoLockPath(projectDir: string): string {
  return `${getTodoFilePath(projectDir)}.lock`;
}

/** 获取 TODO 临时写入路径 */
export function getTodoTmpPath(projectDir: string): string {
  return `${getTodoFilePath(projectDir)}.${process.pid}.${Date.now()}.tmp`;
}

// ── 异步等待 ────────────────────────────────────────────────────

async function waitAsync(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ── 锁获取与释放 ────────────────────────────────────────────────

/**
 * 在文件锁保护下执行 fn。
 * 使用 mkdir 原子操作实现互斥，自动检测并清理过期锁。
 */
export async function withTodoStoreLock<T>(projectDir: string, fn: () => T): Promise<T> {
  const lockPath = getTodoLockPath(projectDir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  let acquired = false;
  for (let attempt = 0; attempt < TODO_LOCK_MAX_RETRIES; attempt += 1) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
      break;
    } catch (error: unknown) {
      if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      // 检测 stale lock 并清理
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > TODO_LOCK_STALE_MS) {
          fs.rmSync(lockPath, { force: true, recursive: true });
          continue;
        }
      } catch (error: unknown) {
        log.debug(`TODO 锁文件 stat 检查失败: ${lockPath}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await waitAsync(TODO_LOCK_RETRY_DELAY_MS);
    }
  }

  if (!acquired) {
    throw new ToolError("TOOL-601", `无法获取 TODO 文件锁: ${lockPath}`, {
      context: { lockPath },
    });
  }

  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { force: true, recursive: true });
  }
}

/** Todo 存储类型（re-export，实际逻辑在 index.ts） */
export type { TodoStore };

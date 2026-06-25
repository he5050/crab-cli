/**
 * Token 用量日志 — 每日 JSONL 轮转写入
 *
 *
 * 文件格式: ~/.crab/usage/YYYY-MM-DD/usage-NNN.jsonl
 * 轮转策略: 单文件上限 5MB，自动创建新文件
 * 并发安全: 写入队列串行化，避免文件冲突
 */

import { appendFile, mkdir, stat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────

export interface UsageLogEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  timestamp: string;
}

// ─── 常量 ──────────────────────────────────────────────────

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// ─── 写入队列 ──────────────────────────────────────────────

let writeQueue: Promise<void> = Promise.resolve();

// ─── 内部函数 ──────────────────────────────────────────────

async function ensureUsageDir(): Promise<string> {
  const baseDir = join(homedir(), ".crab", "usage");
  const today = new Date().toISOString().split("T")[0] || "unknown";
  const dateDir = join(baseDir, today);
  await mkdir(dateDir, { recursive: true });
  return dateDir;
}

async function getCurrentLogFile(dateDir: string): Promise<string> {
  try {
    const files = (await readdir(dateDir)).filter((f) => f.startsWith("usage-") && f.endsWith(".jsonl"));

    if (files.length === 0) {
      return join(dateDir, "usage-001.jsonl");
    }

    files.sort();
    const latestName = files[files.length - 1];
    if (!latestName) return join(dateDir, "usage-001.jsonl");

    const latestPath = join(dateDir, latestName);
    const fileStat = await stat(latestPath);

    if (fileStat.size >= MAX_FILE_SIZE) {
      const match = latestName.match(/usage-(\d+)\.jsonl/);
      const nextNum = match?.[1] ? Number.parseInt(match[1], 10) + 1 : 1;
      return join(dateDir, `usage-${String(nextNum).padStart(3, "0")}.jsonl`);
    }

    return latestPath;
  } catch {
    return join(dateDir, "usage-001.jsonl");
  }
}

// ─── 公开 API ──────────────────────────────────────────────

/**
 * 记录一次 API 调用的 token 用量到日志文件。
 * 内部使用写入队列确保并发安全。
 */
export function saveUsageToFile(
  model: string,
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cached_tokens?: number;
  },
): void {
  writeQueue = writeQueue
    .then(async () => {
      try {
        const dateDir = await ensureUsageDir();
        const logFile = await getCurrentLogFile(dateDir);

        const cacheReadTokens = usage.cache_read_input_tokens ?? usage.cached_tokens;

        const record: UsageLogEntry = {
          model,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          ...(usage.cache_creation_input_tokens !== undefined && {
            cacheCreationInputTokens: usage.cache_creation_input_tokens,
          }),
          ...(cacheReadTokens !== undefined && {
            cacheReadInputTokens: cacheReadTokens,
          }),
          timestamp: new Date().toISOString(),
        };

        const line = `${JSON.stringify(record)}\n`;
        await appendFile(logFile, line, "utf-8");
      } catch {
        // 静默失败 — 用量日志不影响主流程
      }
    })
    .catch(() => {
      // 队列错误不传播
    });
}

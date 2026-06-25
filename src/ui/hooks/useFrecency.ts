/**
 * UseFrecency — 频率+最近使用排序 Hook
 *
 * 职责:
 *   - 跟踪条目访问频率和最近时间
 *   - 计算 frecency 分数(frequency × time_decay)
 *   - 提供按 frecency 分数排序的接口
 *   - JSONL 持久化存储
 *
 * 模块功能:
 *   - touch — 更新条目访问记录(频率+1，更新最近时间)
 *   - score — 获取条目的 frecency 分数
 *   - sortByFrecency — 按 frecency 分数排序 key 列表
 *   - data — 获取所有 frecency 数据
 *   - 自动持久化到 ~/.crab/frecency.jsonl
 *   - 自动限制最多 1000 条记录
 *
 * 使用场景:
 *   - 命令历史排序(常用命令排在前面)
 *   - 模型选择列表排序
 *   - 文件/项目快速打开排序
 *   - 任何需要"智能排序"的列表场景
 *
 * 边界:
 *   1. 最多存储 1000 条记录，超出时按最近访问时间裁剪
 *   2. 使用 JSONL 格式追加写入，启动时执行 self-heal 去重
 *   3. 分数计算基于天数衰减(1 / (1 + days_since))
 *   4. 存储路径固定为 ~/.crab/frecency.jsonl
 *   5. 非响应式 Hook，返回的是普通函数而非 Signal
 *
 * 流程:
 *   1. onMount 时从 JSONL 文件加载历史数据
 *   2. 去重并保留每个 key 的最新记录
 *   3. 限制数量后写入内存状态
 *   4. 调用 touch 时更新内存状态并追加写入文件
 *   5. 超限时按最近访问时间排序裁剪
 */
import { createSignal, onMount } from "solid-js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logUiDebugFailure, logUiWarnFailure } from "@/ui/utils/errorLogging";

// ─── 类型 ──────────────────────────────────────────────────────

interface FrecencyEntry {
  key: string;
  frequency: number;
  lastAccess: number;
}

const MAX_ENTRIES = 1000;
const LOG_SERVICE = "ui:frecency";

// ─── 存储 ──────────────────────────────────────────────────────

function frecencyFilePath(): string {
  const dir = path.join(os.homedir(), ".crab");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    logUiDebugFailure(LOG_SERVICE, "创建 frecency 存储目录失败", error, {
      dir,
      operation: "ui.frecency.ensureStorageDir",
    });
  }
  return path.join(dir, "frecency.jsonl");
}

// ─── 计算 ──────────────────────────────────────────────────────

/** 计算 frecency 分数:frequency × (1 / (1 + days_since)) */
function calculateFrecency(entry?: { frequency: number; lastAccess: number }): number {
  if (!entry) {
    return 0;
  }
  const daysSince = (Date.now() - entry.lastAccess) / 86_400_000;
  const weight = 1 / (1 + daysSince);
  return entry.frequency * weight;
}

// ─── useFrecency hook ──────────────────────────────────────────

export function useFrecency() {
  const [entries, setEntries] = createSignal<Record<string, { frequency: number; lastAccess: number }>>({});

  onMount(() => {
    const filePath = frecencyFilePath();
    try {
      const text = fs.readFileSync(filePath, "utf8");
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as FrecencyEntry;
          } catch (error) {
            logUiDebugFailure(LOG_SERVICE, "跳过无效 frecency 记录", error, {
              operation: "ui.frecency.parseRecord",
            });
            return null;
          }
        })
        .filter((entry): entry is FrecencyEntry => entry !== null);

      // 取每个 key 的最新记录
      const latest: Record<string, { frequency: number; lastAccess: number }> = {};
      for (const entry of lines) {
        latest[entry.key] = { frequency: entry.frequency, lastAccess: entry.lastAccess };
      }

      // 限制数量(按最近访问时间排序，保留前 1000 条)
      const sorted = Object.entries(latest)
        .toSorted(([, a], [, b]) => b.lastAccess - a.lastAccess)
        .slice(0, MAX_ENTRIES);

      setEntries(Object.fromEntries(sorted));

      // Self-heal
      if (sorted.length > 0) {
        const content = `${sorted.map(([key, data]) => JSON.stringify({ key, ...data })).join("\n")}\n`;
        try {
          fs.writeFileSync(filePath, content, "utf8");
        } catch (error) {
          logUiWarnFailure(LOG_SERVICE, "重写 frecency 存储失败", error, {
            filePath,
            operation: "ui.frecency.selfHeal",
          });
        }
      }
    } catch (error) {
      logUiDebugFailure(LOG_SERVICE, "读取 frecency 存储失败", error, {
        filePath,
        operation: "ui.frecency.load",
      });
    }
  });

  /** 更新条目(访问时调用) */
  function touch(key: string): void {
    const current = entries()[key];
    const newEntry = {
      frequency: (current?.frequency ?? 0) + 1,
      lastAccess: Date.now(),
    };

    const next = { ...entries(), [key]: newEntry };
    // 超限时裁剪
    if (Object.keys(next).length > MAX_ENTRIES) {
      const sorted = Object.entries(next)
        .toSorted(([, a], [, b]) => b.lastAccess - a.lastAccess)
        .slice(0, MAX_ENTRIES);
      setEntries(Object.fromEntries(sorted));
    } else {
      setEntries(next);
    }

    // 持久化
    try {
      fs.appendFileSync(frecencyFilePath(), `${JSON.stringify({ key, ...newEntry })}\n`, "utf8");
    } catch (error) {
      logUiWarnFailure(LOG_SERVICE, "写入 frecency 存储失败", error, {
        key,
        operation: "ui.frecency.touch",
      });
    }
  }

  /** 获取条目的 frecency 分数 */
  function score(key: string): number {
    return calculateFrecency(entries()[key]);
  }

  /** 按 frecency 分数排序 key 列表(高分在前) */
  function sortByFrecency(keys: string[]): string[] {
    return [...keys].toSorted((a, b) => score(b) - score(a));
  }

  /** 获取所有数据 */
  function data(): Record<string, { frequency: number; lastAccess: number }> {
    return entries();
  }

  return { data, score, sortByFrecency, touch };
}

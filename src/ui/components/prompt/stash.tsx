/**
 * [Prompt Stash]
 *
 * 职责:
 *   - 暂存用户输入(如编辑前保存草稿)
 *   - JSONL 格式持久化存储到本地文件
 *   - 管理最多 50 条暂存记录
 *   - 提供 push/pop/remove/list 操作
 *
 * 模块功能:
 *   - usePromptStash Hook:管理暂存状态
 *   - 暂存文件读写操作(~/.crab/prompt-stash.jsonl)
 *   - 超出容量时自动裁剪并重写文件
 *   - 损坏文件自修复机制
 *
 * 使用场景:
 *   - 用户需要临时保存当前输入，稍后恢复
 *   - 编辑长文本时保存中间草稿
 *   - 切换会话时保留未发送的消息
 *   - 需要查看和管理暂存列表
 *
 * 边界:
 *   1. 最大存储 50 条暂存记录，超出时淘汰最旧记录
 *   2. 空输入或纯空白字符不会被暂存
 *   3. pop() 操作会移除并返回最后一条记录
 *   4. 文件损坏时会尝试自修复重写
 *
 * 流程:
 *   1. 组件挂载时从 ~/.crab/prompt-stash.jsonl 加载暂存列表
 *   2. push() 添加新暂存，超出容量时裁剪并重写文件
 *   3. pop() 移除并返回最后一条暂存，重写文件
 *   4. remove() 删除指定索引项，重写文件
 */
import { createSignal, onMount } from "solid-js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logUiDebugFailure, logUiWarnFailure } from "@/ui/utils/errorLogging";

// ─── 类型 ──────────────────────────────────────────────────────

export interface StashEntry {
  input: string;
  timestamp: number;
}

const MAX_STASH_ENTRIES = 50;
const LOG_SERVICE = "ui:prompt-stash";

// ─── Stash 文件路径 ────────────────────────────────────────────

function stashFilePath(): string {
  const dir = path.join(os.homedir(), ".crab");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    logUiDebugFailure(LOG_SERVICE, "创建 prompt stash 存储目录失败", error, {
      dir,
      operation: "ui.promptStash.ensureStorageDir",
    });
  }
  return path.join(dir, "prompt-stash.jsonl");
}

// ─── usePromptStash ────────────────────────────────────────────

export function usePromptStash() {
  const [entries, setEntries] = createSignal<StashEntry[]>([]);

  onMount(() => {
    const filePath = stashFilePath();
    try {
      const text = fs.readFileSync(filePath, "utf8");
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as StashEntry;
          } catch (error) {
            logUiDebugFailure(LOG_SERVICE, "跳过无效 prompt stash 记录", error, {
              operation: "ui.promptStash.parseRecord",
            });
            return null;
          }
        })
        .filter((entry): entry is StashEntry => entry !== null)
        .slice(-MAX_STASH_ENTRIES);

      setEntries(lines);

      // Self-heal: rewrite with valid entries
      if (lines.length > 0) {
        const content = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
        try {
          fs.writeFileSync(filePath, content, "utf8");
        } catch (error) {
          logUiWarnFailure(LOG_SERVICE, "重写 prompt stash 存储失败", error, {
            filePath,
            operation: "ui.promptStash.selfHeal",
          });
        }
      }
    } catch (error) {
      logUiDebugFailure(LOG_SERVICE, "读取 prompt stash 存储失败", error, {
        filePath,
        operation: "ui.promptStash.load",
      });
    }
  });

  /** 推入暂存 */
  function push(input: string) {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    const entry: StashEntry = { input: trimmed, timestamp: Date.now() };
    const next = [...entries(), entry].slice(-MAX_STASH_ENTRIES);
    const trimmed_flag = next.length < [...entries(), entry].length;
    setEntries(next);

    try {
      const filePath = stashFilePath();
      if (trimmed_flag) {
        const content = `${next.map((l) => JSON.stringify(l)).join("\n")}\n`;
        fs.writeFileSync(filePath, content, "utf8");
      } else {
        fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
      }
    } catch (error) {
      logUiWarnFailure(LOG_SERVICE, "写入 prompt stash 存储失败", error, {
        operation: "ui.promptStash.push",
      });
    }
  }

  /** 弹出最后一条 */
  function pop(): StashEntry | undefined {
    const list = entries();
    if (list.length === 0) {
      return undefined;
    }
    const entry = list[list.length - 1];
    const next = list.slice(0, -1);
    setEntries(next);

    try {
      const filePath = stashFilePath();
      const content = next.length > 0 ? `${next.map((l) => JSON.stringify(l)).join("\n")}\n` : "";
      fs.writeFileSync(filePath, content, "utf8");
    } catch (error) {
      logUiWarnFailure(LOG_SERVICE, "弹出 prompt stash 后写回失败", error, {
        operation: "ui.promptStash.pop",
      });
    }
    return entry;
  }

  /** 移除指定索引 */
  function remove(index: number) {
    const list = entries();
    if (index < 0 || index >= list.length) {
      return;
    }
    const next = list.filter((_, i) => i !== index);
    setEntries(next);

    try {
      const filePath = stashFilePath();
      const content = next.length > 0 ? `${next.map((l) => JSON.stringify(l)).join("\n")}\n` : "";
      fs.writeFileSync(filePath, content, "utf8");
    } catch (error) {
      logUiWarnFailure(LOG_SERVICE, "移除 prompt stash 后写回失败", error, {
        index,
        operation: "ui.promptStash.remove",
      });
    }
  }

  /** 获取所有条目 */
  function list(): StashEntry[] {
    return entries();
  }

  return { list, pop, push, remove };
}

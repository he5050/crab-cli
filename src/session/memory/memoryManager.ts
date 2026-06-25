/**
 * 自动记忆系统 — 跨会话自动记忆与注入。
 *
 * 职责:
 *   - 会话结束时自动提取关键信息(构建命令、调试经验、用户偏好)
 *   - 保存到 ~/.crab/memory.json
 *   - 新会话启动时加载记忆并注入 system prompt
 *   - 使用简单的 key-value 存储格式
 *
 * 模块功能:
 *   - loadMemory: 加载所有记忆
 *   - saveMemory: 保存记忆
 *   - addMemory: 添加单条记忆
 *   - extractAndSaveMemory: 从会话消息中提取关键信息并保存
 *   - buildMemoryPrompt: 构建记忆注入提示词
 *   - clearMemory: 清除所有记忆
 *
 * 使用场景:
 *   - 会话结束时自动提取经验
 *   - 新会话启动时注入历史记忆
 *   - 跨项目/跨会话知识积累
 *
 * 边界:
 *   1. 使用简单 key-value 存储，不做语义索引
 *   2. 最大记忆条数: 100
 *   3. 持久化文件: ~/.crab/memory.json
 *   4. 记忆提取基于规则匹配，不调用 LLM
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@/core/logging/logger";
import { getDataDir } from "@/config";
import { shortUuid } from "@/core/id";

const log = createLogger("memory");

// ─── 类型定义 ─────────────────────────────────────────────────

export type MemoryCategory = "command" | "debug" | "preference" | "fact" | "error_solution";

export interface MemoryEntry {
  /** 唯一 ID */
  id: string;
  /** 记忆分类 */
  category: MemoryCategory;
  /** 记忆内容 */
  content: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后访问时间 */
  lastAccessedAt: number;
  /** 访问次数 */
  accessCount: number;
  /** 来源会话 ID */
  sessionId?: string;
  /** 标签 */
  tags?: string[];
}

export interface MemoryStore {
  /** 记忆列表 */
  entries: MemoryEntry[];
  /** 最后更新时间 */
  updatedAt: number;
}

// ─── 持久化 ──────────────────────────────────────────────────

const MEMORY_FILE = "memory.json";
const MAX_ENTRIES = 100;

function getMemoryFilePath(): string {
  return path.join(getDataDir(), MEMORY_FILE);
}

/**
 * 加载所有记忆。
 */
export function loadMemory(): MemoryStore {
  const filePath = getMemoryFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return { entries: [], updatedAt: Date.now() };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as MemoryStore;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      updatedAt: parsed.updatedAt ?? Date.now(),
    };
  } catch (error) {
    log.error(`加载记忆失败: ${error instanceof Error ? error.message : String(error)}`);
    return { entries: [], updatedAt: Date.now() };
  }
}

/**
 * 保存记忆到磁盘。
 */
export function saveMemory(store: MemoryStore): void {
  const filePath = getMemoryFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    store.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    log.error(`保存记忆失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 添加单条记忆。
 */
export function addMemory(
  category: MemoryCategory,
  content: string,
  options?: { sessionId?: string; tags?: string[] },
): MemoryEntry {
  const store = loadMemory();

  // 限制最大条数，移除最旧的
  if (store.entries.length >= MAX_ENTRIES) {
    store.entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    store.entries.splice(0, store.entries.length - MAX_ENTRIES + 1);
  }

  const entry: MemoryEntry = {
    accessCount: 0,
    category,
    content,
    createdAt: Date.now(),
    id: shortUuid().slice(0, 8),
    lastAccessedAt: Date.now(),
    sessionId: options?.sessionId,
    tags: options?.tags,
  };

  store.entries.push(entry);
  saveMemory(store);

  log.info(`记忆已添加: [${category}] ${content.slice(0, 60)}`);
  return entry;
}

/**
 * 删除指定记忆。
 */
export function deleteMemory(id: string): boolean {
  const store = loadMemory();
  const index = store.entries.findIndex((e) => e.id === id);
  if (index === -1) {
    return false;
  }
  store.entries.splice(index, 1);
  saveMemory(store);
  log.info(`记忆已删除: ${id}`);
  return true;
}

/**
 * 清除所有记忆。
 */
export function clearMemory(): void {
  saveMemory({ entries: [], updatedAt: Date.now() });
  log.info("所有记忆已清除");
}

// ─── 自动提取 ────────────────────────────────────────────────

/** 构建命令匹配模式 */
const COMMAND_PATTERNS = [
  /(?:bun|npm|yarn|pnpm|npx)\s+(?:run\s+)?(?:build|dev|test|lint|format|start)/gi,
  /(?:make|cmake|cargo|go|python|pip)\s+\w+/gi,
  /(?:git)\s+(?:clone|commit|push|pull|checkout|merge|rebase)/gi,
  /(?:docker)\s+(?:build|run|compose|exec)/gi,
];

/** 调试经验匹配模式 */
const DEBUG_PATTERNS = [
  /(?:error|错误|失败)[:：]\s*(.+)/gi,
  /(?:fix|修复|解决)[:：]\s*(.+)/gi,
  /(?:原因|because|cause)[:：]\s*(.+)/gi,
  /(?:workaround|绕过|替代方案)[:：]\s*(.+)/gi,
];

/** 用户偏好匹配模式 */
const PREFERENCE_PATTERNS = [
  /(?:我喜欢|我习惯|my preference|I prefer)[:：]?\s*(.+)/gi,
  /(?:请使用|please use|默认使用)[:：]?\s*(.+)/gi,
  /(?:不要|don't|avoid)[:：]?\s*(.+)/gi,
];

/**
 * 从会话消息中提取关键信息并保存。
 * 基于规则匹配，不调用 LLM。
 *
 * @param messages - 会话消息文本列表
 * @param sessionId - 来源会话 ID
 */
export function extractAndSaveMemory(messages: string[], sessionId?: string): MemoryEntry[] {
  const extracted: MemoryEntry[] = [];
  const fullText = messages.join("\n");

  // 提取构建命令
  for (const pattern of COMMAND_PATTERNS) {
    const matches = fullText.matchAll(pattern);
    for (const match of matches) {
      const cmd = match[0].trim();
      if (cmd.length > 5 && cmd.length < 200) {
        // 去重: 检查是否已存在相同内容
        const store = loadMemory();
        const exists = store.entries.some((e) => e.category === "command" && e.content === cmd);
        if (!exists) {
          extracted.push(addMemory("command", cmd, { sessionId, tags: ["auto-extracted"] }));
        }
      }
    }
  }

  // 提取调试经验
  for (const pattern of DEBUG_PATTERNS) {
    const matches = fullText.matchAll(pattern);
    for (const match of matches) {
      const text = (match[1] ?? match[0]).trim();
      if (text.length > 10 && text.length < 500) {
        const store = loadMemory();
        const exists = store.entries.some((e) => e.category === "debug" && e.content === text);
        if (!exists) {
          extracted.push(addMemory("debug", text, { sessionId, tags: ["auto-extracted"] }));
        }
      }
    }
  }

  // 提取用户偏好
  for (const pattern of PREFERENCE_PATTERNS) {
    const matches = fullText.matchAll(pattern);
    for (const match of matches) {
      const text = (match[1] ?? match[0]).trim();
      if (text.length > 5 && text.length < 300) {
        const store = loadMemory();
        const exists = store.entries.some((e) => e.category === "preference" && e.content === text);
        if (!exists) {
          extracted.push(addMemory("preference", text, { sessionId, tags: ["auto-extracted"] }));
        }
      }
    }
  }

  if (extracted.length > 0) {
    log.info(`自动提取了 ${extracted.length} 条记忆`);
  }

  return extracted;
}

// ─── 提示词构建 ──────────────────────────────────────────────

/**
 * 构建记忆注入提示词。
 * 将记忆按分类组织，注入到 system prompt 中。
 *
 * @param maxEntries - 最大注入条数，默认 20
 */
export function buildMemoryPrompt(maxEntries = 20): string {
  const store = loadMemory();
  if (store.entries.length === 0) {
    return "";
  }

  // 按访问次数和最近访问时间排序
  const sorted = [...store.entries]
    .sort((a, b) => {
      const scoreA = a.accessCount * 0.5 + (Date.now() - a.lastAccessedAt) * -0.0001;
      const scoreB = b.accessCount * 0.5 + (Date.now() - b.lastAccessedAt) * -0.0001;
      return scoreB - scoreA;
    })
    .slice(0, maxEntries);

  // 更新访问计数
  for (const entry of sorted) {
    entry.accessCount += 1;
    entry.lastAccessedAt = Date.now();
  }
  saveMemory(store);

  // 按分类分组
  const grouped: Record<MemoryCategory, string[]> = {
    command: [],
    debug: [],
    error_solution: [],
    fact: [],
    preference: [],
  };

  for (const entry of sorted) {
    grouped[entry.category].push(`  - ${entry.content}`);
  }

  const sections: string[] = [];
  if (grouped.command.length > 0) {
    sections.push(`### 常用命令\n${grouped.command.join("\n")}`);
  }
  if (grouped.debug.length > 0) {
    sections.push(`### 调试经验\n${grouped.debug.join("\n")}`);
  }
  if (grouped.preference.length > 0) {
    sections.push(`### 用户偏好\n${grouped.preference.join("\n")}`);
  }
  if (grouped.fact.length > 0) {
    sections.push(`### 项目事实\n${grouped.fact.join("\n")}`);
  }
  if (grouped.error_solution.length > 0) {
    sections.push(`### 错误解决方案\n${grouped.error_solution.join("\n")}`);
  }

  if (sections.length === 0) {
    return "";
  }

  return `## 跨会话记忆\n以下是从历史会话中自动提取的关键信息，供参考:\n\n${sections.join("\n\n")}`;
}

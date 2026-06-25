/**
 * 笔记本工具 — 会话级别的笔记管理。
 *
 * 职责:
 *   - 创建、读取、更新、删除笔记
 *   - 会话级别的笔记隔离
 *   - 持久化存储
 *   - 支持标签管理
 *
 * 模块功能:
 *   - notebookTool: 笔记本工具定义
 *   - 笔记 CRUD 操作
 *   - 按会话隔离笔记
 *   - 支持标签分类
 *
 * 使用场景:
 *   - AI 需要记录会话笔记
 *   - 保存重要信息
 *   - 分类整理笔记
 *
 * 边界:
 *   1. 权限:fs.edit
 *   2. 存储位置:项目 .crab/notebooks/<session-id>.json
 *   3. 支持内存模式和持久化模式
 *   4. 最大笔记本数量限制
 *   5. 笔记按会话隔离
 *
 * 流程:
 *   1. 接收操作参数
 *   2. 加载或创建笔记本
 *   3. 执行 CRUD 操作
 *   4. 持久化到文件(如需要)
 *   5. 返回操作结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_NOTEBOOKS } from "@/config";

const log = createLogger("tool:notebook");

interface NoteEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  filePaths: string[];
  createdAt: string;
  updatedAt: string;
}

interface NotebookStore {
  entries: NoteEntry[];
  updatedAt: string;
}

// Removed: using imported MAX_NOTEBOOKS from constants
const notebooks = new Map<string, NotebookStore>();

function trimNotebooks(): void {
  if (notebooks.size <= MAX_NOTEBOOKS) {
    return;
  }
  const firstKey = notebooks.keys().next().value;
  if (firstKey) {
    notebooks.delete(firstKey);
  }
}

function getNotebook(sessionId?: string, projectDir?: string): NotebookStore {
  const key = sessionId ?? "__default__";
  if (!notebooks.has(key)) {
    // 尝试从磁盘加载
    if (projectDir) {
      const filePath = path.join(projectDir, ".crab", "notebooks", `${key}.json`);
      try {
        if (fs.existsSync(filePath)) {
          const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
          notebooks.set(key, data as NotebookStore);
          return data as NotebookStore;
        }
      } catch {
        /* Ignore */
      }
    }
    trimNotebooks();
    notebooks.set(key, { entries: [], updatedAt: new Date().toISOString() });
  }
  return notebooks.get(key)!;
}

function saveNotebook(store: NotebookStore, sessionId?: string, projectDir?: string): void {
  store.updatedAt = new Date().toISOString();
  if (projectDir) {
    const key = sessionId ?? "__default__";
    const filePath = path.join(projectDir, ".crab", "notebooks", `${key}.json`);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  }
}

function genId(): string {
  return `note_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

/**
 * 查询与指定文件路径关联的笔记。
 * 先搜索内存中已加载的 notebook，再扫描磁盘上的持久化文件。
 */
/** getNotesForFile 的实现 */
export function getNotesForFile(
  filePath: string,
  projectDir?: string,
): { title: string; content: string; tags: string[] }[] {
  const normalized = path.resolve(filePath);
  const results: { title: string; content: string; tags: string[]; id: string }[] = [];
  const seenIds = new Set<string>();

  const collect = (store: NotebookStore) => {
    for (const entry of store.entries) {
      if (seenIds.has(entry.id)) {
        continue;
      }
      if (entry.filePaths?.includes(normalized)) {
        seenIds.add(entry.id);
        results.push({ content: entry.content, id: entry.id, tags: entry.tags, title: entry.title });
      }
    }
  };

  for (const store of notebooks.values()) {
    collect(store);
  }

  if (projectDir) {
    const nbDir = path.join(projectDir, ".crab", "notebooks");
    try {
      if (fs.existsSync(nbDir)) {
        for (const file of fs.readdirSync(nbDir)) {
          if (!file.endsWith(".json")) {
            continue;
          }
          const key = file.replace(".json", "");
          if (notebooks.has(key)) {
            continue;
          }
          try {
            const data = JSON.parse(fs.readFileSync(path.join(nbDir, file), "utf8")) as NotebookStore;
            collect(data);
          } catch {
            /* Skip corrupt files */
          }
        }
      }
    } catch {
      /* Dir read failed */
    }
  }

  return results.map(({ title, content, tags }) => ({ content, tags, title }));
}

/** 笔记管理工具：创建、读取、搜索、更新、删除笔记条目 */
/** 笔记管理工具：创建、读取、搜索、更新、删除笔记条目 */
export const notebookTool = defineTool({
  description:
    "管理会话笔记。支持创建、读取、搜索、更新、删除笔记条目，" +
    "以及将笔记与文件路径关联(associate/dissociate)。" +
    "关联后，读取文件时会自动附带相关笔记作为上下文知识。" +
    "笔记持久化到项目 .crab/notebooks/ 目录。",
  execute: async ({ action, title, content, noteId, tags, query, filePath, sessionId, projectDir }) => {
    const store = getNotebook(sessionId, projectDir);
    const cwd = projectDir;

    switch (action) {
      case "create": {
        if (!title) {
          return { error: "需要 title", success: false };
        }
        const now = new Date().toISOString();
        const entry: NoteEntry = {
          content: content ?? "",
          createdAt: now,
          filePaths: [],
          id: genId(),
          tags: tags ?? [],
          title,
          updatedAt: now,
        };
        store.entries.push(entry);
        saveNotebook(store, sessionId, cwd);
        log.info(`笔记已创建: ${entry.id}`);
        return { action: "create", entry, success: true, total: store.entries.length };
      }
      case "read": {
        if (!noteId) {
          return { error: "需要 noteId", success: false };
        }
        const entry = store.entries.find((e) => e.id === noteId);
        if (!entry) {
          return { error: `笔记不存在: ${noteId}`, success: false };
        }
        return { action: "read", entry, success: true };
      }
      case "update": {
        if (!noteId) {
          return { error: "需要 noteId", success: false };
        }
        const entry = store.entries.find((e) => e.id === noteId);
        if (!entry) {
          return { error: `笔记不存在: ${noteId}`, success: false };
        }
        if (title) {
          entry.title = title;
        }
        if (content !== undefined) {
          entry.content = content;
        }
        if (tags) {
          entry.tags = tags;
        }
        entry.updatedAt = new Date().toISOString();
        saveNotebook(store, sessionId, cwd);
        return { action: "update", entry, success: true };
      }
      case "delete": {
        if (!noteId) {
          return { error: "需要 noteId", success: false };
        }
        const idx = store.entries.findIndex((e) => e.id === noteId);
        if (idx === -1) {
          return { error: `笔记不存在: ${noteId}`, success: false };
        }
        const removed = store.entries.splice(idx, 1)[0]!;
        saveNotebook(store, sessionId, cwd);
        return { action: "delete", entry: removed, success: true };
      }
      case "search": {
        if (!query) {
          return { error: "需要 query", success: false };
        }
        const q = query.toLowerCase();
        // 支持正则搜索(如果 query 以 / 开头和结尾)
        // 注意: 正则表达式来自用户输入，需做长度限制防止 ReDoS
        let regex: RegExp | null = null;
        if (query.startsWith("/") && query.endsWith("/")) {
          const regexBody = query.slice(1, -1);
          if (regexBody.length > 200) {
            return { error: "正则表达式过长(最大 200 字符)", success: false };
          }
          try {
            regex = new RegExp(regexBody, "i");
          } catch {
            return { error: "无效的正则表达式", success: false };
          }
        }
        const results = store.entries.filter((e) => {
          if (regex) {
            return regex.test(e.title) || regex.test(e.content) || e.tags.some((t) => regex!.test(t));
          }
          return (
            e.title.toLowerCase().includes(q) ||
            e.content.toLowerCase().includes(q) ||
            e.tags.some((t) => t.toLowerCase().includes(q))
          );
        });
        return { action: "search", results, success: true, total: results.length };
      }
      case "list": {
        return { action: "list", entries: store.entries, success: true, total: store.entries.length };
      }
      case "associate": {
        if (!noteId) {
          return { error: "需要 noteId", success: false };
        }
        if (!filePath) {
          return { error: "需要 filePath", success: false };
        }
        const entry = store.entries.find((e) => e.id === noteId);
        if (!entry) {
          return { error: `笔记不存在: ${noteId}`, success: false };
        }
        const normalized = path.resolve(filePath);
        if (!entry.filePaths.includes(normalized)) {
          entry.filePaths.push(normalized);
          entry.updatedAt = new Date().toISOString();
          saveNotebook(store, sessionId, cwd);
        }
        return { action: "associate", entry, success: true };
      }
      case "dissociate": {
        if (!noteId) {
          return { error: "需要 noteId", success: false };
        }
        if (!filePath) {
          return { error: "需要 filePath", success: false };
        }
        const entry = store.entries.find((e) => e.id === noteId);
        if (!entry) {
          return { error: `笔记不存在: ${noteId}`, success: false };
        }
        const normalized = path.resolve(filePath);
        const idx = entry.filePaths.indexOf(normalized);
        if (idx === -1) {
          return { error: `该笔记未关联此文件: ${filePath}`, success: false };
        }
        entry.filePaths.splice(idx, 1);
        entry.updatedAt = new Date().toISOString();
        saveNotebook(store, sessionId, cwd);
        return { action: "dissociate", entry, success: true };
      }
      default: {
        return { error: `未知操作: ${action}`, success: false };
      }
    }
  },
  name: "notebook",
  parameters: z.object({
    action: z
      .enum(["create", "read", "update", "delete", "search", "list", "associate", "dissociate"])
      .describe("操作"),
    content: z.string().optional().describe("笔记内容"),
    filePath: z.string().optional().describe("关联的文件路径(用于 associate/dissociate)"),
    noteId: z.string().optional().describe("笔记 ID"),
    projectDir: z.string().optional().describe("项目目录"),
    query: z.string().optional().describe("搜索关键词"),
    sessionId: z.string().optional().describe("会话 ID"),
    tags: z.array(z.string()).optional().describe("标签列表"),
    title: z.string().optional().describe("笔记标题"),
  }),
  permission: "fs.edit",
  builtin: true,
});

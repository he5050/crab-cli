/**
 * 文件笔记本管理器 — 按文件维度管理笔记/备注
 *
 *
 * 存储: ~/.crab/notebook/{projectName}.json
 * 快照: ~/.crab/notebook/{projectName}_snapshots.json（用于消息级回滚）
 * 限制: 每文件最多 50 条笔记
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, basename } from "node:path";
import { randomBytes } from "node:crypto";

// ─── 类型 ──────────────────────────────────────────────────

export interface NotebookEntry {
  id: string; // "notebook-{timestamp}_{random9chars}"
  filePath: string; // normalized relative path
  note: string;
  createdAt: string;
  updatedAt: string;
}

type NotebookData = Record<string, NotebookEntry[]>;

interface NotebookOperation {
  op: "add" | "update" | "delete";
  notebookId: string;
  previousNote?: string;
  entry?: NotebookEntry;
}

type NotebookSnapshotData = Record<string, NotebookOperation[]>;

export interface NotebookStats {
  totalFiles: number;
  totalEntries: number;
  files: Array<{ path: string; count: number }>;
}

// ─── 常量 ──────────────────────────────────────────────────

const MAX_ENTRIES_PER_FILE = 50;

// ─── 内部函数 ──────────────────────────────────────────────

function getProjectName(): string {
  return basename(process.cwd()).replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
}

function getNotebookDir(): string {
  const dir = join(homedir(), ".crab", "notebook");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getNotebookFilePath(): string {
  return join(getNotebookDir(), `${getProjectName()}.json`);
}

function getSnapshotFilePath(): string {
  return join(getNotebookDir(), `${getProjectName()}_snapshots.json`);
}

function readNotebookData(): NotebookData {
  try {
    if (!existsSync(getNotebookFilePath())) return {};
    const raw = readFileSync(getNotebookFilePath(), "utf-8");
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function saveNotebookData(data: NotebookData): void {
  writeFileSync(getNotebookFilePath(), JSON.stringify(data, null, 2), "utf-8");
}

function readSnapshotData(): NotebookSnapshotData {
  try {
    if (!existsSync(getSnapshotFilePath())) return {};
    const raw = readFileSync(getSnapshotFilePath(), "utf-8");
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function saveSnapshotData(data: NotebookSnapshotData): void {
  writeFileSync(getSnapshotFilePath(), JSON.stringify(data, null, 2), "utf-8");
}

function normalizePath(filePath: string): string {
  const abs = filePath.startsWith("/") || filePath.startsWith("~") ? filePath : join(process.cwd(), filePath);
  const rel = relative(process.cwd(), abs);
  return rel.replace(/\\/g, "/").replace(/^\.\//, "");
}

function generateNotebookId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(5).toString("hex").slice(0, 9);
  return `notebook-${ts}_${rand}`;
}

function nowISO(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ─── 核心 CRUD ─────────────────────────────────────────────

/** 添加笔记（插入到文件笔记数组头部，超限则截断尾部） */
export function addNotebook(filePath: string, note: string): NotebookEntry {
  const data = readNotebookData();
  const normalized = normalizePath(filePath);

  const entry: NotebookEntry = {
    id: generateNotebookId(),
    filePath: normalized,
    note,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  if (!data[normalized]) data[normalized] = [];
  data[normalized].unshift(entry);
  if (data[normalized].length > MAX_ENTRIES_PER_FILE) {
    data[normalized] = data[normalized].slice(0, MAX_ENTRIES_PER_FILE);
  }

  saveNotebookData(data);
  return entry;
}

/** 模糊查询笔记（按文件路径匹配，按时间倒序） */
export function queryNotebook(filePathPattern?: string, topN = 10): NotebookEntry[] {
  const data = readNotebookData();
  const all: NotebookEntry[] = [];

  for (const entries of Object.values(data)) {
    for (const entry of entries) {
      if (filePathPattern && !entry.filePath.toLowerCase().includes(filePathPattern.toLowerCase())) {
        continue;
      }
      all.push(entry);
    }
  }

  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, topN);
}

/** 获取指定文件的所有笔记 */
export function getNotebooksByFile(filePath: string): NotebookEntry[] {
  const data = readNotebookData();
  const normalized = normalizePath(filePath);
  return data[normalized] ?? [];
}

/** 按 ID 查找笔记 */
export function findNotebookById(notebookId: string): NotebookEntry | null {
  const data = readNotebookData();
  for (const entries of Object.values(data)) {
    const found = entries.find((e) => e.id === notebookId);
    if (found) return { ...found };
  }
  return null;
}

/** 更新笔记内容 */
export function updateNotebook(notebookId: string, newNote: string): NotebookEntry | null {
  const data = readNotebookData();
  for (const entries of Object.values(data)) {
    const entry = entries.find((e) => e.id === notebookId);
    if (entry) {
      entry.note = newNote;
      entry.updatedAt = nowISO();
      saveNotebookData(data);
      return { ...entry };
    }
  }
  return null;
}

/** 删除笔记 */
export function deleteNotebook(notebookId: string): boolean {
  const data = readNotebookData();
  for (const [file, entries] of Object.entries(data)) {
    const idx = entries.findIndex((e) => e.id === notebookId);
    if (idx >= 0) {
      entries.splice(idx, 1);
      if (entries.length === 0) delete data[file];
      saveNotebookData(data);
      return true;
    }
  }
  return false;
}

/** 批量添加笔记 */
export function addNotebooks(filePath: string, notes: string[]): NotebookEntry[] {
  const data = readNotebookData();
  const normalized = normalizePath(filePath);

  if (!data[normalized]) data[normalized] = [];

  const added: NotebookEntry[] = [];
  for (const note of notes) {
    const entry: NotebookEntry = {
      id: generateNotebookId(),
      filePath: normalized,
      note,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    data[normalized].unshift(entry);
    added.push(entry);
  }

  // 超限截断
  if (data[normalized].length > MAX_ENTRIES_PER_FILE) {
    data[normalized] = data[normalized].slice(0, MAX_ENTRIES_PER_FILE);
  }

  saveNotebookData(data);
  return added;
}

/** 批量删除笔记 */
export function deleteNotebooks(notebookIds: string[]): { deleted: string[]; notFound: string[] } {
  const data = readNotebookData();
  const deleted: string[] = [];
  const notFound: string[] = [];

  for (const id of notebookIds) {
    let found = false;
    for (const [file, entries] of Object.entries(data)) {
      const idx = entries.findIndex((e) => e.id === id);
      if (idx >= 0) {
        entries.splice(idx, 1);
        if (entries.length === 0) delete data[file];
        deleted.push(id);
        found = true;
        break;
      }
    }
    if (!found) notFound.push(id);
  }

  if (deleted.length > 0) saveNotebookData(data);
  return { deleted, notFound };
}

/** 清除指定文件的所有笔记 */
export function clearNotebooksByFile(filePath: string): void {
  const data = readNotebookData();
  const normalized = normalizePath(filePath);
  if (data[normalized]) {
    delete data[normalized];
    saveNotebookData(data);
  }
}

/** 获取笔记本统计 */
export function getNotebookStats(): NotebookStats {
  const data = readNotebookData();
  const files = Object.entries(data)
    .map(([path, entries]) => ({ path, count: entries.length }))
    .sort((a, b) => b.count - a.count);

  return {
    totalFiles: files.length,
    totalEntries: files.reduce((sum, f) => sum + f.count, 0),
    files,
  };
}

// ─── 快照与回滚 ─────────────────────────────────────────────

/** 记录添加操作（用于消息级回滚） */
export function recordNotebookAddition(sessionId: string, messageIndex: number, notebookId: string): void {
  const snapshots = readSnapshotData();
  const key = `${sessionId}:${messageIndex}`;
  if (!snapshots[key]) snapshots[key] = [];
  snapshots[key].push({ op: "add", notebookId });
  saveSnapshotData(snapshots);
}

/** 记录更新操作 */
export function recordNotebookUpdate(
  sessionId: string,
  messageIndex: number,
  notebookId: string,
  previousNote: string,
): void {
  const snapshots = readSnapshotData();
  const key = `${sessionId}:${messageIndex}`;
  if (!snapshots[key]) snapshots[key] = [];
  snapshots[key].push({ op: "update", notebookId, previousNote });
  saveSnapshotData(snapshots);
}

/** 记录删除操作 */
export function recordNotebookDeletion(sessionId: string, messageIndex: number, entry: NotebookEntry): void {
  const snapshots = readSnapshotData();
  const key = `${sessionId}:${messageIndex}`;
  if (!snapshots[key]) snapshots[key] = [];
  snapshots[key].push({ op: "delete", notebookId: entry.id, entry });
  saveSnapshotData(snapshots);
}

/** 获取需要回滚的操作列表 */
export function getNotebookOpsToRollback(sessionId: string, targetMessageIndex: number): NotebookOperation[] {
  const snapshots = readSnapshotData();
  const ops: NotebookOperation[] = [];

  for (const [key, operations] of Object.entries(snapshots)) {
    const parts = key.split(":");
    if (parts[0] !== sessionId || !parts[1]) continue;
    const index = Number.parseInt(parts[1], 10);
    if (index >= targetMessageIndex) {
      ops.push(...operations);
    }
  }

  return ops;
}

/** 执行回滚（逆序执行操作反转） */
export function rollbackNotebooks(sessionId: string, targetMessageIndex: number): number {
  const ops = getNotebookOpsToRollback(sessionId, targetMessageIndex);
  const reversed = [...ops].reverse();
  let count = 0;

  for (const op of reversed) {
    if (op.op === "add") {
      deleteNotebook(op.notebookId);
    } else if (op.op === "update" && op.previousNote) {
      updateNotebook(op.notebookId, op.previousNote);
    } else if (op.op === "delete" && op.entry) {
      addNotebook(op.entry.filePath, op.entry.note);
    }
    count++;
  }

  // 清理快照
  deleteNotebookSnapshotsFromIndex(sessionId, targetMessageIndex);
  return count;
}

/** 删除指定消息索引及之后的快照 */
export function deleteNotebookSnapshotsFromIndex(sessionId: string, targetMessageIndex: number): void {
  const snapshots = readSnapshotData();
  for (const key of Object.keys(snapshots)) {
    const parts = key.split(":");
    if (parts[0] !== sessionId || !parts[1]) continue;
    const index = Number.parseInt(parts[1], 10);
    if (index >= targetMessageIndex) {
      delete snapshots[key];
    }
  }
  saveSnapshotData(snapshots);
}

/** 清除会话所有快照 */
export function clearAllNotebookSnapshots(sessionId: string): void {
  const snapshots = readSnapshotData();
  for (const key of Object.keys(snapshots)) {
    if (key.startsWith(`${sessionId}:`)) {
      delete snapshots[key];
    }
  }
  saveSnapshotData(snapshots);
}

/**
 * 输入历史管理 — 用户输入历史的持久化、读取与上下浏览。
 *
 * 职责:
 *   - 将用户输入持久化到 ~/.crab/prompt-history.jsonl
 *   - 上/下方向键浏览历史(带 savedInput 暂存)
 *   - 跳过空白与重复项
 *
 * 模块功能:
 *   - MAX_INPUT_HISTORY: 最多保留 50 条
 *   - inputHistoryFilePath: 计算历史文件路径
 *   - saveHistory / loadHistory / loadHistoryEntries: 文件读写
 *   - InputHistory: 类，封装状态机
 *
 * 使用场景:
 *   - Prompt 组件上箭头调用 move(-1) 浏览上一条
 *
 * 边界:
 *   1. 相同内容连续提交视为重复，不保存
 *   2. 移动到列表头后再次上箭头不响应
 *   3. 重置 index 时不会清空 savedInput
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface InputHistoryEntry {
  input: string;
  timestamp?: number;
}

export const MAX_INPUT_HISTORY = 50;

export function inputHistoryFilePath(homeDir = os.homedir()): string {
  const dir = path.join(homeDir, ".crab");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "prompt-history.jsonl");
}

function normalizeEntry(entry: string | InputHistoryEntry, timestamp = Date.now()): InputHistoryEntry | undefined {
  const input = typeof entry === "string" ? entry : entry.input;
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  if (typeof entry === "string") {
    return { input: trimmed, timestamp };
  }
  return {
    input: trimmed,
    timestamp: typeof entry.timestamp === "number" ? entry.timestamp : timestamp,
  };
}

function parseHistoryLine(line: string): InputHistoryEntry | undefined {
  try {
    const parsed = JSON.parse(line) as Partial<InputHistoryEntry>;
    if (typeof parsed.input !== "string") {
      return undefined;
    }
    return normalizeEntry({
      input: parsed.input,
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : undefined,
    });
  } catch {
    return undefined;
  }
}

function writeEntries(filePath: string, entries: InputHistoryEntry[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
  fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf8");
}

export function saveHistory(filePath: string, entries: (string | InputHistoryEntry)[]): void {
  const normalized = entries
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is InputHistoryEntry => entry !== undefined)
    .slice(-MAX_INPUT_HISTORY);
  writeEntries(filePath, normalized);
}

export function loadHistoryEntries(filePath = inputHistoryFilePath()): InputHistoryEntry[] {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    const entries = lines
      .map(parseHistoryLine)
      .filter((entry): entry is InputHistoryEntry => entry !== undefined)
      .slice(-MAX_INPUT_HISTORY);

    if (entries.length > 0 && entries.length !== lines.length) {
      writeEntries(filePath, entries);
    }

    return entries;
  } catch {
    return [];
  }
}

export function loadHistory(filePath = inputHistoryFilePath()): string[] {
  return loadHistoryEntries(filePath).map((entry) => entry.input);
}

export class InputHistory {
  private entries: InputHistoryEntry[] = [];
  private index = 0;
  private savedInput = "";

  constructor(private readonly filePath = inputHistoryFilePath()) {
    this.reload();
  }

  reload(): void {
    this.entries = loadHistoryEntries(this.filePath);
    this.index = 0;
    this.savedInput = "";
  }

  getEntries(): InputHistoryEntry[] {
    return [...this.entries];
  }

  list(): string[] {
    return this.entries.map((entry) => entry.input);
  }

  push(input: string): InputHistoryEntry | undefined {
    const entry = normalizeEntry(input);
    if (!entry) {
      return undefined;
    }

    const last = this.entries.at(-1);
    if (last?.input === entry.input) {
      return undefined;
    }

    this.entries = [...this.entries, entry].slice(-MAX_INPUT_HISTORY);
    this.index = 0;
    this.savedInput = "";
    writeEntries(this.filePath, this.entries);
    return entry;
  }

  move(direction: 1 | -1, currentInput: string): string | undefined {
    if (!this.entries.length) {
      return undefined;
    }

    if (this.index === 0 && direction === -1) {
      this.savedInput = currentInput;
    }

    const nextIndex = this.index + direction;
    if (nextIndex > 0) {
      return undefined;
    }
    if (Math.abs(nextIndex) > this.entries.length) {
      return undefined;
    }

    this.index = nextIndex;
    if (nextIndex === 0) {
      return this.savedInput || "";
    }

    return this.entries.at(nextIndex)?.input;
  }

  reset(): void {
    this.index = 0;
    this.savedInput = "";
  }

  getSavedInput(): string {
    return this.savedInput;
  }
}

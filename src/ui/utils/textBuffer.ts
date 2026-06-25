/**
 * 多行文本编辑缓冲区模块
 *
 * 职责:
 *   - 提供多行文本编辑缓冲区
 *   - 管理光标位置和移动
 *   - 支持撤销/重做功能
 *   - 处理视觉换行和视口管理
 *
 * 模块功能:
 *   - 文本插入、删除、退格操作
 *   - 光标移动(左/右/上/下/行首/行尾)
 *   - 撤销/重做历史记录(最多100条)
 *   - 视觉换行计算(支持宽字符)
 *   - 视口更新和适配
 *   - 字符信息查询(光标处字符)
 *
 * 使用场景:
 *   - TUI 多行文本输入框
 *   - 聊天输入框的文本编辑
 *   - 代码编辑器缓冲区
 *   - 需要复杂文本操作的界面组件
 *
 * 边界:
 *   1. 使用 crab-cli 的 text-utils(cpLen, cpSlice, visualWidth 等)
 *   2. 精简实现，暂不含粘贴占位符/图片/Skill 标签
 *   3. 不依赖 string-width，使用内联 visualWidth
 *   4. 历史记录最多保留 100 条
 *   5. 输入会被清理(替换 \r\n 为 \n，\t 转为两个空格等)
 *   6. 不处理选择/高亮功能
 *
 * 流程:
 *   1. 创建 TextBuffer 实例(传入视口和更新回调)
 *   2. 插入/删除文本时自动更新内容和光标
 *   3. 每次修改推入历史记录栈
 *   4. 光标移动时重新计算视觉位置
 *   5. 视口变化时重新计算视觉换行
 *   6. 支持撤销/重做操作
 */

import {
  codePointToVisualPos,
  cpLen,
  cpSlice,
  toCodePoints,
  visualPosToCodePoint,
  visualWidth,
} from "@/core/utilities/textUtils";

// ─── 类型 ──────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
}

interface HistoryEntry {
  content: string;
  cursorIndex: number;
}

// ─── 工具函数 ──────────────────────────────────────────────

/**
 * 清理可能破坏终端渲染的字符。
 */
function sanitizeInput(str: string): string {
  return str
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\x1b\[[IO]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

// ─── TextBuffer ────────────────────────────────────────────

export class TextBuffer {
  private content = "";
  private cursorIndex = 0;
  private viewport: Viewport;
  private onUpdateCallback?: () => void;
  private isDestroyed = false;

  // 历史记录(撤销/重做)
  private history: HistoryEntry[] = [];
  private historyIndex = -1;
  private readonly MAX_HISTORY = 100;

  // 视觉状态缓存
  private visualLines: string[] = [""];
  private visualLineStarts: number[] = [0];
  private visualCursorPos: [number, number] = [0, 0];
  private preferredVisualCol = 0;

  constructor(viewport: Viewport, onUpdate?: () => void) {
    this.viewport = viewport;
    this.onUpdateCallback = onUpdate;
    this.pushHistory();
    this.recalculateVisualState();
  }

  // ─── 生命周期 ──────────────────────────────────────────

  destroy(): void {
    this.isDestroyed = true;
    this.onUpdateCallback = undefined;
    this.history = [];
  }

  // ─── Getter ────────────────────────────────────────────

  get text(): string {
    return this.content;
  }

  get visualCursor(): [number, number] {
    return this.visualCursorPos;
  }

  getCursorPosition(): number {
    return this.cursorIndex;
  }

  setCursorPosition(position: number): void {
    this.cursorIndex = position;
    this.clampCursorIndex();
    this.recomputeVisualCursorOnly();
  }

  get viewportVisualLines(): string[] {
    return this.visualLines;
  }

  get maxWidth(): number {
    return this.viewport.width;
  }

  // ─── 文本操作 ──────────────────────────────────────────

  setText(text: string): void {
    const sanitized = sanitizeInput(text);
    this.content = sanitized;
    this.clampCursorIndex();
    this.pushHistory();
    this.recalculateVisualState();
    this.scheduleUpdate();
  }

  insert(input: string): void {
    const sanitized = sanitizeInput(input);
    if (!sanitized) {
      return;
    }
    this.insertPlainText(sanitized);
    this.pushHistory();
  }

  private insertPlainText(text: string): void {
    if (!text) {
      return;
    }
    this.clampCursorIndex();
    const before = cpSlice(this.content, 0, this.cursorIndex);
    const after = cpSlice(this.content, this.cursorIndex);
    this.content = before + text + after;
    this.cursorIndex += cpLen(text);
    this.recalculateVisualState();
    this.scheduleUpdate();
  }

  backspace(): void {
    if (this.cursorIndex === 0) {
      return;
    }
    const before = cpSlice(this.content, 0, this.cursorIndex - 1);
    const after = cpSlice(this.content, this.cursorIndex);
    this.content = before + after;
    this.cursorIndex -= 1;
    this.pushHistory();
    this.recalculateVisualState();
    this.scheduleUpdate();
  }

  delete(): void {
    if (this.cursorIndex >= cpLen(this.content)) {
      return;
    }
    const before = cpSlice(this.content, 0, this.cursorIndex);
    const after = cpSlice(this.content, this.cursorIndex + 1);
    this.content = before + after;
    this.pushHistory();
    this.recalculateVisualState();
    this.scheduleUpdate();
  }

  // ─── 光标移动 ──────────────────────────────────────────

  moveLeft(): void {
    if (this.cursorIndex === 0) {
      return;
    }
    this.cursorIndex -= 1;
    this.recalculateVisualState();
    this.scheduleUpdate();
  }

  moveRight(): void {
    if (this.cursorIndex >= cpLen(this.content)) {
      return;
    }
    this.cursorIndex += 1;
    this.recalculateVisualState();
    this.scheduleUpdate();
  }

  moveUp(): void {
    if (this.visualLines.length === 0) {
      return;
    }
    const hasNewline = this.content.includes("\n");
    if (!hasNewline && this.visualLines.length === 1) {
      this.cursorIndex = 0;
      this.recomputeVisualCursorOnly();
      this.scheduleUpdate();
      return;
    }
    const currentRow = this.visualCursorPos[0];
    if (currentRow <= 0) {
      return;
    }
    this.moveCursorToVisualRow(currentRow - 1);
    this.scheduleUpdate();
  }

  moveDown(): void {
    if (this.visualLines.length === 0) {
      return;
    }
    const hasNewline = this.content.includes("\n");
    if (!hasNewline && this.visualLines.length === 1) {
      this.cursorIndex = cpLen(this.content);
      this.recomputeVisualCursorOnly();
      this.scheduleUpdate();
      return;
    }
    const currentRow = this.visualCursorPos[0];
    if (currentRow >= this.visualLines.length - 1) {
      return;
    }
    this.moveCursorToVisualRow(currentRow + 1);
    this.scheduleUpdate();
  }

  moveLineStart(): void {
    const row = this.visualCursorPos[0];
    const start = this.visualLineStarts[row] ?? 0;
    this.cursorIndex = start;
    // 跳过行首空白
    const line = this.visualLines[row] ?? "";
    const trimmed = line.trimStart();
    if (trimmed.length < line.length) {
      this.cursorIndex = start + (line.length - trimmed.length);
    }
    this.recomputeVisualCursorOnly();
    this.scheduleUpdate();
  }

  moveLineEnd(): void {
    const row = this.visualCursorPos[0];
    const start = this.visualLineStarts[row] ?? 0;
    const line = this.visualLines[row] ?? "";
    this.cursorIndex = start + cpLen(line);
    this.recomputeVisualCursorOnly();
    this.scheduleUpdate();
  }

  // ─── 撤销/重做 ────────────────────────────────────────

  undo(): boolean {
    if (this.historyIndex <= 0) {
      return false;
    }
    this.historyIndex--;
    const entry = this.history[this.historyIndex];
    if (!entry) {
      return false;
    }
    this.content = entry.content;
    this.cursorIndex = entry.cursorIndex;
    this.recalculateVisualState();
    this.scheduleUpdate();
    return true;
  }

  redo(): boolean {
    if (this.historyIndex >= this.history.length - 1) {
      return false;
    }
    this.historyIndex++;
    const entry = this.history[this.historyIndex];
    if (!entry) {
      return false;
    }
    this.content = entry.content;
    this.cursorIndex = entry.cursorIndex;
    this.recalculateVisualState();
    this.scheduleUpdate();
    return true;
  }

  get canUndo(): boolean {
    return this.historyIndex > 0;
  }

  get canRedo(): boolean {
    return this.historyIndex < this.history.length - 1;
  }

  // ─── 视口 ──────────────────────────────────────────────

  updateViewport(viewport: Viewport): void {
    const needsRecalculation = this.viewport.width !== viewport.width || this.viewport.height !== viewport.height;
    this.viewport = viewport;
    if (needsRecalculation) {
      this.recalculateVisualState();
      this.scheduleUpdate();
    }
  }

  // ─── 字符信息 ──────────────────────────────────────────

  getCharAtCursor(): { char: string; isWideChar: boolean } {
    const codePoints = toCodePoints(this.content);
    if (this.cursorIndex >= codePoints.length) {
      return { char: " ", isWideChar: false };
    }
    const char = codePoints[this.cursorIndex] ?? " ";
    return { char, isWideChar: visualWidth(char) > 1 };
  }

  // ─── 内部方法 ──────────────────────────────────────────

  private scheduleUpdate(): void {
    if (!this.isDestroyed && this.onUpdateCallback) {
      this.onUpdateCallback();
    }
  }

  private clampCursorIndex(): void {
    const length = cpLen(this.content);
    if (this.cursorIndex < 0) {
      this.cursorIndex = 0;
    } else if (this.cursorIndex > length) {
      this.cursorIndex = length;
    }
  }

  private pushHistory(): void {
    // 截断当前位置之后的历史
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push({ content: this.content, cursorIndex: this.cursorIndex });
    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
  }

  private recalculateVisualState(): void {
    this.clampCursorIndex();
    const { width } = this.viewport;
    const effectiveWidth = Number.isFinite(width) && width > 0 ? width : Number.POSITIVE_INFINITY;
    const rawLines = this.content.split("\n");
    const nextVisualLines: string[] = [];
    const nextStarts: number[] = [];
    let cpOffset = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const rawLine = rawLines[i] ?? "";
      const segments = this.wrapLineToWidth(rawLine, effectiveWidth);
      if (segments.length === 0) {
        nextVisualLines.push("");
        nextStarts.push(cpOffset);
      } else {
        for (const segment of segments) {
          nextVisualLines.push(segment);
          nextStarts.push(cpOffset);
          cpOffset += cpLen(segment);
        }
      }
      if (i < rawLines.length - 1) {
        cpOffset += 1; // Newline char
      }
    }

    if (nextVisualLines.length === 0) {
      nextVisualLines.push("");
      nextStarts.push(0);
    }

    this.visualLines = nextVisualLines;
    this.visualLineStarts = nextStarts;
    this.visualCursorPos = this.computeVisualCursorFromIndex(this.cursorIndex);
    this.preferredVisualCol = this.visualCursorPos[1];
  }

  private wrapLineToWidth(line: string, width: number): string[] {
    if (line === "") {
      return [""];
    }
    if (!Number.isFinite(width) || width <= 0) {
      return [line];
    }

    const codePoints = toCodePoints(line);
    const segments: string[] = [];
    let start = 0;

    while (start < codePoints.length) {
      let currentWidth = 0;
      let end = start;
      let lastBreak = -1;

      while (end < codePoints.length) {
        const char = codePoints[end] ?? "";
        const charWidth = visualWidth(char);
        if (char === " ") {
          lastBreak = end + 1;
        }
        if (currentWidth + charWidth > width) {
          if (lastBreak > start) {
            end = lastBreak;
          }
          break;
        }
        currentWidth += charWidth;
        end++;
      }

      if (end === start) {
        end = Math.min(start + 1, codePoints.length);
      }
      segments.push(codePoints.slice(start, end).join(""));
      start = end;
    }

    return segments;
  }

  private computeVisualCursorFromIndex(position: number): [number, number] {
    if (this.visualLines.length === 0) {
      return [0, 0];
    }
    const totalLength = cpLen(this.content);
    const clamped = Math.max(0, Math.min(position, totalLength));

    for (let i = this.visualLines.length - 1; i >= 0; i--) {
      const start = this.visualLineStarts[i] ?? 0;
      const nextStart = this.visualLineStarts[i + 1];
      const lineEnd = typeof nextStart === "number" ? nextStart - 1 : totalLength;
      if (clamped >= start && clamped <= lineEnd) {
        const line = this.visualLines[i] ?? "";
        const lineOffset = Math.max(0, clamped - start);
        const withinLine = cpSlice(line, 0, lineOffset);
        const col = Math.min(visualWidth(line), codePointToVisualPos(withinLine, cpLen(withinLine)));
        return [i, col];
      }
    }
    return [0, 0];
  }

  private moveCursorToVisualRow(targetRow: number): void {
    if (this.visualLines.length === 0) {
      this.cursorIndex = 0;
      this.visualCursorPos = [0, 0];
      return;
    }
    const row = Math.max(0, Math.min(targetRow, this.visualLines.length - 1));
    const start = this.visualLineStarts[row] ?? 0;
    const line = this.visualLines[row] ?? "";
    const lineVisualWidth = visualWidth(line);
    const visualColumn = Math.min(this.preferredVisualCol, lineVisualWidth);
    const codePointOffset = visualPosToCodePoint(line, visualColumn);
    this.cursorIndex = start + codePointOffset;
    this.visualCursorPos = [row, visualColumn];
  }

  private recomputeVisualCursorOnly(): void {
    this.visualCursorPos = this.computeVisualCursorFromIndex(this.cursorIndex);
    this.preferredVisualCol = this.visualCursorPos[1];
  }
}

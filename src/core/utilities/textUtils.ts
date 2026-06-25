/**
 * 文本工具函数。
 *
 * 职责:
 *   - 提供文本截断、格式化
 *   - Unicode 码点处理
 *   - 视觉宽度计算
 *   - 通用文本操作
 *
 * 模块功能:
 *   - toCodePoints: 字符串转为码点数组
 *   - cpLen: 获取码点长度
 *   - cpSlice: 按码点索引切片
 *   - visualWidth: 获取视觉宽度(终端列数)
 *   - truncate: 截断文本
 *   - formatBytes: 格式化字节数
 *   - formatUptime: 格式化运行时间
 *   - stripAnsi: 移除 ANSI 转义序列
 *   - wordWrap: 按宽度换行
 *
 * 使用场景:
 *   - 终端文本显示
 *   - 中文/emoji 宽度计算
 *   - 文本格式化输出
 *   - 日志格式化
 *
 * 边界:
 *   1. 纯函数，无副作用
 *   2. 正确处理代理对
 *   3. CJK 字符和 emoji 占 2 列
 *
 * 流程:
 *   1. 接收原始文本
 *   2. 按需求处理(截断、格式化等)
 *   3. 返回处理后的文本
 */

// ─── Unicode 码点工具 ─────────────────────────────────────

/**
 * 将字符串转为码点数组(正确处理代理对)。
 */
export function toCodePoints(str: string): string[] {
  return [...str];
}

/**
 * 获取字符串的码点长度(非字节长度)。
 */
export function cpLen(str: string): number {
  return toCodePoints(str).length;
}

/**
 * 按码点索引切片字符串。
 */
export function cpSlice(str: string, start: number, end?: number): string {
  const codePoints = toCodePoints(str);
  return codePoints.slice(start, end).join("");
}

// ─── 视觉宽度工具 ─────────────────────────────────────────

/**
 * East Asian Wide/Ambiguous 字符范围检测。
 * 用于终端列宽计算——CJK 字符和大多数 emoji 占 2 列。
 */
function isWideChar(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  // CJK Unified Ideographs
  if (cp >= 0x4e_00 && cp <= 0x9f_ff) {
    return true;
  }
  // CJK Extension A
  if (cp >= 0x34_00 && cp <= 0x4d_bf) {
    return true;
  }
  // CJK Compatibility Ideographs
  if (cp >= 0xf9_00 && cp <= 0xfa_ff) {
    return true;
  }
  // CJK Extension B-I (simplified check)
  if (cp >= 0x2_00_00 && cp <= 0x2_fa_1f) {
    return true;
  }
  // Hiragana + Katakana
  if (cp >= 0x30_40 && cp <= 0x30_9f) {
    return true;
  }
  if (cp >= 0x30_a0 && cp <= 0x30_ff) {
    return true;
  }
  // Hangul Syllables
  if (cp >= 0xac_00 && cp <= 0xd7_a3) {
    return true;
  }
  // Fullwidth Forms
  if (cp >= 0xff_01 && cp <= 0xff_60) {
    return true;
  }
  // Emoji ranges (common ones that are width 2)
  if (cp >= 0x1_f3_00 && cp <= 0x1_f9_ff) {
    return true;
  }
  if (cp >= 0x26_00 && cp <= 0x27_bf) {
    return true;
  }
  // Variation selectors are zero-width
  if (cp >= 0xfe_00 && cp <= 0xfe_0f) {
    return false;
  }
  if (cp === 0x20_0d) {
    return false;
  } // ZWJ
  return false;
}

/**
 * 获取字符串的视觉宽度(终端列数)。
 * 处理中文、emoji 等宽字符。
 */
export function visualWidth(str: string): number {
  let width = 0;
  const points = toCodePoints(str);
  for (const cp of points) {
    const code = cp.codePointAt(0) ?? 0;
    // 控制字符宽度为 0
    if (code < 0x20) {
      continue;
    }
    // 变体选择符 / 组合附加符
    if (code >= 0xfe_00 && code <= 0xfe_0f) {
      continue;
    }
    if (code >= 0x03_00 && code <= 0x03_6f) {
      continue;
    }
    if (code === 0x20_0d) {
      continue;
    } // ZWJ
    width += isWideChar(cp) ? 2 : 1;
  }
  return width;
}

/**
 * 码点索引 → 视觉列位置。
 */
export function codePointToVisualPos(str: string, codePointIndex: number): number {
  const codePoints = toCodePoints(str);
  let visualPos = 0;
  for (let i = 0; i < Math.min(codePointIndex, codePoints.length); i++) {
    visualPos += visualWidth(codePoints[i] ?? "");
  }
  return visualPos;
}

/**
 * 视觉列位置 → 码点索引。
 */
export function visualPosToCodePoint(str: string, visualPos: number): number {
  const codePoints = toCodePoints(str);
  let currentVisualPos = 0;
  for (let i = 0; i < codePoints.length; i++) {
    const char = codePoints[i] ?? "";
    const charWidth = visualWidth(char);
    if (currentVisualPos + charWidth > visualPos) {
      return i;
    }
    currentVisualPos += charWidth;
    if (currentVisualPos >= visualPos) {
      return i + 1;
    }
  }
  return codePoints.length;
}

// ─── 格式化工具 ────────────────────────────────────────────

/**
 * 截断文本到指定长度，超出部分用省略号替代。
 */
export function truncate(text: string, maxLength: number, suffix = "..."): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * 格式化字节数为可读字符串。
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * 格式化运行时间为 HH:MM:SS。
 */
export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * 移除 ANSI 转义序列。
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * 按指定宽度换行文本。
 */
export function wordWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (current.length + word.length + 1 > width) {
      if (current) {
        lines.push(current);
      }
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

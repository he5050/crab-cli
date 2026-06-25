/**
 * 相似度计算 — Levenshtein 距离与模糊匹配。
 *
 * 职责:
 *   - 计算字符串相似度
 *   - Levenshtein 距离计算
 *   - 支持同步和异步计算
 *   - 提前终止优化
 *   - 空白规范化
 *
 * 模块功能:
 *   - calculateSimilarity: 计算相似度(0-1)
 *   - levenshteinDistance: 同步编辑距离
 *   - levenshteinDistanceAsync: 异步编辑距离
 *   - normalizeForDisplay: 显示用规范化
 *
 * 使用场景:
 *   - 模糊匹配查找
 *   - 文本相似度比较
 *   - 编辑距离计算
 *   - 搜索内容匹配
 *
 * 边界:
 *   1. 相似度范围 0-1
 *   2. 支持提前终止优化
 *   3. 先规范化空白再计算
 *   4. 提供同步和异步版本
 *   5. 基于编辑距离计算相似度
 *
 * 流程:
 *   1. 规范化输入字符串
 *   2. 检查长度差异
 *   3. 计算 Levenshtein 距离
 *   4. 转换为相似度
 *   5. 返回结果
 */

/**
 * 计算两个字符串的相似度(0-1)，先规范化空白再使用 Levenshtein 距离。
 * @param str1 第一个字符串
 * @param str2 第二个字符串
 * @param threshold 相似度阈值，低于此值提前返回(默认 0=不提前终止)
 * @returns 相似度值 0-1
 */
/** calculateSimilarity 的实现 */
export function calculateSimilarity(str1: string, str2: string, threshold: number = 0): number {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const norm1 = normalize(str1);
  const norm2 = normalize(str2);

  const len1 = norm1.length;
  const len2 = norm2.length;

  if (len1 === 0) {
    return len2 === 0 ? 1 : 0;
  }
  if (len2 === 0) {
    return 0;
  }

  // 长度差异过大时提前返回
  const maxLen = Math.max(len1, len2);
  const minLen = Math.min(len1, len2);
  const lengthRatio = minLen / maxLen;
  if (threshold > 0 && lengthRatio < threshold) {
    return lengthRatio;
  }

  const distance = levenshteinDistance(norm1, norm2, Math.ceil(maxLen * (1 - threshold)));

  return 1 - distance / maxLen;
}

/**
 * Levenshtein 编辑距离(同步版)，支持提前终止优化。
 * @param str1 第一个字符串
 * @param str2 第二个字符串
 * @param maxDistance 最大允许距离，超过时立即返回 maxDistance+1
 * @returns 编辑距离
 */
/** levenshteinDistance 的实现 */
export function levenshteinDistance(str1: string, str2: string, maxDistance: number = Infinity): number {
  const len1 = str1.length;
  const len2 = str2.length;

  if (str1 === str2) {
    return 0;
  }
  if (Math.abs(len1 - len2) > maxDistance) {
    return maxDistance + 1;
  }

  // 单行算法，节省内存
  let prevRow: number[] = Array.from({ length: len2 + 1 }, (_, i) => i);

  for (let i = 1; i <= len1; i++) {
    const currRow: number[] = [i];
    let minInRow = i;

    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      const val = Math.min(
        prevRow[j]! + 1, // 删除
        currRow[j - 1]! + 1, // 插入
        prevRow[j - 1]! + cost, // 替换
      );
      currRow[j] = val;
      minInRow = Math.min(minInRow, val);
    }

    // 行内最小值已超过 maxDistance → 提前终止
    if (minInRow > maxDistance) {
      return maxDistance + 1;
    }

    prevRow = currRow;
  }

  return prevRow[len2]!;
}

/**
 * Levenshtein 编辑距离(异步版)。
 * 逻辑与同步版完全一致，每处理 batchSize 行后让出事件循环。
 */
export async function levenshteinDistanceAsync(
  str1: string,
  str2: string,
  maxDistance: number = Infinity,
  batchSize: number = 50,
): Promise<number> {
  const len1 = str1.length;
  const len2 = str2.length;

  if (str1 === str2) {
    return 0;
  }
  if (Math.abs(len1 - len2) > maxDistance) {
    return maxDistance + 1;
  }

  let prevRow: number[] = Array.from({ length: len2 + 1 }, (_, i) => i);

  for (let i = 1; i <= len1; i++) {
    const currRow: number[] = [i];
    let minInRow = i;

    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      const val = Math.min(prevRow[j]! + 1, currRow[j - 1]! + 1, prevRow[j - 1]! + cost);
      currRow[j] = val;
      minInRow = Math.min(minInRow, val);
    }

    if (minInRow > maxDistance) {
      return maxDistance + 1;
    }

    prevRow = currRow;

    // 定期让出事件循环
    if (i % batchSize === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return prevRow[len2]!;
}

/**
 * 异步相似度计算 — 使用异步 Levenshtein 距离，防止大文件搜索卡住 UI。
 */
export async function calculateSimilarityAsync(str1: string, str2: string, threshold: number = 0): Promise<number> {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const norm1 = normalize(str1);
  const norm2 = normalize(str2);

  const len1 = norm1.length;
  const len2 = norm2.length;

  if (len1 === 0) {
    return len2 === 0 ? 1 : 0;
  }
  if (len2 === 0) {
    return 0;
  }

  const maxLen = Math.max(len1, len2);
  const minLen = Math.min(len1, len2);
  const lengthRatio = minLen / maxLen;
  if (threshold > 0 && lengthRatio < threshold) {
    return lengthRatio;
  }

  const distance = await levenshteinDistanceAsync(norm1, norm2, Math.ceil(maxLen * (1 - threshold)));

  return 1 - distance / maxLen;
}

/** 规范化空白用于显示:tab→空格，折叠连续空格，移除 \r */
export function normalizeForDisplay(line: string): string {
  return line.replace(/\t/g, " ").replace(/  +/g, " ").replace(/\r/g, "");
}

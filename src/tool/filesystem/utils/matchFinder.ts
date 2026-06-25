/**
 * 模糊匹配查找 — 在文件内容中寻找最接近的候选区域。
 *
 * 职责:
 *   - 在文件中查找最接近的匹配区域
 *   - 滑动窗口模糊搜索
 *   - 异步计算防止卡顿
 *   - 生成差异摘要
 *
 * 模块功能:
 *   - findClosestMatches: 查找最接近的匹配
 *   - generateDiffMessage: 生成差异消息
 *   - 首行预过滤优化
 *   - 滑动窗口搜索
 *
 * 使用场景:
 *   - 精确匹配失败时查找最接近的内容
 *   - 模糊搜索替换
 *   - 编辑建议生成
 *   - 代码定位
 *
 * 边界:
 *   1. 使用滑动窗口算法
 *   2. 首行预过滤优化(5+ 行搜索)
 *   3. 异步让出防止卡顿
 *   4. 默认返回 top 3 候选
 *   5. 相似度阈值 0.5
 *
 * 流程:
 *   1. 分割搜索内容和文件行
 *   2. 首行预过滤
 *   3. 滑动窗口计算相似度
 *   4. 收集候选结果
 *   5. 返回最接近的匹配
 */

import { calculateSimilarity, normalizeForDisplay } from "@/tool/filesystem/utils/similarity";

/** 模糊匹配候选区域 */
export interface MatchCandidate {
  startLine: number;
  endLine: number;
  similarity: number;
  preview: string;
}

/**
 * 在文件行中查找最接近搜索内容的 N 个候选区域。
 * 使用首行预过滤 + 滑动窗口 + 异步让出。
 */
export async function findClosestMatches(
  searchContent: string,
  fileLines: string[],
  topN: number = 3,
): Promise<MatchCandidate[]> {
  const searchLines = searchContent.split("\n");
  const candidates: MatchCandidate[] = [];

  // 首行锚点预过滤(仅对 5+ 行搜索启用)
  const searchFirstLine = searchLines[0]?.replace(/\s+/g, " ").trim() || "";
  const threshold = 0.5;
  const usePreFilter = searchLines.length >= 5;
  const preFilterThreshold = 0.2;
  const maxCandidates = topN * 3;
  const YIELD_INTERVAL = 100;

  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    // 定期让出事件循环
    if (i % YIELD_INTERVAL === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // 首行预过滤
    if (usePreFilter) {
      const firstLineCandidate = fileLines[i]?.replace(/\s+/g, " ").trim() || "";
      const firstLineSimilarity = calculateSimilarity(searchFirstLine, firstLineCandidate, preFilterThreshold);
      if (firstLineSimilarity < preFilterThreshold) {
        continue;
      }
    }

    // 完整候选检查
    const candidateLines = fileLines.slice(i, i + searchLines.length);
    const candidateContent = candidateLines.join("\n");
    const similarity = calculateSimilarity(searchContent, candidateContent, threshold);

    if (similarity > threshold) {
      candidates.push({
        endLine: i + searchLines.length,
        preview: candidateLines.map((line, idx) => `${i + idx + 1}→${normalizeForDisplay(line)}`).join("\n"),
        similarity,
        startLine: i + 1,
      });

      // 近乎完美匹配时提前退出
      if (similarity >= 0.95) {
        break;
      }
      if (candidates.length >= maxCandidates) {
        break;
      }
    }
  }

  return candidates.toSorted((a, b) => b.similarity - a.similarity).slice(0, topN);
}

/**
 * 生成搜索内容与实际内容的逐行差异摘要(仅显示不同行)。
 * 用于编辑失败时的错误提示。
 */
/** generateDiffMessage 的实现 */
export function generateDiffMessage(searchContent: string, actualContent: string, maxLines: number = 10): string {
  const searchLines = searchContent.split("\n");
  const actualLines = actualContent.split("\n");
  const diffLines: string[] = [];
  const maxLen = Math.max(searchLines.length, actualLines.length);

  for (let i = 0; i < Math.min(maxLen, maxLines); i++) {
    const searchLine = searchLines[i] || "";
    const actualLine = actualLines[i] || "";

    if (searchLine !== actualLine) {
      diffLines.push(`Line ${i + 1}:`);
      diffLines.push(`  Search: ${JSON.stringify(normalizeForDisplay(searchLine))}`);
      diffLines.push(`  Actual: ${JSON.stringify(normalizeForDisplay(actualLine))}`);
    }
  }

  if (maxLen > maxLines) {
    diffLines.push(`... (${maxLen - maxLines} more lines)`);
  }

  return diffLines.join("\n");
}

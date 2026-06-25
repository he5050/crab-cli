/**
 * ACE 搜索结果排序器 — 多维度智能排序
 *
 * 职责:
 *   - 对搜索结果进行多维度评分
 *   - 综合精确匹配、类型优先级、导出可见性、语义相关度、位置权重
 *   - 去重和截断
 *
 * 模块功能:
 *   - rankResults: 对搜索结果进行排序、去重和截断，返回 RankedResult[]
 *   - RankableResult: 可排序结果的接口定义
 *   - RankedResult: 排序后结果的接口定义(包含 rankScore 和 matchType)
 *
 * 使用场景:
 *   - 增强搜索结果的智能排序
 *   - 多源搜索结果融合后的排序
 *   - 代码导航中的符号搜索结果排序
 *
 * 边界:
 * 1. 模糊匹配分数为 0 时结果会被过滤
 * 2. 同文件同行的结果去重只保留最高分
 * 3. 语义分数未定义时不参与评分
 *
 * 流程:
 * 1. 对每个结果计算多维度分数(精确匹配、前缀、类型、可见性、上下文、路径、语义)
 * 2. 按分数降序排序
 * 3. 去重:同路径同行只保留最高分
 * 4. 截断到 maxResults 指定数量
 */

/** 可排序的搜索结果项，包含名称、类型、路径等基础信息 */
export interface RankableResult {
  name: string;
  kind?: string;
  type?: string;
  filePath: string;
  line: number;
  language?: string;
  signature?: string;
  documentation?: string;
  context?: string;
  modifiers?: string[];
  endLine?: number;
  semanticScore?: number;
  isFromIndex?: boolean;
}

/** 排序后的搜索结果，包含排名分数和匹配类型 */
export interface RankedResult extends RankableResult {
  rankScore: number;
  matchType: "exact" | "prefix" | "substring" | "fuzzy" | "semantic";
}

const TYPE_PRIORITY: Record<string, number> = {
  class: 10,
  constant: 4,
  enum: 7,
  export: 3,
  function: 8,
  import: 3,
  interface: 9,
  method: 7,
  module: 1,
  namespace: 2,
  property: 6,
  type: 6,
  variable: 5,
};

function matchTypeScore(name: string, query: string): { score: number; type: RankedResult["matchType"] } {
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerName === lowerQuery) {
    return { score: 50, type: "exact" };
  }
  if (lowerName.startsWith(lowerQuery)) {
    return { score: 40, type: "prefix" };
  }
  if (lowerName.includes(lowerQuery)) {
    return { score: 25, type: "substring" };
  }

  // 模糊字符连续匹配
  let qi = 0;
  let lastMatch = -1;
  let score = 0;
  for (let i = 0; i < lowerName.length && qi < lowerQuery.length; i++) {
    if (lowerName[i] === lowerQuery[qi]) {
      if (lastMatch >= 0 && i === lastMatch + 1) {
        score += 3;
      }
      if (i === 0 || lowerName[i - 1] === "/" || lowerName[i - 1] === ".") {
        score += 5;
      }
      score += 1;
      lastMatch = i;
      qi++;
    }
  }
  if (qi === lowerQuery.length) {
    return { score, type: "fuzzy" };
  }
  return { score: 0, type: "fuzzy" };
}

function typeScore(kind?: string, type?: string): number {
  const t = kind || type || "unknown";
  return TYPE_PRIORITY[t] ?? 0;
}

function visibilityScore(modifiers?: string[]): number {
  if (!modifiers) {
    return 0;
  }
  if (modifiers.includes("export") || modifiers.includes("public")) {
    return 8;
  }
  if (modifiers.includes("protected")) {
    return 4;
  }
  return 0;
}

function contextScore(result: RankableResult): number {
  let score = 0;
  if (result.signature) {
    score += 3;
  }
  if (result.documentation) {
    score += 2;
  }
  if (result.context) {
    score += 1;
  }
  return score;
}

function filePathScore(filePath: string, query: string): number {
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // 文件名包含查询
  const fileName = lowerPath.split("/").pop() ?? "";
  const nameWithoutExt = fileName.includes(".") ? fileName.split(".")[0]! : fileName;
  if (nameWithoutExt === lowerQuery) {
    return 15;
  }
  if (nameWithoutExt.includes(lowerQuery)) {
    return 8;
  }

  // 路径包含 src/lib/ 等源码目录
  if (lowerPath.includes("/src/") || lowerPath.includes("/lib/")) {
    return 5;
  }

  return 0;
}

function semanticScore(result: RankableResult): number {
  if (result.semanticScore === undefined) {
    return 0;
  }
  // 归一化到 0-15 范围
  return Math.min(result.semanticScore * 15, 15);
}

function indexBonus(result: RankableResult): number {
  return result.isFromIndex ? 5 : 0;
}

/**
 * 对搜索结果进行排序、去重和截断。
 */
/** rankResults 的实现 */
export function rankResults(results: RankableResult[], query: string, maxResults = 50): RankedResult[] {
  const ranked: RankedResult[] = [];

  for (const result of results) {
    const match = matchTypeScore(result.name, query);
    if (match.score === 0) {
      continue;
    }

    const score =
      match.score +
      typeScore(result.kind, result.type) +
      visibilityScore(result.modifiers) +
      contextScore(result) +
      filePathScore(result.filePath, query) +
      semanticScore(result) +
      indexBonus(result);

    ranked.push({ ...result, matchType: match.type, rankScore: score });
  }

  // 去重:同文件同名只保留分数最高的
  const seen = new Map<string, number>();
  const deduped: RankedResult[] = [];
  for (const r of ranked) {
    const key = `${r.filePath}:${r.line}:${r.name}`;
    const existing = seen.get(key);
    if (existing === undefined || r.rankScore > existing) {
      if (existing !== undefined) {
        const idx = deduped.findIndex((d) => `${d.filePath}:${d.line}:${d.name}` === key);
        if (idx !== -1) {
          deduped.splice(idx, 1);
        }
      }
      seen.set(key, r.rankScore);
      deduped.push(r);
    }
  }

  deduped.sort((a, b) => b.rankScore - a.rankScore);
  return deduped.slice(0, maxResults);
}

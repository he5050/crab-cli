/**
 * 代码库审查 Agent
 *
 * 职责:
 *   - 审查代码库搜索结果的相关性
 *   - 过滤和排序搜索结果
 *   - 识别最相关的代码片段
 *   - 使用 LLM 进行智能相关性评分
 *
 * 模块功能:
 *   - registerCodebaseReviewAgent: 注册代码库审查 Agent
 *   - reviewCodebaseResults: 审查代码库搜索结果
 *   - SearchResultItem: 搜索结果项接口
 *   - CodebaseReviewConfig: 审查配置接口
 *   - CodebaseReviewResult: 审查结果接口
 *
 * 使用场景:
 *   - codebase-search 返回大量结果时进行过滤
 *   - 帮助 AI 快速定位最相关的代码
 *   - 提升代码搜索的精准度
 *
 * 边界:
 *   1. 仅对搜索结果进行审查和排序，不执行实际的代码搜索
 *   2. 依赖 LLM 进行相关性判断，需要有效的 LLM 配置
 *   3. 默认最大返回 10 条结果
 *   4. 相关性阈值默认为 0.5
 *
 * 流程:
 *   1. 接收搜索查询和原始搜索结果
 *   2. 构建审查提示词，包含查询和搜索结果
 *   3. 调用 LLM 进行相关性评分
 *   4. 根据评分过滤和排序结果
 *   5. 返回审查后的结果列表
 */

import { createLogger } from "@/core/logging/logger";
import { completeLlm } from "@/api";
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { registerBuiltinAgent } from "./registry";

const log = createLogger("agent:codebase-review");

/** 搜索结果项 */
export interface SearchResultItem {
  /** 文件路径 */
  filePath: string;
  /** 代码内容 */
  content: string;
  /** 行号范围 */
  lineRange?: { start: number; end: number };
  /** 匹配分数 */
  score?: number;
  /** 匹配类型 */
  matchType?: "semantic" | "text" | "symbol" | "reference";
}

/** 审查配置 */
export interface CodebaseReviewConfig {
  /** 最大返回结果数，默认 10 */
  maxResults: number;
  /** 相关性阈值(0-1)，默认 0.5 */
  relevanceThreshold: number;
  /** 是否包含代码片段，默认 true */
  includeSnippet: boolean;
  /** 代码片段最大长度，默认 500 */
  snippetMaxLength: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: CodebaseReviewConfig = {
  includeSnippet: true,
  maxResults: 10,
  relevanceThreshold: 0.5,
  snippetMaxLength: 500,
};

/** 审查后的结果项 */
export interface ReviewedResultItem extends SearchResultItem {
  /** 相关性评分(0-1) */
  relevanceScore: number;
  /** 相关性理由 */
  relevanceReason: string;
  /** 是否推荐 */
  isRecommended: boolean;
}

/** 审查结果 */
export interface CodebaseReviewResult {
  /** 是否成功 */
  success: boolean;
  /** 审查后的结果列表 */
  results: ReviewedResultItem[];
  /** 被过滤的结果数 */
  filteredCount: number;
  /** 原始结果数 */
  originalCount: number;
  /** 错误信息 */
  error?: string;
}

/**
 * 将用户意图改写成更适合代码搜索的查询。
 *
 * 只生成一个查询词/短语，用于 Agent Review 结果不足后的单次补搜。
 */
export async function rewriteCodebaseSearchQuery(
  config: AppConfigSchema,
  query: string,
  context?: { mode?: string; cwd?: string; include?: string },
): Promise<string> {
  const messages: ModelMessage[] = [
    {
      content: `你是代码搜索查询改写器。将用户查询改写成更适合 ripgrep、符号搜索或语义代码搜索的短查询。

要求:
1. 只返回一个查询，不解释
2. 优先保留函数名、类名、配置键、错误关键字、业务名词
3. 不要返回正则，不要加引号，不要超过 80 个字符
4. 如果原查询已经足够好，返回原查询`,
      role: "system",
    },
    {
      content: [
        `原查询: ${query}`,
        `搜索模式: ${context?.mode ?? "text"}`,
        context?.include ? `文件过滤: ${context.include}` : "",
        context?.cwd ? `搜索目录: ${context.cwd}` : "",
        "请给出改写后的代码搜索查询。",
      ]
        .filter(Boolean)
        .join("\n"),
      role: "user",
    },
  ];

  const { text: response } = await completeLlm(config, messages, {
    maxTokens: 120,
    temperature: 0.1,
  });

  return normalizeRewrittenQuery(response, query);
}

/**
 * 审查代码库搜索结果
 */
export async function reviewSearchResults(
  config: AppConfigSchema,
  query: string,
  results: SearchResultItem[],
  configOverrides?: Partial<CodebaseReviewConfig>,
): Promise<CodebaseReviewResult> {
  const cfg = { ...DEFAULT_CONFIG, ...configOverrides };
  const originalCount = results.length;

  log.debug(`开始审查搜索结果`, { query: query.slice(0, 100), resultCount: originalCount });

  // 如果结果数量已经在限制内，直接返回
  if (results.length <= cfg.maxResults) {
    const reviewedItems: ReviewedResultItem[] = results.map((item) => ({
      ...item,
      isRecommended: true,
      relevanceReason: "原始搜索结果",
      relevanceScore: item.score ?? 0.8,
    }));

    return {
      filteredCount: 0,
      originalCount,
      results: reviewedItems,
      success: true,
    };
  }

  try {
    // 准备审查的代码片段
    const snippets = results
      .slice(0, Math.min(results.length, 30)) // 最多审查前 30 个结果
      .map((item, index) => {
        const content = item.content.slice(0, cfg.snippetMaxLength);
        return `--- 结果 ${index + 1} ---
文件: ${item.filePath}${item.lineRange ? ` (行 ${item.lineRange.start}-${item.lineRange.end})` : ""}
类型: ${item.matchType || "unknown"}
原始分数: ${item.score?.toFixed(2) || "N/A"}
代码:
\`\`\`
${content}${item.content.length > cfg.snippetMaxLength ? "\n... (截断)" : ""}
\`\`\``;
      })
      .join("\n\n");

    // 构建提示词
    const messages: ModelMessage[] = [
      {
        content: `你是一个代码库搜索结果审查专家。你的任务是评估搜索结果与查询的相关性。

## 审查原则
1. 评估每个结果与查询意图的匹配程度
2. 优先选择包含实际实现的代码(而非测试、文档)
3. 优先选择定义/声明而非引用
4. 考虑代码的完整性和可读性

## 输出格式
对每个结果返回 JSON 格式:
{
  "index": 结果编号(1-based),
  "relevanceScore": 相关性分数(0-1),
  "relevanceReason": "相关性理由(简短)",
  "isRecommended": true/false
}

只返回 JSON 数组，不要有其他内容。`,
        role: "system",
      },
      {
        content: `查询: "${query}"

请审查以下 ${Math.min(results.length, 30)} 个搜索结果，评估它们与查询的相关性:

${snippets}

请返回 JSON 数组格式的审查结果。`,
        role: "user",
      },
    ];

    // 调用 AI 进行审查
    const { text: response } = await completeLlm(config, messages, {
      maxTokens: 2000,
      temperature: 0.2,
    });

    // 解析审查结果
    const reviewData = parseReviewResponse(response);

    // 合并审查结果
    const reviewedItems: ReviewedResultItem[] = results.map((item, index) => {
      const review = reviewData.find((r) => r.index === index + 1);
      return {
        ...item,
        isRecommended: review?.isRecommended ?? (item.score ?? 0) >= cfg.relevanceThreshold,
        relevanceReason: review?.relevanceReason ?? "未审查",
        relevanceScore: review?.relevanceScore ?? item.score ?? 0.5,
      };
    });

    // 排序并过滤
    const sortedItems = reviewedItems
      .filter((item) => item.isRecommended && item.relevanceScore >= cfg.relevanceThreshold)
      .toSorted((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, cfg.maxResults);

    log.info(`搜索结果审查完成`, {
      filteredCount: originalCount - sortedItems.length,
      originalCount,
      reviewedCount: sortedItems.length,
    });

    return {
      filteredCount: originalCount - sortedItems.length,
      originalCount,
      results: sortedItems,
      success: true,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error(`搜索结果审查失败`, { error: errorMsg });

    // 失败时返回原始结果的前 N 个
    const fallbackItems: ReviewedResultItem[] = results.slice(0, cfg.maxResults).map((item) => ({
      ...item,
      isRecommended: true,
      relevanceReason: "审查失败，使用原始分数",
      relevanceScore: item.score ?? 0.5,
    }));

    return {
      error: errorMsg,
      filteredCount: originalCount - fallbackItems.length,
      originalCount,
      results: fallbackItems,
      success: false,
    };
  }
}

/**
 * 解析 AI 审查响应
 */
function parseReviewResponse(content: string): {
  index: number;
  relevanceScore: number;
  relevanceReason: string;
  isRecommended: boolean;
}[] {
  try {
    // 尝试提取 JSON
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (Array.isArray(data)) {
        return data.map((item) => ({
          index: item.index || item.resultIndex || 1,
          isRecommended: item.isRecommended ?? item.recommended ?? true,
          relevanceReason: item.relevanceReason || item.reason || "",
          relevanceScore:
            typeof item.relevanceScore === "number" ? item.relevanceScore : parseFloat(item.relevanceScore) || 0.5,
        }));
      }
    }
  } catch (error) {
    log.warn(`解析审查响应失败`, { content: content.slice(0, 200), error: String(error) });
  }

  return [];
}

function normalizeRewrittenQuery(response: string, fallback: string): string {
  const trimmed = response.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      const parsed = JSON.parse(objectMatch[0]);
      const query = parsed.query ?? parsed.rewrittenQuery ?? parsed.searchQuery;
      if (typeof query === "string" && query.trim()) {
        return sanitizeQuery(query, fallback);
      }
    }
  } catch {
    // 不是 JSON 时按纯文本处理。
  }

  const firstLine = trimmed
    .replace(/^```(?:json|text)?/i, "")
    .replace(/```$/i, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return sanitizeQuery(firstLine ?? fallback, fallback);
}

function sanitizeQuery(query: string, fallback: string): string {
  const normalized = query
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^query\s*[::]\s*/i, "")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 80);
}

/**
 * 快速审查(不使用 AI)
 */
export function quickReview(results: SearchResultItem[], maxResults: number = 10): ReviewedResultItem[] {
  // 按原始分数排序
  const sorted = [...results].toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return sorted.slice(0, maxResults).map((item) => ({
    ...item,
    isRecommended: true,
    relevanceReason: "按原始分数排序",
    relevanceScore: item.score ?? 0.5,
  }));
}

/**
 * 注册代码库审查 Agent 到 AgentManager
 */
export function registerCodebaseReviewAgent(): void {
  registerBuiltinAgent({
    allowedTools: ["codebase-search", "filesystem-read"],
    description: "审查代码库搜索结果的相关性，过滤和排序结果",
    hidden: true,
    label: "代码库审查",
    name: "codebase-review",
    prompt: `你是一个代码库搜索结果审查专家。你的任务是评估搜索结果与查询的相关性。

## 审查原则
1. 评估每个结果与查询意图的匹配程度
2. 优先选择包含实际实现的代码(而非测试、文档、类型声明)
3. 优先选择定义/声明而非引用
4. 考虑代码的完整性和可读性
5. 排除 node_modules、.git、dist 等目录的结果

## 输出格式
对每个结果返回 JSON 格式:
{
  "index": 结果编号,
  "relevanceScore": 相关性分数(0-1),
  "relevanceReason": "相关性理由(简短)",
  "isRecommended": true/false
}

## 降级规则
- 搜索结果为空：直接返回空数组
- 所有结果相关性低于 0.3：返回最高分的 3 条并标注低置信度
- LLM 响应解析失败：回退到按原始分数排序，取前 N 条
- 只返回 JSON 数组，不要有其他内容。`,
  });
}

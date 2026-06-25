/**
 * Deep Research 搜索执行。
 *
 * 提供搜索执行器(含 LLM 回退)和搜索结果格式化。
 */
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import type { ModelMessage, UserModelMessage } from "ai";
import { executeRegisteredTool } from "@/tool/executor/runtimeExec";
import type { ResearchConfig, ResearchSourceRecord, ResearchStep, SearchResult } from "./types";
import { collectLlmResponse } from "./llm";

const log = createLogger("conversation:deep-research");

/** 执行搜索查询，失败时自动回退到 LLM 生成发现 @param query 搜索关键词 @param topic 研究主题 @param config 应用配置 @param previousSteps 已完成的搜索步骤 @param maxTokens LLM 最大 token 数 @param abortSignal 中止信号 @param searchExecutor 自定义搜索执行器 @returns 搜索发现、来源和来源记录 */
export async function searchWithFallback(
  query: string,
  topic: string,
  config: AppConfigSchema,
  previousSteps: ResearchStep[],
  maxTokens: number,
  abortSignal?: AbortSignal,
  searchExecutor?: ResearchConfig["searchExecutor"],
): Promise<SearchResult> {
  try {
    const executor =
      searchExecutor ??
      (async (args: { query: string; maxResults: number; searchDepth: "basic" | "advanced" }) => {
        const ctx = {
          sessionId: "deep-research",
          messageId: `dr-${Date.now()}`,
          abortSignal,
        };
        const result = await executeRegisteredTool("websearch", args, ctx, {
          getConfig: () => config,
        });
        if (!result.success) {
          throw new Error(result.error ?? "websearch execution failed");
        }
        return JSON.parse(String(result.output)) as {
          content?: string;
          answer?: string;
          results?: { title?: string; url?: string; snippet?: string }[];
          error?: string;
        };
      });
    const result = await executor({
      maxResults: 5,
      query,
      searchDepth: "advanced",
    });

    const { findings, sources, sourceRecords } = formatWebsearchFindings(result, query);
    if (findings) {
      return { findings, sourceRecords, sources };
    }
  } catch (error) {
    log.warn(`websearch 搜索失败，回退到 LLM: ${error instanceof Error ? error.message : String(error)}`);
  }

  const searchMessages: ModelMessage[] = [
    {
      content: `Research query: "${query}"

This is part of a multi-step research on: "${topic}"

Provide a detailed summary of findings for this query. Include:
- Key facts and data points
- Important conclusions
- Sources or references if known

Previous findings: ${previousSteps.length > 0 ? previousSteps.map((s, idx) => `Round ${idx + 1} (${s.query}): ${s.findings.substring(0, 200)}`).join("\n") : "None yet"}`,
      role: "user",
    } as UserModelMessage,
  ];

  const llmFindings = await collectLlmResponse(config, searchMessages, maxTokens, abortSignal);
  return { findings: llmFindings, sourceRecords: [], sources: [] };
}

/**
 * 格式化 Web 搜索结果为统一的发现字符串。
 *
 * @param result - 搜索结果
 * @param query - 搜索查询关键词
 * @returns 格式化的发现文本
 */
/** formatWebsearchFindings 的实现 */
export function formatWebsearchFindings(
  result: {
    content?: string;
    answer?: string;
    results?: { title?: string; url?: string; snippet?: string }[];
    error?: string;
  },
  query?: string,
): { findings: string | null; sources: string[]; sourceRecords: ResearchSourceRecord[] } {
  if (result.error) {
    return { findings: null, sourceRecords: [], sources: [] };
  }

  const sources: string[] = [];
  const sourceRecords: ResearchSourceRecord[] = [];

  if (result.content && result.content.trim()) {
    if (Array.isArray(result.results)) {
      for (const item of result.results) {
        if (item.url) {
          sources.push(item.url);
          sourceRecords.push({
            query,
            snippet: item.snippet,
            title: item.title,
            url: item.url,
          });
        }
      }
    }
    return { findings: result.content, sourceRecords, sources };
  }

  const lines: string[] = [];
  if (result.answer?.trim()) {
    lines.push(`Summary: ${result.answer.trim()}`);
  }

  if (Array.isArray(result.results) && result.results.length > 0) {
    for (const item of result.results) {
      lines.push(`- ${item.title ?? "Untitled"} (${item.url ?? ""})`);
      if (item.snippet) {
        lines.push(`  ${item.snippet}`);
      }
      if (item.url) {
        sources.push(item.url);
        sourceRecords.push({
          query,
          snippet: item.snippet,
          title: item.title,
          url: item.url,
        });
      }
    }
  }

  const formatted = lines.join("\n").trim();
  return { findings: formatted || null, sourceRecords, sources };
}

/**
 * 深度研究(Deep Research)— 多步骤自主研究循环。
 *
 * 职责:
 *   - 执行多轮 web 搜索
 *   - 收集和综合研究发现
 *   - 生成结构化 Markdown 报告
 *
 * 模块功能:
 *   - executeDeepResearch(): 执行深度研究主流程
 *   - streamBtwResponse(): 流式 btw 旁路问答(已移至 btwStream.ts)
 *
 * 使用场景:
 *   - 用户请求深入研究某个主题
 *   - 需要综合多个来源的复杂查询
 *
 * 边界:
 * 1. 支持最多 5 轮搜索(可配置)
 * 2. 支持迭代优化:LLM 审查发现后生成后续查询
 * 3. 报告保存到 .crab/deepresearch/ 目录
 *
 * 流程:
 * 1. 规划阶段:LLM 生成搜索查询列表
 * 2. 搜索阶段:并行执行多轮搜索，收集发现
 * 3. 综合阶段:LLM 综合所有发现生成报告
 * 4. 保存阶段:报告写入 .crab/deepresearch/ 目录
 */

// ── 类型与配置 re-export ──────────────────────────────────────
/** re-export */
export type {
  ResearchConfig,
  ResearchProgressCallback,
  ResearchReportMetadata,
  ResearchSourceRecord,
  ResearchStep,
} from "./types";
export { DEFAULT_RESEARCH_CONFIG } from "./types";

import type { AppConfigSchema } from "@/schema/config";
import { iconWarning } from "@/core/icons/icon";
import { createLogger } from "@/core/logging/logger";
import { createUserError } from "@/core/errors/appError";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelMessage, UserModelMessage } from "ai";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { loadConfig } from "@/config";

import type { ResearchConfig, ResearchProgressCallback, ResearchSourceRecord, ResearchStep } from "./types";
import { DEFAULT_RESEARCH_CONFIG } from "./types";
import { collectLlmResponse } from "./llm";
import { searchWithFallback } from "./search";
import { buildResearchMetadata, collectSourceRecords, resolveSaveDir, writeResearchMetadata } from "./storage";

const log = createLogger("conversation:deep-research");

/**
 * 执行多步深度研究。
 *
 * 流程:
 * 1. 规划搜索策略(LLM 生成搜索查询列表)
 * 2. 逐步执行搜索并收集发现
 * 3. 综合所有发现生成最终报告
 * 4. 保存报告到 .crab/deepresearch/
 *
 * @returns 报告文件路径
 */
export async function executeDeepResearch(
  topic: string,
  config: AppConfigSchema,
  onProgress?: ResearchProgressCallback,
  abortSignal?: AbortSignal,
  researchConfig?: Partial<ResearchConfig>,
): Promise<{ reportPath: string; summary: string; metadataPath?: string }> {
  const rConfig = { ...DEFAULT_RESEARCH_CONFIG, ...researchConfig };
  const steps: ResearchStep[] = [];
  let searchesUsed = 0;
  let fetchesUsed = 0;

  const budget = () => ({
    fetchesBudget: rConfig.maxFetches,
    fetchesUsed,
    searchesBudget: rConfig.maxSearches,
    searchesUsed,
  });

  const emit = (step: Parameters<ResearchProgressCallback>[0]) => {
    onProgress?.(step);
    globalBus.publish(AppEvent.DeepResearchProgress, {
      action: step.action,
      budget: step.budget ?? budget(),
      message: step.message,
      round: step.round,
      topic,
      totalRounds: step.totalRounds,
    });
  };

  emit({ action: "planning", message: "规划搜索策略...", round: 0, totalRounds: rConfig.maxSearchRounds });

  // Step 1: 规划搜索策略
  const planMessages: ModelMessage[] = [
    {
      content: `I need to research the following topic thoroughly. Generate a list of ${rConfig.maxSearchRounds} specific search queries I should use to gather comprehensive information.\n\nTopic: ${topic}\n\nOutput ONLY a JSON array of search query strings, nothing else. Example:\n["query 1", "query 2", "query 3"]`,
      role: "user",
    } as UserModelMessage,
  ];

  let searchQueries: string[] = [];
  try {
    const queries = await collectLlmResponse(config, planMessages, rConfig.maxTokensPerStep, abortSignal);
    const jsonMatch = queries.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string")) {
        searchQueries = parsed;
      }
    }
  } catch {
    searchQueries = [topic, `${topic} overview`, `${topic} analysis`, `${topic} latest`, `${topic} best practices`];
  }

  if (searchQueries.length === 0) {
    searchQueries = [topic];
  }

  searchQueries = searchQueries.slice(0, rConfig.maxSearchRounds);

  // Step 2: 分批并行搜索 + 迭代优化
  const BATCH_SIZE = 3;
  let completedRounds = 0;
  let isFollowUpPhase = false;

  while (searchQueries.length > 0 && completedRounds < rConfig.maxSearchRounds && searchesUsed < rConfig.maxSearches) {
    if (abortSignal?.aborted) {
      break;
    }

    const batch = searchQueries.splice(0, BATCH_SIZE);

    emit({
      action: "searching",
      message: `并行搜索 ${batch.map((q) => `"${q}"`).join(", ")}`,
      round: completedRounds + 1,
      totalRounds: rConfig.maxSearchRounds,
    });

    const batchResults = await Promise.all(
      batch.map(async (query) => {
        if (searchesUsed >= rConfig.maxSearches) {
          return {
            error: "budget_exhausted",
            findings: "搜索预算已用尽",
            query,
            sourceRecords: [] as ResearchSourceRecord[],
            sources: [] as string[],
          };
        }
        searchesUsed++;
        try {
          const searchResult = await searchWithFallback(
            query,
            topic,
            config,
            steps,
            rConfig.maxTokensPerStep,
            abortSignal,
            rConfig.searchExecutor,
          );

          if (rConfig.fetchExecutor && searchResult.sources.length > 0 && fetchesUsed < rConfig.maxFetches) {
            const urlsToFetch = searchResult.sources.slice(0, Math.min(3, rConfig.maxFetches - fetchesUsed));
            const fetchResults = await Promise.allSettled(
              urlsToFetch.map(async (url) => {
                fetchesUsed++;
                emit({
                  action: "fetching",
                  message: `抓取页面: ${url.substring(0, 60)}...`,
                  round: completedRounds + 1,
                  totalRounds: rConfig.maxSearchRounds,
                });
                const r = await rConfig.fetchExecutor!(url);
                return r.error ? null : r.content;
              }),
            );
            const fetchedContent = fetchResults
              .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && r.value !== null)
              .map((r) => r.value)
              .join("\n\n");
            if (fetchedContent) {
              searchResult.findings += `\n\n--- Fetched Content ---\n${fetchedContent.substring(0, 3000)}`;
            }
          }

          return { query, ...searchResult, error: undefined };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return {
            error: msg,
            findings: `搜索失败: ${msg}`,
            query,
            sourceRecords: [] as ResearchSourceRecord[],
            sources: [] as string[],
          };
        }
      }),
    );

    for (const r of batchResults) {
      steps.push({
        findings: r.findings,
        isFollowUp: isFollowUpPhase,
        query: r.query,
        sourceRecords: r.sourceRecords ?? [],
        sources: r.sources,
      });
      completedRounds++;
    }

    if (
      searchQueries.length === 0 &&
      completedRounds < rConfig.maxSearchRounds &&
      steps.length > 0 &&
      searchesUsed < rConfig.maxSearches
    ) {
      emit({
        action: "analyzing",
        message: "分析发现，规划后续搜索...",
        round: completedRounds,
        totalRounds: rConfig.maxSearchRounds,
      });

      try {
        const reviewMessages: ModelMessage[] = [
          {
            content: `I'm researching "${topic}". Here's what I've found so far:\n\n${steps
              .slice(-batchResults.length)
              .map(
                (s, i) =>
                  `Round ${steps.length - batchResults.length + i + 1} (${s.query}): ${s.findings.substring(0, 300)}`,
              )
              .join(
                "\n\n",
              )}\n\nBased on these findings, are there important gaps or areas that need deeper investigation? Output ONLY a JSON array of 1-2 additional search queries to fill these gaps. If the findings are already comprehensive, output an empty array [].`,
            role: "user",
          } as UserModelMessage,
        ];
        const reviewResponse = await collectLlmResponse(config, reviewMessages, 512, abortSignal);
        const followUpMatch = reviewResponse.match(/\[[\s\S]*\]/);
        if (followUpMatch) {
          const parsed: unknown = JSON.parse(followUpMatch[0]);
          if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === "string")) {
            const followUps = parsed;
            const remaining = rConfig.maxSearchRounds - completedRounds;
            if (followUps.length > 0 && remaining > 0) {
              searchQueries.push(...followUps.slice(0, remaining));
            }
          }
        }
      } catch {
        // 迭代优化失败不影响主流程
      }
      isFollowUpPhase = true;
    }
  }

  // Step 3: 生成综合报告
  if (abortSignal?.aborted) {
    emit({ action: "error", message: "研究已被中止", round: 0, totalRounds: 0 });
    throw createUserError("USER_CANCELLED", "研究已被中止");
  }

  const allSources = [...new Set(steps.flatMap((s) => s.sources))];
  const sourceRecords = collectSourceRecords(steps);
  const generatedAt = new Date().toISOString();
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
  const timestamp = generatedAt.replace(/[:.]/g, "-").substring(0, 19);
  const fileName = `${slug}-${timestamp}.md`;
  const saveDir = resolveSaveDir(rConfig.saveDir);
  if (!existsSync(saveDir)) {
    mkdirSync(saveDir, { recursive: true });
  }
  const reportPath = join(saveDir, fileName);
  const metadataPath = join(saveDir, `${fileName}.meta.json`);

  emit({ action: "writing", message: "生成研究报告...", round: steps.length, totalRounds: steps.length });

  const reportMessages: ModelMessage[] = [
    {
      content: `Based on the following research findings, write a comprehensive research report in Markdown format.\n\nTopic: ${topic}\n\nResearch Findings:\n${steps.map((s, i) => `## Round ${i + 1}${s.isFollowUp ? " (follow-up)" : ""}: ${s.query}\n${s.findings}`).join("\n\n")}\n\nSources collected:\n${allSources.length > 0 ? allSources.map((url, i) => `${i + 1}. ${url}`).join("\n") : "No specific URLs collected."}\n\nReport structure (STRICT — follow exactly):\n1. Executive Summary (1-2 paragraphs, concise)\n2. Key Findings Summary Table — MUST include a markdown table at the top:\n   | # | Finding | Confidence | Source(s) | Impact |\n   |---|---------|-----------|-----------|--------|\n   Fill confidence as High/Medium/Low based on source quality and corroboration.\n   If confidence is Low, note what additional research is needed.\n3. Background & Context\n4. Detailed Findings (with subsections for each major topic found)\n5. Analysis & Discussion (compare conflicting findings, identify patterns)\n6. Conclusions & Recommendations (actionable, prioritized)\n7. Methodology — describe the research approach:\n   - Search rounds completed: ${steps.length} (${steps.filter((s) => s.isFollowUp).length} iterative follow-ups)\n   - Total sources consulted: ${allSources.length}\n   - Searches used: ${searchesUsed} / ${rConfig.maxSearches}\n   - Page fetches used: ${fetchesUsed} / ${rConfig.maxFetches}\n8. References — cite ALL provided source URLs as numbered footnotes [1], [2], etc.\n\nFormat rules:\n- Start the response DIRECTLY with the Executive Summary heading, no preamble\n- The Key Findings Summary Table MUST appear immediately after the Executive Summary\n- Each finding in the table should be concise (1 line), with details in section 4\n- Number references [1], [2], etc. and link them to the Sources list\n- If sources are insufficient, explicitly state "${iconWarning} Needs further verification"`,
      role: "user",
    } as UserModelMessage,
  ];

  let report: string;
  try {
    report = await collectLlmResponse(config, reportMessages, 12_288, abortSignal);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const failedMetadata = buildResearchMetadata({
      budget: budget(),
      error: msg,
      generatedAt,
      metadataPath,
      reportPath,
      sources: sourceRecords,
      status: "failed",
      steps,
      summary: undefined,
      topic,
    });
    writeResearchMetadata(saveDir, failedMetadata);
    emit({ action: "error", message: `研究报告生成失败: ${msg}`, round: steps.length, totalRounds: steps.length });
    throw error;
  }

  const meta = [
    `> Generated: ${generatedAt}`,
    `> Search rounds: ${steps.length} (${steps.filter((s) => s.isFollowUp).length} iterative follow-ups)`,
    `> Searches used: ${searchesUsed} / ${rConfig.maxSearches}`,
    `> Page fetches: ${fetchesUsed} / ${rConfig.maxFetches}`,
    `> Sources: ${allSources.length}`,
  ].join("\n> ");

  const fullReport = `${report}\n\n---\n\n${meta}\n\n---\n\n*This report was generated by crab-cli Deep Research.*\n`;

  writeFileSync(reportPath, fullReport, "utf8");

  const summary = report.substring(0, 500);
  const metadata = buildResearchMetadata({
    budget: budget(),
    generatedAt,
    metadataPath,
    reportPath,
    sources: sourceRecords,
    status: "completed",
    steps,
    summary,
    topic,
  });
  writeResearchMetadata(saveDir, metadata);
  emit({ action: "done", message: `报告已保存: ${reportPath}`, round: steps.length, totalRounds: steps.length });

  return { metadataPath, reportPath, summary };
}

// ─── 工具定义 ──────────────────────────────────────────────

const DeepResearchParams = z.object({
  announceResult: z.boolean().optional().describe("是否在完成后将摘要发送给用户(默认 true)"),
  maxFetches: z.number().optional().describe("最大页面抓取次数(默认 20)"),
  maxSearchRounds: z.number().optional().describe("最大搜索轮数(默认 5)"),
  maxSearches: z.number().optional().describe("最大搜索次数(默认 35)"),
  topic: z.string().describe("研究主题或问题"),
});

/** Deep Research 深度研究工具 — 多轮自动搜索、信息收集和综合分析，生成 Markdown 研究报告 */
export const deepResearchTool = defineTool({
  description:
    "深度研究工具:对指定主题进行多轮自动搜索、信息收集和综合分析，生成结构化的 Markdown 研究报告。" +
    "支持迭代优化——LLM 审查已有发现后生成后续查询，填补信息缺口。" +
    "报告保存到 .crab/deepresearch/ 目录。",
  execute: async (params, _context) => {
    try {
      const config = await loadConfig();
      if (!config) {
        return { error: "深度研究需要有效的 AI 配置(AppConfigSchema)", success: false };
      }

      const report = await executeDeepResearch(params.topic, config, undefined, undefined, {
        maxFetches: params.maxFetches,
        maxSearchRounds: params.maxSearchRounds,
        maxSearches: params.maxSearches,
      });

      return {
        message: `研究报告已生成\n路径: ${report.reportPath}\n摘要: ${report.summary.substring(0, 200)}`,
        metadataPath: report.metadataPath,
        reportPath: report.reportPath,
        success: true,
        summary: report.summary,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`深度研究失败: ${params.topic}`, { error: msg });
      return { error: `深度研究失败: ${msg}`, success: false };
    }
  },
  name: "deep-research",
  parameters: DeepResearchParams,
  permission: "websearch",
  builtin: true,
});

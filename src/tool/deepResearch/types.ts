/**
 * Deep Research 类型、接口和常量定义。
 */
import type { AppConfigSchema } from "@/schema/config";

/** 研究步骤 */
export interface ResearchStep {
  query: string;
  findings: string;
  sources: string[];
  sourceRecords?: ResearchSourceRecord[];
  isFollowUp?: boolean;
}

/** 搜索结果(findings + sources 分离返回) */
export interface SearchResult {
  findings: string;
  sources: string[];
  sourceRecords: ResearchSourceRecord[];
}

/** 单条研究来源记录，包含 URL、标题和摘要 */
export interface ResearchSourceRecord {
  url: string;
  title?: string;
  snippet?: string;
  query?: string;
  round?: number;
}

/** 研究报告元数据，持久化到 .meta.json 供后续查询 */
export interface ResearchReportMetadata {
  version: 1;
  status: "completed" | "failed";
  topic: string;
  generatedAt: string;
  reportPath?: string;
  metadataPath: string;
  summary?: string;
  error?: string;
  budget: {
    searchesUsed: number;
    searchesBudget: number;
    fetchesUsed: number;
    fetchesBudget: number;
  };
  steps: (Omit<ResearchStep, "sourceRecords"> & { sourceRecords: ResearchSourceRecord[] })[];
  sources: ResearchSourceRecord[];
}

/** 研究配置 */
export interface ResearchConfig {
  maxSearchRounds: number; // 最大搜索轮数，默认 5
  maxSearches: number; // 最大搜索次数(跨所有轮次)，默认 35
  maxFetches: number; // 最大页面抓取次数，默认 20
  maxTokensPerStep: number; // 每步最大 token，默认 4096
  saveDir: string; // 保存目录，默认 .crab/deepresearch
  searchExecutor?: (args: { query: string; maxResults: number; searchDepth: "basic" | "advanced" }) => Promise<{
    content?: string;
    answer?: string;
    results?: { title?: string; url?: string; snippet?: string }[];
    error?: string;
  }>;
  /** 页面抓取执行器(可选，用于 maxFetches 预算控制) */
  fetchExecutor?: (url: string) => Promise<{ content: string; error?: string }>;
}

/** 研究配置默认值 */
export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  maxFetches: 20,
  maxSearchRounds: 5,
  maxSearches: 35,
  maxTokensPerStep: 4096,
  saveDir: ".crab/deepresearch",
};

/** 研究进度回调 */
export type ResearchProgressCallback = (step: {
  round: number;
  totalRounds: number;
  action: "planning" | "searching" | "fetching" | "analyzing" | "writing" | "done" | "error";
  message: string;
  /** 预算使用情况 */
  budget?: { searchesUsed: number; searchesBudget: number; fetchesUsed: number; fetchesBudget: number };
}) => void;

/**
 * 工具侧子代理契约 — 暴露给 Tool 层的子代理操作子集。
 *
 * 职责:
 *   - 将子代理解析、追踪、能力查询等能力以最小接口面暴露给 Tool 层
 *   - 通过依赖注入(DI)将 toolFacing 与 @agent/subagent 的具体实现解耦
 *   - 屏蔽 Agent 内部实现细节，避免 Tool 层直接耦合子代理系统
 *
 * 设计:
 *   - 工具层通过 setToolSubAgentResolver/Tracker/Reviewer 注入依赖
 *   - 默认实现由 toolFacingBootstrap.ts 启动时注入
 *   - 兼容 P2-8 重构:保持 DI 接口稳定
 *
 * 使用场景:
 *   - Tool 实现中需要查询或驱动子代理
 *   - 工具向运行中的子代理发送追加指令
 *   - 测试时通过注入 Mock 实现避免真实依赖
 */

import type { AppConfigSchema } from "@/schema/config";
import { InternalError } from "@/core/errors/appError";

// ─── DI 接口定义 ─────────────────────────────────────────────

/** 子代理解析结果 */
export interface ToolFacingSubAgentResolution {
  agentName: string;
  resolved: boolean;
  reason?: string;
}

/** 子代理状态 */
export interface ToolFacingSubAgentStatus {
  instanceId: string;
  agentName: string;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  startedAt?: number;
  messageCount?: number;
}

/** 代码库搜索结果项 */
export interface ToolFacingSearchResultItem {
  filePath: string;
  content: string;
  lineRange?: { start: number; end: number };
  score?: number;
  matchType?: string;
  originalIndex: number;
}

/** 代码库评审结果项 */
export interface ToolFacingReviewedResultItem {
  filePath: string;
  content: string;
  lineRange?: { start: number; end: number };
  score?: number;
  matchType?: string;
  originalIndex: number;
  relevanceScore: number;
  relevanceReason: string;
  isRecommended: boolean;
}

/** 代码库评审配置 */
export interface ToolFacingCodebaseReviewConfig {
  maxResults?: number;
  relevanceThreshold?: number;
  model?: string;
}

/** 代码库评审结果 */
export interface ToolFacingCodebaseReviewResult {
  success: boolean;
  results: ToolFacingReviewedResultItem[];
  originalCount: number;
  filteredCount: number;
  error?: string;
}

/** 子代理解析器接口 */
export interface SubAgentResolver {
  resolve(request: string): Promise<ToolFacingSubAgentResolution>;
}

/** 子代理追踪器接口 */
export interface SubAgentTracker {
  isRunning(instanceId: string): boolean;
  injectMessage(instanceId: string, message: string): boolean;
  listRunning(): ToolFacingSubAgentStatus[];
}

/** 代码库评审接口 */
export interface CodebaseReviewer {
  reviewSearchResults(
    config: AppConfigSchema,
    query: string,
    results: ToolFacingSearchResultItem[],
    configOverrides?: Partial<ToolFacingCodebaseReviewConfig>,
  ): Promise<ToolFacingCodebaseReviewResult>;
  rewriteCodebaseSearchQuery(
    config: AppConfigSchema,
    query: string,
    context?: { mode?: string; cwd?: string; include?: string },
  ): Promise<string>;
}

// ─── 注入容器 ────────────────────────────────────────────────

interface ToolFacingDeps {
  resolver?: SubAgentResolver;
  tracker?: SubAgentTracker;
  reviewer?: CodebaseReviewer;
}

let deps: ToolFacingDeps = {};

/** 注入子代理解析器实现 */
export function setToolSubAgentResolver(resolver: SubAgentResolver): void {
  deps.resolver = resolver;
}

/** 注入子代理追踪器实现 */
export function setToolSubAgentTracker(tracker: SubAgentTracker): void {
  deps.tracker = tracker;
}

/** 注入代码库评审实现 */
export function setToolSubAgentReviewer(reviewer: CodebaseReviewer): void {
  deps.reviewer = reviewer;
}

/** 重置依赖容器(测试用) */
export function resetToolFacingDeps(): void {
  deps = {};
}

function getResolver(): SubAgentResolver {
  if (!deps.resolver) {
    throw new InternalError("INTERNAL-902", "SubAgentResolver 未注入:调用 setToolSubAgentResolver() 初始化");
  }
  return deps.resolver;
}

function getTracker(): SubAgentTracker {
  if (!deps.tracker) {
    throw new InternalError("INTERNAL-902", "SubAgentTracker 未注入:调用 setToolSubAgentTracker() 初始化");
  }
  return deps.tracker;
}

function getReviewer(): CodebaseReviewer {
  if (!deps.reviewer) {
    throw new InternalError("INTERNAL-902", "CodebaseReviewer 未注入:调用 setToolSubAgentReviewer() 初始化");
  }
  return deps.reviewer;
}

// ─── 公共 API ────────────────────────────────────────────────

/** 解析子代理请求 */
export async function resolveToolSubAgent(request: string): Promise<ToolFacingSubAgentResolution> {
  return getResolver().resolve(request);
}

/** 判断子代理是否运行中 */
export function isToolSubAgentRunning(instanceId: string): boolean {
  return getTracker().isRunning(instanceId);
}

/** 向运行中子代理注入消息 */
export function injectToolSubAgentMessage(instanceId: string, message: string): boolean {
  return getTracker().injectMessage(instanceId, message);
}

/** 列出当前运行中的子代理 */
export function listToolSubAgents(): ToolFacingSubAgentStatus[] {
  return getTracker().listRunning();
}

/** 评审代码库搜索结果 */
export async function reviewToolCodebaseSearchResults(
  config: AppConfigSchema,
  query: string,
  results: ToolFacingSearchResultItem[],
  configOverrides?: Partial<ToolFacingCodebaseReviewConfig>,
): Promise<ToolFacingCodebaseReviewResult> {
  return getReviewer().reviewSearchResults(config, query, results, configOverrides);
}

/** 重写代码库搜索查询 */
export async function rewriteToolCodebaseSearchQuery(
  config: AppConfigSchema,
  query: string,
  context?: { mode?: string; cwd?: string; include?: string },
): Promise<string> {
  return getReviewer().rewriteCodebaseSearchQuery(config, query, context);
}

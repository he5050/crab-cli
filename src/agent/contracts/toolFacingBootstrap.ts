import {
  type CodebaseReviewer,
  type SubAgentResolver,
  type SubAgentTracker,
  type ToolFacingCodebaseReviewConfig,
  type ToolFacingCodebaseReviewResult,
  type ToolFacingReviewedResultItem,
  type ToolFacingSearchResultItem,
  type ToolFacingSubAgentResolution,
  type ToolFacingSubAgentStatus,
  setToolSubAgentResolver,
  setToolSubAgentReviewer,
  setToolSubAgentTracker,
} from "@/agent/contracts/toolFacing";
import { resolveSubAgent } from "@/agent/subagent/resolver";
import { subAgentTracker } from "@/agent/subagent/tracker";
import {
  type ReviewedResultItem,
  type SearchResultItem,
  reviewSearchResults as codebaseReviewSearchResults,
  rewriteCodebaseSearchQuery,
} from "@/agent/specialized/codebaseReview";
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool-facing:bootstrap");

const resolverAdapter: SubAgentResolver = {
  async resolve(request: string): Promise<ToolFacingSubAgentResolution> {
    try {
      const result = await resolveSubAgent(request);
      return {
        agentName: result.agentType,
        reason: result.reason,
        resolved: result.needsSubAgent,
      };
    } catch (error) {
      log.error("子代理解析失败", { error: String(error) });
      return {
        agentName: "none",
        reason: `解析异常: ${error instanceof Error ? error.message : String(error)}`,
        resolved: false,
      };
    }
  },
};

const trackerAdapter: SubAgentTracker = {
  injectMessage(instanceId: string, message: string): boolean {
    return subAgentTracker.injectMessage(instanceId, message);
  },

  isRunning(instanceId: string): boolean {
    return subAgentTracker.isRunning(instanceId);
  },

  listRunning(): ToolFacingSubAgentStatus[] {
    return subAgentTracker.listRunning().map((s) => ({
      agentName: s.agentName,
      instanceId: s.instanceId,
      messageCount: s.messageCount,
      startedAt: s.startedAt.getTime(),
      status: s.status,
    }));
  },
};

const reviewerAdapter: CodebaseReviewer = {
  async reviewSearchResults(
    config: AppConfigSchema,
    query: string,
    results: ToolFacingSearchResultItem[],
    configOverrides?: Partial<ToolFacingCodebaseReviewConfig>,
  ): Promise<ToolFacingCodebaseReviewResult> {
    const domainConfig = {
      includeSnippet: true,
      maxResults: configOverrides?.maxResults ?? 10,
      relevanceThreshold: configOverrides?.relevanceThreshold ?? 0.5,
      snippetMaxLength: 500,
    };

    const domainResults: SearchResultItem[] = results.map((r) => ({
      content: r.content,
      filePath: r.filePath,
      lineRange: r.lineRange,
      matchType: r.matchType as SearchResultItem["matchType"],
      score: r.score,
    }));

    const reviewResult = await codebaseReviewSearchResults(config, query, domainResults, domainConfig);

    return {
      error: reviewResult.error,
      filteredCount: reviewResult.filteredCount,
      originalCount: reviewResult.originalCount,
      results: reviewResult.results.map((r) => {
        const item = r as ReviewedResultItem & { originalIndex: number };
        return {
          content: item.content,
          filePath: item.filePath,
          isRecommended: item.isRecommended,
          lineRange: item.lineRange,
          matchType: item.matchType,
          originalIndex: item.originalIndex ?? 0,
          relevanceReason: item.relevanceReason,
          relevanceScore: item.relevanceScore,
          score: item.score,
        };
      }),
      success: reviewResult.success,
    };
  },

  async rewriteCodebaseSearchQuery(
    config: AppConfigSchema,
    query: string,
    context?: { mode?: string; cwd?: string; include?: string },
  ): Promise<string> {
    return rewriteCodebaseSearchQuery(config, query, context);
  },
};

export function bootstrapToolFacingDeps(): void {
  setToolSubAgentResolver(resolverAdapter);
  setToolSubAgentTracker(trackerAdapter);
  setToolSubAgentReviewer(reviewerAdapter);
  log.info("toolFacing 依赖已注入(resolver / tracker / reviewer)");
}

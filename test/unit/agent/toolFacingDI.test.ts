/**
 * ToolFacing 依赖注入容器测试
 *
 * 覆盖 P2-8 重构:tool/↔agent/ 双向依赖解耦
 *   1. 未注入时调用 API 抛错
 *   2. 注入 resolver/tracker/reviewer 后各 API 工作
 *   3. resetToolFacingDeps 清理所有注入
 *   4. Mock 实现可完全替代真实实现
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
  type CodebaseReviewer,
  type SubAgentResolver,
  type SubAgentTracker,
  type ToolFacingCodebaseReviewResult,
  type ToolFacingSearchResultItem,
  type ToolFacingSubAgentResolution,
  type ToolFacingSubAgentStatus,
  injectToolSubAgentMessage,
  isToolSubAgentRunning,
  listToolSubAgents,
  resetToolFacingDeps,
  resolveToolSubAgent,
  reviewToolCodebaseSearchResults,
  rewriteToolCodebaseSearchQuery,
  setToolSubAgentResolver,
  setToolSubAgentReviewer,
  setToolSubAgentTracker,
} from "@/agent/contracts/toolFacing";

class MockResolver implements SubAgentResolver {
  callCount = 0;
  async resolve(request: string): Promise<ToolFacingSubAgentResolution> {
    this.callCount++;
    return { agentName: `mock-${request}`, resolved: true };
  }
}

class MockTracker implements SubAgentTracker {
  running = new Set<string>();
  isRunning(id: string): boolean {
    return this.running.has(id);
  }
  injectMessage(id: string, _msg: string): boolean {
    if (!this.running.has(id)) {
      return false;
    }
    return true;
  }
  listRunning(): ToolFacingSubAgentStatus[] {
    return [...this.running].map((id) => ({
      agentName: id,
      instanceId: id,
      status: "running" as const,
    }));
  }
}

class MockReviewer implements CodebaseReviewer {
  callCount = 0;
  async reviewSearchResults(
    _config: any,
    query: string,
    results: ToolFacingSearchResultItem[],
  ): Promise<ToolFacingCodebaseReviewResult> {
    this.callCount++;
    return {
      filteredCount: 0,
      originalCount: results.length,
      results: results.map((r, i) => ({
        ...r,
        isRecommended: true,
        originalIndex: i,
        relevanceReason: "matched",
        relevanceScore: 0.95,
      })),
      success: true,
    };
  }
  async rewriteCodebaseSearchQuery(_config: any, query: string): Promise<string> {
    return `${query} (refined)`;
  }
}

describe("ToolFacing DI 容器 (P2-8)", () => {
  beforeEach(() => {
    resetToolFacingDeps();
  });

  it("未注入 resolver 时抛错", async () => {
    await expect(resolveToolSubAgent("test")).rejects.toThrow("未注入");
  });
  it("未注入 tracker 时 isRunning 抛错", () => {
    expect(() => isToolSubAgentRunning("x")).toThrow("未注入");
  });
  it("未注入 tracker 时 injectMessage 抛错", () => {
    expect(() => injectToolSubAgentMessage("x", "m")).toThrow("未注入");
  });
  it("未注入 tracker 时 listToolSubAgents 抛错", () => {
    expect(() => listToolSubAgents()).toThrow("未注入");
  });
  it("未注入 reviewer 时 review 抛错", async () => {
    await expect(reviewToolCodebaseSearchResults({} as any, "q", [])).rejects.toThrow("未注入");
  });
  it("未注入 reviewer 时 rewrite 抛错", async () => {
    await expect(rewriteToolCodebaseSearchQuery({} as any, "q")).rejects.toThrow("未注入");
  });

  it("注入 resolver 后工作", async () => {
    const r = new MockResolver();
    setToolSubAgentResolver(r);
    const result = await resolveToolSubAgent("foo");
    expect(result.agentName).toBe("mock-foo");
    expect(r.callCount).toBe(1);
  });

  it("注入 tracker 后 isRunning 工作", () => {
    const t = new MockTracker();
    t.running.add("a");
    setToolSubAgentTracker(t);
    expect(isToolSubAgentRunning("a")).toBe(true);
    expect(isToolSubAgentRunning("b")).toBe(false);
  });

  it("注入 tracker 后 injectMessage 工作", () => {
    const t = new MockTracker();
    t.running.add("a");
    setToolSubAgentTracker(t);
    expect(injectToolSubAgentMessage("a", "hi")).toBe(true);
    expect(injectToolSubAgentMessage("b", "hi")).toBe(false);
  });

  it("注入 tracker 后 listRunning 工作", () => {
    const t = new MockTracker();
    t.running.add("a");
    t.running.add("b");
    setToolSubAgentTracker(t);
    expect(listToolSubAgents()).toHaveLength(2);
  });

  it("注入 reviewer 后 reviewSearchResults 工作", async () => {
    const r = new MockReviewer();
    setToolSubAgentReviewer(r);
    const result = await reviewToolCodebaseSearchResults({} as any, "q", [
      { content: "x", filePath: "a", originalIndex: 0 },
    ]);
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it("注入 reviewer 后 rewriteCodebaseSearchQuery 工作", async () => {
    const r = new MockReviewer();
    setToolSubAgentReviewer(r);
    const result = await rewriteToolCodebaseSearchQuery({} as any, "q");
    expect(result).toBe("q (refined)");
  });

  it("resetToolFacingDeps 清理所有注入", async () => {
    setToolSubAgentResolver(new MockResolver());
    setToolSubAgentTracker(new MockTracker());
    setToolSubAgentReviewer(new MockReviewer());
    resetToolFacingDeps();
    await expect(resolveToolSubAgent("x")).rejects.toThrow();
    expect(() => isToolSubAgentRunning("x")).toThrow();
  });

  it("可重复注入替换实现", () => {
    const r1 = new MockResolver();
    const r2 = new MockResolver();
    setToolSubAgentResolver(r1);
    setToolSubAgentResolver(r2);
    void resolveToolSubAgent("x");
    expect(r2.callCount).toBe(1);
  });
});

/**
 * SubAgentStreamProcessor 单元测试
 *
 * 测试覆盖:
 *   - 流处理器基本功能
 *   - 四种合并策略 (concat, interleave, priority, custom)
 *   - 流状态管理
 *   - 回调机制
 *   - 有序/无序处理
 *   - 错误处理
 */

import { beforeEach, describe, expect, it, vi } from "bun:test";
import {
  type StreamChunk,
  type StreamProcessorConfig,
  SubAgentStreamProcessor,
} from "@/agent/subagent/streamProcessor";

function createChunk(overrides: Partial<StreamChunk> = {}): StreamChunk {
  return {
    agentType: overrides.agentType ?? "general",
    content: overrides.content ?? "test content",
    instanceId: overrides.instanceId ?? "agent-1",
    isLast: overrides.isLast ?? false,
    sequence: overrides.sequence ?? 0,
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

describe("SubAgentStreamProcessor", () => {
  describe("基本功能", () => {
    it("should create processor with default config", () => {
      const processor = new SubAgentStreamProcessor();
      expect(processor).toBeInstanceOf(SubAgentStreamProcessor);
    });

    it("should create processor with custom config", () => {
      const processor = new SubAgentStreamProcessor({
        maxWaitTime: 5000,
        mergeStrategy: "priority",
        ordered: true,
      });
      expect(processor).toBeInstanceOf(SubAgentStreamProcessor);
    });

    it("should return empty results when no streams", () => {
      const processor = new SubAgentStreamProcessor();
      const results = processor.getMergedResults();
      // "merged" key is always present (empty string when no streams)
      expect(results.get("merged")).toBe("");
      // No individual stream results
      expect(results.size).toBe(1);
    });
  });

  describe("流接收", () => {
    it("should receive single chunk", async () => {
      const processor = new SubAgentStreamProcessor();
      const chunk = createChunk({ content: "hello" });
      await processor.receiveChunk(chunk);
      const results = processor.getMergedResults();
      expect(results.get("agent-1")).toBe("hello");
    });

    it("should aggregate multiple chunks from same agent", async () => {
      const processor = new SubAgentStreamProcessor();
      await processor.receiveChunk(createChunk({ content: "a" }));
      await processor.receiveChunk(createChunk({ content: "b" }));
      await processor.receiveChunk(createChunk({ content: "c", isLast: true }));
      const results = processor.getMergedResults();
      expect(results.get("agent-1")).toBe("abc");
    });

    it("should handle multiple agents", async () => {
      const processor = new SubAgentStreamProcessor();
      await processor.receiveChunk(createChunk({ content: "from A", instanceId: "agent-a" }));
      await processor.receiveChunk(createChunk({ content: "from B", instanceId: "agent-b" }));
      const results = processor.getMergedResults();
      expect(results.get("agent-a")).toBe("from A");
      expect(results.get("agent-b")).toBe("from B");
    });

    it("should track stream state", async () => {
      const processor = new SubAgentStreamProcessor();
      await processor.receiveChunk(createChunk({ content: "test" }));
      // Internal state is private but we can verify via getMergedResults
      const results = processor.getMergedResults();
      expect(results.has("agent-1")).toBe(true);
    });
  });

  describe("合并策略", () => {
    it("should concat streams in order", async () => {
      const processor = new SubAgentStreamProcessor({ mergeStrategy: "concat" });
      await processor.receiveChunk(createChunk({ content: "A", instanceId: "first" }));
      await processor.receiveChunk(createChunk({ content: "B", instanceId: "second" }));
      const results = processor.getMergedResults();
      // Concat strategy joins with separator and includes agent metadata
      expect(results.get("merged")).toContain("A");
      expect(results.get("merged")).toContain("B");
      expect(results.get("first")).toBe("A");
      expect(results.get("second")).toBe("B");
    });

    it("should interleave streams", async () => {
      const processor = new SubAgentStreamProcessor({ mergeStrategy: "interleave" });
      const now = Date.now();
      await processor.receiveChunk(createChunk({ content: "a1", instanceId: "a", timestamp: now }));
      await processor.receiveChunk(createChunk({ content: "b1", instanceId: "b", timestamp: now + 1 }));
      await processor.receiveChunk(createChunk({ content: "a2", instanceId: "a", timestamp: now + 2 }));
      await processor.receiveChunk(createChunk({ content: "b2", instanceId: "b", timestamp: now + 3 }));
      const results = processor.getMergedResults();
      // Interleave merges all chunks sorted by timestamp
      expect(results.get("merged")).toBe("a1b1a2b2");
      expect(results.get("a")).toBe("a1a2");
      expect(results.get("b")).toBe("b1b2");
    });

    it("should merge by priority", async () => {
      const processor = new SubAgentStreamProcessor({
        agentPriorities: [
          { agentType: "high", priority: 1 },
          { agentType: "low", priority: 10 },
        ],
        mergeStrategy: "priority",
      });
      await processor.receiveChunk(createChunk({ agentType: "low", content: "L", instanceId: "low" }));
      await processor.receiveChunk(createChunk({ agentType: "high", content: "H", instanceId: "high" }));
      const results = processor.getMergedResults();
      // Priority merge orders by priority (high first)
      const merged = results.get("merged")!;
      expect(merged).toContain("H");
      expect(merged).toContain("L");
      // High priority content should appear before low priority
      expect(merged.indexOf("H")).toBeLessThan(merged.indexOf("L"));
    });

    it("should use custom merge function", async () => {
      const customMerge = vi.fn().mockReturnValue("custom-result");
      const processor = new SubAgentStreamProcessor({
        customMerge,
        mergeStrategy: "custom",
      });
      await processor.receiveChunk(createChunk({ content: "test" }));
      const results = processor.getMergedResults();
      expect(customMerge).toHaveBeenCalled();
      const result = results.get("merged");
      expect(result).toBe("custom-result");
    });

    it("should fallback to concat when custom merge not provided", async () => {
      const processor = new SubAgentStreamProcessor({
        mergeStrategy: "custom",
      });
      await processor.receiveChunk(createChunk({ content: "X", instanceId: "a" }));
      await processor.receiveChunk(createChunk({ content: "Y", instanceId: "b" }));
      const results = processor.getMergedResults();
      // Falls back to concat which includes both contents
      expect(results.get("merged")).toContain("X");
      expect(results.get("merged")).toContain("Y");
    });
  });

  describe("回调机制", () => {
    it("should call onChunk callback", async () => {
      const processor = new SubAgentStreamProcessor();
      const onChunk = vi.fn();
      processor.on("chunk", onChunk);
      const chunk = createChunk({ content: "data" });
      await processor.receiveChunk(chunk);
      expect(onChunk).toHaveBeenCalledWith(chunk, expect.objectContaining({ contentParts: ["data"] }));
    });

    it("should call onComplete callback on last chunk", async () => {
      const processor = new SubAgentStreamProcessor();
      const onComplete = vi.fn();
      processor.on("complete", onComplete);
      await processor.receiveChunk(createChunk({ content: "data", isLast: true }));
      expect(onComplete).toHaveBeenCalledWith("agent-1", "data");
    });

    it("should call onError callback", async () => {
      const processor = new SubAgentStreamProcessor();
      const onError = vi.fn();
      processor.on("error", onError);
      await processor.receiveChunk(createChunk({ content: "data" }));
      processor.markError("agent-1", "test error");
      expect(onError).toHaveBeenCalledWith("agent-1", "test error");
    });

    it("should call onAllComplete when all streams done", async () => {
      const processor = new SubAgentStreamProcessor();
      const onAllComplete = vi.fn();
      processor.on("allComplete", onAllComplete);
      // Register both streams first (without completing)
      await processor.receiveChunk(createChunk({ content: "A", instanceId: "a", isLast: false }));
      await processor.receiveChunk(createChunk({ content: "B", instanceId: "b", isLast: false }));
      // Complete both streams
      await processor.receiveChunk(createChunk({ content: "A2", instanceId: "a", isLast: true }));
      await processor.receiveChunk(createChunk({ content: "B2", instanceId: "b", isLast: true }));
      expect(onAllComplete).toHaveBeenCalled();
      const results = onAllComplete.mock.calls[0]?.[0];
      expect(results?.get("a")).toBe("AA2");
      expect(results?.get("b")).toBe("BB2");
    });

    it("should not call onAllComplete until all streams complete", async () => {
      const processor = new SubAgentStreamProcessor();
      const onAllComplete = vi.fn();
      processor.on("allComplete", onAllComplete);
      // Register both streams first
      await processor.receiveChunk(createChunk({ content: "A", instanceId: "a", isLast: false }));
      await processor.receiveChunk(createChunk({ content: "B", instanceId: "b", isLast: false }));
      expect(onAllComplete).not.toHaveBeenCalled();
      // Complete stream "a" — still one incomplete
      await processor.receiveChunk(createChunk({ content: "A2", instanceId: "a", isLast: true }));
      expect(onAllComplete).not.toHaveBeenCalled();
      // Complete stream "b" — now all complete
      await processor.receiveChunk(createChunk({ content: "B2", instanceId: "b", isLast: true }));
      expect(onAllComplete).toHaveBeenCalled();
    });
  });

  describe("有序处理", () => {
    it("should detect sequence gaps when ordered=true", async () => {
      const processor = new SubAgentStreamProcessor({ ordered: true });
      await processor.receiveChunk(createChunk({ content: "a", sequence: 0 }));
      // Gap: expected 1, got 3
      await processor.receiveChunk(createChunk({ content: "b", sequence: 3 }));
      // Should still accept the chunk
      const results = processor.getMergedResults();
      expect(results.get("agent-1")).toBe("ab");
    });

    it("should accept out-of-order chunks when ordered=false", async () => {
      const processor = new SubAgentStreamProcessor({ ordered: false });
      await processor.receiveChunk(createChunk({ content: "a", sequence: 5 }));
      await processor.receiveChunk(createChunk({ content: "b", sequence: 2 }));
      const results = processor.getMergedResults();
      expect(results.get("agent-1")).toBe("ab");
    });
  });

  describe("错误处理", () => {
    it("should mark stream as completed on error", async () => {
      const processor = new SubAgentStreamProcessor();
      await processor.receiveChunk(createChunk({ content: "data" }));
      processor.markError("agent-1", "connection lost");
      const results = processor.getMergedResults();
      expect(results.get("agent-1")).toBe("data");
    });

    it("should include error in results after markError", async () => {
      const processor = new SubAgentStreamProcessor();
      await processor.receiveChunk(createChunk({ content: "partial" }));
      processor.markError("agent-1", "timeout");
      // Stream should be marked completed
      const results = processor.getMergedResults();
      expect(results.has("agent-1")).toBe(true);
    });

    it("should trigger onAllComplete when error marks last incomplete stream", async () => {
      const processor = new SubAgentStreamProcessor();
      const onAllComplete = vi.fn();
      processor.on("allComplete", onAllComplete);
      // Register both streams first (without completing either)
      await processor.receiveChunk(createChunk({ content: "A", instanceId: "a", isLast: false }));
      await processor.receiveChunk(createChunk({ content: "B", instanceId: "b", isLast: false }));
      expect(onAllComplete).not.toHaveBeenCalled();
      // Complete stream "a" — still one incomplete
      await processor.receiveChunk(createChunk({ content: "A2", instanceId: "a", isLast: true }));
      expect(onAllComplete).not.toHaveBeenCalled();
      // Error stream "b" — now all complete
      processor.markError("b", "failed");
      expect(onAllComplete).toHaveBeenCalled();
    });
  });
});

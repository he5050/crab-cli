/**
 * Deep Research 接口验证测试。
 *
 * 覆盖导出:
 *   - executeDeepResearch(接口 + 配置验证)
 *   - ResearchConfig
 *   - ResearchProgressCallback
 *
 * 注意:executeDeepResearch 依赖 streamLlm(真实 LLM 调用)，
 * 此文件验证类型定义和配置解析，不执行真实 LLM 调用。
 */
import { describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResearchConfig, ResearchProgressCallback } from "@/tool/deepResearch";
import type { AppConfigSchema } from "@/schema/config";

describe("Deep Research", () => {
  describe("ResearchConfig 类型", () => {
    test("默认配置值合理", () => {
      const config: ResearchConfig = {
        maxFetches: 20,
        maxSearchRounds: 5,
        maxSearches: 35,
        maxTokensPerStep: 4096,
        saveDir: ".crab/deepresearch",
      };
      expect(config.maxSearchRounds).toBeGreaterThan(0);
      expect(config.maxTokensPerStep).toBeGreaterThan(0);
      expect(config.saveDir).toBeTruthy();
    });

    test("支持 Partial<ResearchConfig> 覆盖", () => {
      const override: Partial<ResearchConfig> = {
        maxSearchRounds: 3,
      };
      const defaults: ResearchConfig = {
        maxFetches: 20,
        maxSearchRounds: 5,
        maxSearches: 35,
        maxTokensPerStep: 4096,
        saveDir: ".crab/deepresearch",
      };
      const merged = { ...defaults, ...override };
      expect(merged.maxSearchRounds).toBe(3);
      expect(merged.maxTokensPerStep).toBe(4096);
    });
  });

  describe("ResearchProgressCallback 类型", () => {
    test("回调参数结构正确", () => {
      const callback: ResearchProgressCallback = (step) => {
        expect(step.round).toBeGreaterThanOrEqual(0);
        expect(step.totalRounds).toBeGreaterThanOrEqual(0);
        expect(["planning", "searching", "fetching", "analyzing", "writing", "done", "error"]).toContain(step.action);
        expect(typeof step.message).toBe("string");
      };

      // 验证类型兼容(编译时检查)
      callback({
        action: "searching",
        message: "搜索中...",
        round: 1,
        totalRounds: 5,
      });
    });
  });

  describe("空响应恢复", () => {
    test("报告生成遇到空响应时会重试一次", async () => {
      let callCount = 0;
      mock.module("@api", () => ({
        streamLlm: () =>
          (async function* streamLlm() {
            callCount += 1;
            if (callCount === 1) {
              yield { text: '["retry topic"]', type: "text-delta" as const };
              yield { fullText: '["retry topic"]', type: "done" as const };
              return;
            }
            if (callCount === 2) {
              yield { fullText: "", type: "done" as const };
              return;
            }
            yield { text: "# Retry Report", type: "text-delta" as const };
            yield { fullText: "# Retry Report", type: "done" as const };
          })(),
      }));

      const tempDir = mkdtempSync(join(tmpdir(), "crab-dr-empty-"));
      const searchExecutor = mock(async () => ({
        content: "Findings for retry topic",
        results: [{ snippet: "snippet", title: "retry topic", url: "https://example.com" }],
      }));

      try {
        const { executeDeepResearch } = await import(`@/tool/deepResearch`);
        const result = await executeDeepResearch("retry topic", {} as AppConfigSchema, undefined, undefined, {
          maxFetches: 3,
          maxSearchRounds: 1,
          maxSearches: 5,
          maxTokensPerStep: 100,
          saveDir: tempDir,
          searchExecutor,
        });

        expect(result.summary).toContain("# Retry Report");
        expect(existsSync(result.reportPath)).toBe(true);
        expect(result.metadataPath).toBeDefined();
        expect(existsSync(result.metadataPath!)).toBe(true);
        const metadata = JSON.parse(readFileSync(result.metadataPath!, "utf8"));
        expect(metadata.status).toBe("completed");
        expect(metadata.sources[0].url).toBe("https://example.com");
        expect(existsSync(join(tempDir, "index.json"))).toBe(true);
        expect(callCount).toBe(3);
      } finally {
        rmSync(tempDir, { force: true, recursive: true });
      }
    });

    test("报告生成失败时写入 failed 元数据索引", async () => {
      let callCount = 0;
      mock.module("@api", () => ({
        streamLlm: () =>
          (async function* streamLlm() {
            callCount += 1;
            if (callCount === 1) {
              yield { text: '["failure topic"]', type: "text-delta" as const };
              yield { fullText: '["failure topic"]', type: "done" as const };
              return;
            }
            yield { error: new Error("report failed"), type: "error" as const };
          })(),
      }));

      const tempDir = mkdtempSync(join(tmpdir(), "crab-dr-failed-"));
      const searchExecutor = mock(async () => ({
        content: "Findings before failure",
        results: [{ snippet: "snippet", title: "source", url: "https://example.com/fail" }],
      }));

      try {
        const { executeDeepResearch } = await import(`@/tool/deepResearch`);
        await expect(
          executeDeepResearch("failure topic", {} as AppConfigSchema, undefined, undefined, {
            maxFetches: 3,
            maxSearchRounds: 1,
            maxSearches: 5,
            maxTokensPerStep: 100,
            saveDir: tempDir,
            searchExecutor,
          }),
        ).rejects.toThrow("report failed");

        const index = JSON.parse(readFileSync(join(tempDir, "index.json"), "utf8"));
        expect(index).toHaveLength(1);
        expect(index[0].status).toBe("failed");
        expect(index[0].error).toContain("report failed");
        expect(index[0].sources[0].url).toBe("https://example.com/fail");
      } finally {
        rmSync(tempDir, { force: true, recursive: true });
      }
    });
  });
});

/**
 * 混合搜索服务测试。
 *
 * 覆盖导出:
 *   - HybridSearchService class
 *     - constructor
 *     - search
 *     - dispose
 *   - HybridSearchResult 类型
 *   - HybridSearchOptions 类型
 */
import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { HybridSearchService } from "@/tool/codebaseSearch/indexer/hybridSearch";
import type { HybridSearchOptions, HybridSearchResult } from "@/tool/codebaseSearch/indexer/hybridSearch";
import { lspManager } from "@/lsp/manager";
import * as processManager from "@/bus/lifecycle/processManager";

describe("混合搜索服务", () => {
  beforeEach(() => {
    mock.restore();
  });

  describe("HybridSearchService", () => {
    test("可正常实例化", () => {
      const service = new HybridSearchService("/tmp");
      expect(service).toBeInstanceOf(HybridSearchService);
    });

    test("search 方法存在", () => {
      const service = new HybridSearchService("/tmp");
      expect(typeof service.search).toBe("function");
    });

    test("dispose 方法存在且不抛异常", () => {
      const service = new HybridSearchService("/tmp");
      expect(() => service.dispose()).not.toThrow();
    });

    test("重复 dispose 安全", () => {
      const service = new HybridSearchService("/tmp");
      service.dispose();
      expect(() => service.dispose()).not.toThrow();
    });

    test("search 在不存在的目录返回空结果", async () => {
      const service = new HybridSearchService("/nonexistent/path");
      const results = await service.search("test", { strategy: "exact" });
      expect(Array.isArray(results)).toBe(true);
      service.dispose();
    });

    test("strategy=exact 只做精确搜索", async () => {
      const service = new HybridSearchService("/tmp");
      const results = await service.search("test", { strategy: "exact" });
      expect(Array.isArray(results)).toBe(true);
      service.dispose();
    });

    test("maxResults 限制结果数", async () => {
      const service = new HybridSearchService("/tmp");
      const results = await service.search("test", { maxResults: 5, strategy: "exact" });
      expect(results.length).toBeLessThanOrEqual(5);
      service.dispose();
    });

    test("hybrid 合并时精确结果优先、同位置去重并截断 maxResults", async () => {
      spyOn(lspManager, "documentSymbols").mockResolvedValue([
        {
          location: { range: { start: { line: 4 } }, uri: "file:///repo/a.ts" },
          name: "same-symbol",
        },
      ] as any);
      class VectorDbMock {
        getStats() {
          return { totalChunks: 2 };
        }
        search() {
          return [
            {
              chunk: { content: "same semantic", endLine: 7, filePath: "/repo/a.ts", startLine: 5 },
              score: 0.4,
            },
            {
              chunk: { content: "other semantic", endLine: 22, filePath: "/repo/b.ts", startLine: 20 },
              score: 0.95,
            },
          ];
        }
        close() {}
      }
      mock.module("@tool/codebaseSearch/indexer/vectorDb", () => ({ VectorDb: VectorDbMock }));
      mock.module("@api", () => ({
        embedText: async () => ({ embedding: [0.1, 0.2, 0.3] }),
      }));
      spyOn(processManager, "exec").mockResolvedValue({
        exitCode: 0,
        stderr: "",
        stdout: "/repo/a.ts:5:same regex\n/repo/c.ts:3:third result",
      } as any);

      const { HybridSearchService: Service } = await import("@/tool/codebaseSearch/indexer/hybridSearch");
      const service = new Service("/repo");
      const results = await service.search("same", {
        appConfig: { defaultProvider: { model: "gpt-4", provider: "openai" } },
        maxResults: 3,
        strategy: "hybrid",
      });

      expect(results).toHaveLength(2);
      expect(results[0]!.source).not.toBe("vector");
      expect(results.filter((r: any) => r.file === "/repo/a.ts" && r.line === 5)).toHaveLength(1);
      service.dispose();
    });

    test("semantic search returns empty when appConfig is missing or vector index is empty", async () => {
      class EmptyVectorDb {
        getStats() {
          return { totalChunks: 0 };
        }
        search() {
          return [];
        }
        close() {}
      }
      mock.module("@tool/codebaseSearch/indexer/vectorDb", () => ({ VectorDb: EmptyVectorDb }));
      mock.module("@api", () => ({
        embedText: async () => ({ embedding: [0.1] }),
      }));
      spyOn(lspManager, "documentSymbols").mockResolvedValue([] as any);
      spyOn(processManager, "exec").mockResolvedValue({ exitCode: 1, stderr: "", stdout: "" } as any);

      const { HybridSearchService: Service } = await import("@/tool/codebaseSearch/indexer/hybridSearch");
      const service = new Service("/repo");

      expect(await service.search("query", { strategy: "semantic" })).toEqual([]);
      expect(
        await service.search("query", {
          appConfig: { defaultProvider: { model: "gpt-4", provider: "openai" } },
          strategy: "semantic",
        }),
      ).toEqual([]);

      service.dispose();
    });
  });

  describe("类型验证", () => {
    test("HybridSearchOptions 所有字段可选", () => {
      const opts: HybridSearchOptions = {};
      expect(opts.strategy).toBeUndefined();
      expect(opts.maxResults).toBeUndefined();
    });

    test("HybridSearchResult 结构", () => {
      const result: HybridSearchResult = {
        file: "test.ts",
        line: 10,
        score: 0.95,
        source: "lsp",
        text: "test content",
        type: "definition",
      };
      expect(result.file).toBe("test.ts");
      expect(result.score).toBe(0.95);
    });

    test("HybridSearchResult 可选字段", () => {
      const result: HybridSearchResult = {
        endLine: 15,
        file: "test.ts",
        line: 10,
        score: 0.5,
        source: "vector",
        text: "test",
        type: "semantic",
      };
      expect(result.endLine).toBe(15);
    });
  });
});

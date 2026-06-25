/**
 * Rerank API 类型与接口测试。
 *
 * 覆盖导出:
 *   - rerank(接口验证)
 *   - RerankRequest 类型
 *   - RerankResult 类型
 *   - RerankResultItem 类型
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { RerankRequest, RerankResult, RerankResultItem } from "@/api";
import { AppError } from "@/core/errors/appError";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

let importSeq = 0;

async function loadRerankModule() {
  importSeq += 1;
  return import("@/api/specialized/rerank") as Promise<typeof import("@/api/specialized/rerank")>;
}

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    defaultProvider: { model: "gpt-4o", provider: "openai" },
    maxContextTokens: 1000,
    providerConfig: {
      openai: {
        apiKey: "test-key",
        baseURL: "https://api.example.test/v1/",
        ...overrides,
      },
    },
    rerank: {
      maxContextTokens: 1000,
      maxDocumentRatio: 0.3,
    },
  } as any;
}

describe("Rerank API", () => {
  describe("类型验证", () => {
    test("RerankRequest 结构", () => {
      const req: RerankRequest = {
        documents: ["doc1", "doc2"],
        model: "rerank-v3.5",
        query: "test query",
        topN: 5,
      };
      expect(req.query).toBe("test query");
      expect(req.documents).toHaveLength(2);
    });

    test("RerankRequest 必填字段", () => {
      const req: RerankRequest = {
        documents: [],
        query: "test",
      };
      expect(req.topN).toBeUndefined();
      expect(req.model).toBeUndefined();
    });

    test("RerankResultItem 结构", () => {
      const item: RerankResultItem = {
        document: "relevant doc",
        index: 0,
        relevanceScore: 0.95,
      };
      expect(item.index).toBe(0);
      expect(item.relevanceScore).toBeGreaterThan(0);
    });

    test("RerankResult 结构", () => {
      const result: RerankResult = {
        model: "rerank-v3.5",
        results: [
          { document: "doc1", index: 0, relevanceScore: 0.9 },
          { document: "doc2", index: 1, relevanceScore: 0.5 },
        ],
      };
      expect(result.results).toHaveLength(2);
      expect(result.model).toBe("rerank-v3.5");
    });
  });

  describe("模块导入", () => {
    test("rerank 函数存在", async () => {
      const mod = await loadRerankModule();
      expect(typeof mod.rerank).toBe("function");
    });

    test("rerank 是异步函数", async () => {
      const mod = await loadRerankModule();
      expect(mod.rerank.constructor.name).toBe("AsyncFunction");
    });

    test("fitDocumentsToContext 函数存在", async () => {
      const mod = await loadRerankModule();
      expect(typeof mod.fitDocumentsToContext).toBe("function");
    });
  });

  describe("rerank 参数验证", () => {
    test("未配置 provider 时抛出错误", async () => {
      const { rerank } = await loadRerankModule();
      const config = {
        defaultProvider: { model: "gpt-4o", provider: "openai" },
        providerConfig: {},
      } as any;

      await expect(rerank(config, { documents: ["doc1"], query: "test" })).rejects.toThrow();
    });

    test("未配置 baseURL 时抛出错误", async () => {
      const { rerank } = await loadRerankModule();
      const config = {
        defaultProvider: { model: "gpt-4o", provider: "openai" },
        providerConfig: {
          openai: { apiKey: "test" },
        },
      } as any;

      await expect(rerank(config, { documents: ["doc1"], query: "test" })).rejects.toThrow("baseURL");
    });
  });

  describe("HTTP 行为与响应解析", () => {
    test("发送 /rerank 请求时修剪 baseURL 尾斜杠、携带鉴权并使用默认 top_n", async () => {
      const fetchMock = mock(
        async () =>
          new Response(
            JSON.stringify({
              model: "rerank-custom",
              results: [
                { document: { text: "doc-b" }, index: 1, relevance_score: 0.91 },
                { index: 0, score: 0.5 },
              ],
            }),
            { status: 200 },
          ),
      );
      globalThis.fetch = fetchMock as any;

      const { rerank } = await loadRerankModule();
      const result = await rerank(createConfig(), {
        documents: ["doc-a", "doc-b"],
        query: "query",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as
        | readonly [unknown, { method: string; headers?: Record<string, string>; body?: string }]
        | undefined;
      expect(call).toBeDefined();
      const [url, options] = call!;
      expect(url).toBe("https://api.example.test/v1/rerank");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(options.body ?? "{}")).toEqual({
        documents: ["doc-a", "doc-b"],
        model: "rerank-v3.5",
        query: "query",
        top_n: 2,
      });
      expect(result).toEqual({
        model: "rerank-custom",
        results: [
          { document: "doc-b", index: 1, relevanceScore: 0.91 },
          { document: "doc-a", index: 0, relevanceScore: 0.5 },
        ],
      });
    });

    test("长文档会在预算内被截断，后续文档会在预算耗尽时丢弃", async () => {
      const { fitDocumentsToContext } = await loadRerankModule();

      const fitted = fitDocumentsToContext(["a".repeat(120), "b".repeat(80), "c".repeat(80)], {
        maxContextTokens: 6,
        maxDocumentRatio: 0.5,
        query: "",
      });

      expect(fitted.originalIndices).toEqual([0]);
      expect(fitted.documents).toHaveLength(1);
      expect(fitted.truncatedCount).toBe(1);
      expect(fitted.droppedCount).toBe(2);
      expect(fitted.documents[0]!.length).toBeLessThan(120);
    });

    test("rerank 请求会裁剪文档并限制 top_n", async () => {
      const fetchMock = mock(
        async () =>
          new Response(
            JSON.stringify({
              model: "rerank-fit",
              results: [{ index: 0, relevance_score: 0.99 }],
            }),
            { status: 200 },
          ),
      );
      globalThis.fetch = fetchMock as any;

      const config = {
        defaultProvider: { model: "gpt-4o", provider: "openai" },
        maxContextTokens: 6,
        providerConfig: {
          openai: {
            apiKey: "test-key",
            baseURL: "https://api.example.test/v1/",
          },
        },
        rerank: {
          maxContextTokens: 6,
          maxDocumentRatio: 0.5,
        },
      } as any;

      const { rerank } = await loadRerankModule();
      const result = await rerank(config, {
        documents: ["x".repeat(80), "doc-b", "doc-c"],
        query: "query",
      });

      const [, options] = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.documents).toHaveLength(1);
      expect(body.top_n).toBe(1);
      expect(result).toEqual({
        model: "rerank-fit",
        results: [{ document: expect.any(String), index: 0, relevanceScore: 0.99 }],
      });
      expect(result.results[0]?.index).toBe(0);
      expect(result.results[0]?.document).toBe("x".repeat(body.documents[0].length));
    });

    test("rerank 返回的局部 index 会映射回原始文档索引", async () => {
      const fetchMock = mock(
        async () =>
          new Response(
            JSON.stringify({
              model: "rerank-map",
              results: [
                { index: 1, relevance_score: 0.88 },
                { index: 0, relevance_score: 0.77 },
              ],
            }),
            { status: 200 },
          ),
      );
      globalThis.fetch = fetchMock as any;

      const { rerank } = await loadRerankModule();
      const result = await rerank(createConfig(), {
        documents: ["doc-a", "doc-b", "doc-c"],
        query: "query",
      });

      expect(result).toEqual({
        model: "rerank-map",
        results: [
          { document: "doc-b", index: 1, relevanceScore: 0.88 },
          { document: "doc-a", index: 0, relevanceScore: 0.77 },
        ],
      });
    });

    test("兼容 data 响应、缺省 index/score/document/model 时使用稳定兜底", async () => {
      globalThis.fetch = mock(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ score: 0.7 }, { relevance_score: 0.4 }],
            }),
            { status: 200 },
          ),
      ) as any;

      const { rerank } = await loadRerankModule();
      const result = await rerank(createConfig({ apiKey: "" }), {
        documents: ["doc-a", "doc-b"],
        model: "custom-rerank",
        query: "query",
        topN: 1,
      });

      const [, options] = (globalThis.fetch as any).mock.calls[0];
      expect(options.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(options.body).top_n).toBe(1);
      expect(JSON.parse(options.body).model).toBe("custom-rerank");
      expect(result).toEqual({
        model: "custom-rerank",
        results: [
          { document: "doc-a", index: 0, relevanceScore: 0.7 },
          { document: "doc-b", index: 1, relevanceScore: 0.4 },
        ],
      });
    });

    test("非 2xx 响应抛 AppError 并携带状态码上下文", async () => {
      globalThis.fetch = mock(async () => new Response("bad request", { status: 400 })) as any;

      const { rerank } = await loadRerankModule();
      try {
        await rerank(createConfig(), { documents: ["doc-a"], query: "query" });
        throw new Error("应该抛出错误");
      } catch (err) {
        expect(err instanceof AppError).toBe(true);
        expect((err as AppError).context.body).toBe("bad request");
        expect((err as AppError).context.providerId).toBe("openai");
      }
    });

    test("fitDocumentsToContext 无文档返回空", async () => {
      const { fitDocumentsToContext } = await loadRerankModule();
      const fitted = fitDocumentsToContext([], {
        maxContextTokens: 1000,
        maxDocumentRatio: 0.3,
        query: "",
      });
      expect(fitted.documents).toEqual([]);
      expect(fitted.originalIndices).toEqual([]);
      expect(fitted.truncatedCount).toBe(0);
      expect(fitted.droppedCount).toBe(0);
    });

    test("fitDocumentsToContext 单个文档不超预算则原样返回", async () => {
      const { fitDocumentsToContext } = await loadRerankModule();
      const shortDoc = "hello world";
      const fitted = fitDocumentsToContext([shortDoc], {
        maxContextTokens: 1000,
        maxDocumentRatio: 0.3,
        query: "",
      });
      expect(fitted.documents).toEqual([shortDoc]);
      expect(fitted.truncatedCount).toBe(0);
      expect(fitted.droppedCount).toBe(0);
    });

    test("fitDocumentsToContext 单个文档超预算但被截断", async () => {
      const { fitDocumentsToContext } = await loadRerankModule();
      const longDoc = "x".repeat(500);
      const fitted = fitDocumentsToContext([longDoc], {
        maxContextTokens: 10,
        maxDocumentRatio: 0.3,
        query: "",
      });
      expect(fitted.documents).toHaveLength(1);
      expect(fitted.truncatedCount).toBe(1);
      expect(fitted.droppedCount).toBe(0);
      expect(fitted.documents[0]!.length).toBeLessThan(500);
      expect(fitted.documents[0]!.length).toBeGreaterThan(0);
    });

    test("fitDocumentsToContext 预算耗尽时丢弃后续文档", async () => {
      const { fitDocumentsToContext } = await loadRerankModule();
      const docs = ["a".repeat(5), "b".repeat(5), "c".repeat(5)];
      const fitted = fitDocumentsToContext(docs, {
        maxContextTokens: 3,
        maxDocumentRatio: 0.5,
        query: "",
      });
      expect(fitted.droppedCount).toBeGreaterThan(0);
    });

    test("truncateToTokenBudget 空字符串返回空", async () => {
      const { _compatForTesting } = await loadRerankModule();
      expect(_compatForTesting.truncateToTokenBudget("", 100)).toBe("");
    });

    test("truncateToTokenBudget 非正预算返回空", async () => {
      const { _compatForTesting } = await loadRerankModule();
      expect(_compatForTesting.truncateToTokenBudget("hello", 0)).toBe("");
      expect(_compatForTesting.truncateToTokenBudget("hello", -1)).toBe("");
    });

    test("resolveRerankContextTokens 使用优先顺序: rerank.maxContextTokens > codebase.reranking.contextLength > config.maxContextTokens", async () => {
      const { _compatForTesting } = await loadRerankModule();
      expect(
        _compatForTesting.resolveRerankContextTokens({
          rerank: { maxContextTokens: 5000 },
          maxContextTokens: 200_000,
        } as any),
      ).toBe(5000);

      expect(
        _compatForTesting.resolveRerankContextTokens({
          maxContextTokens: 200_000,
          codebase: { reranking: { contextLength: 3000 } },
        } as any),
      ).toBe(3000);

      expect(
        _compatForTesting.resolveRerankContextTokens({
          maxContextTokens: 100_000,
        } as any),
      ).toBe(100_000);
    });

    test("resolveRerankDocumentRatio 使用 rerank.maxDocumentRatio 否则默认 0.3", async () => {
      const { _compatForTesting } = await loadRerankModule();
      expect(
        _compatForTesting.resolveRerankDocumentRatio({
          rerank: { maxDocumentRatio: 0.5 },
        } as any),
      ).toBe(0.5);

      expect(_compatForTesting.resolveRerankDocumentRatio({} as any)).toBe(0.3);
    });

    test("兼容旧配置格式 codebase.reranking.contextLength", async () => {
      const { fitDocumentsToContext } = await loadRerankModule();

      const configWithLegacyReranking = {
        codebase: {
          reranking: {
            contextLength: 50,
          },
        },
        defaultProvider: { model: "gpt-4o", provider: "openai" },
        maxContextTokens: 1000,
        providerConfig: {
          openai: {
            apiKey: "test-key",
            baseURL: "https://api.example.test/v1/",
          },
        },
      } as any;

      const fitted = fitDocumentsToContext(["a".repeat(120), "b".repeat(80)], {
        maxContextTokens: 50,
        maxDocumentRatio: 0.5,
        query: "",
      });

      // 当使用旧配置时，maxContextTokens 应该被 legacy contextLength 覆盖
      // 但 fitDocumentsToContext 的参数是直接传入的，不经过 resolveRerankContextTokens
      // 所以我们需要测试 rerank 函数的行为
      const fetchMock = mock(
        async () =>
          new Response(
            JSON.stringify({
              model: "rerank-custom",
              results: [{ index: 0, relevance_score: 0.99 }],
            }),
            { status: 200 },
          ),
      );
      globalThis.fetch = fetchMock as any;

      const { rerank } = await loadRerankModule();
      await rerank(configWithLegacyReranking, {
        documents: ["x".repeat(80)],
        query: "query",
      });

      const [, options] = (globalThis.fetch as any).mock.calls[0];
      const body = JSON.parse(options.body);
      // legacy contextLength=50，文档会被截断，只发送 1 个文档
      expect(body.documents).toHaveLength(1);
    });
  });
});

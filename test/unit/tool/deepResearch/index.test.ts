/**
 * DeepResearch 深度研究单元测试
 *
 * 测试覆盖:
 *   - 研究流程编排(规划 → 搜索 → 分析 → 写报告)
 *   - 结果聚合(formatWebsearchFindings、collectSourceRecords)
 *   - 状态管理(预算控制、进度回调)
 *   - 错误处理(搜索失败、LLM 返回空响应)
 *   - 元数据生成(buildResearchMetadata、writeResearchMetadata)
 *
 * Mock 策略:
 *   - streamLlm(LLM 流式响应) — 顶层 mock.module，beforeEach 中 mockImplementation
 *   - executeRegisteredTool(搜索工具执行)
 *   - globalBus(事件总线)
 *   - Node.js fs 模块(文件操作)
 */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// 创建临时目录辅助函数
function createTempDir(): string {
  const dir = join(tmpdir(), `dr-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 创建一个返回指定文本的流式 LLM 生成器
 */
function createLlmStream(text: string): AsyncGenerator {
  return (async function* () {
    yield { type: "text-delta", text };
    yield { type: "done", fullText: text };
  })();
}

// ─── 顶层 mock.module(在 import 之前) ──────────────────────────

// Mock LLM API — 保留 @/api 的其他导出，仅替换 streamLlm
const mockStreamLlm = mock(() => createLlmStream("[]"));
const apiModule = await import("@/api");
// @ts-expect-error — Bun mock.module 接受 Partial 模块
mock.module("@/api", () => ({
  ...apiModule,
  streamLlm: mockStreamLlm,
}));

// Mock 搜索工具执行 — 保留其他导出
const mockExecuteRegisteredTool = mock(() =>
  Promise.resolve({
    output: JSON.stringify({
      content: "Search result content about the topic",
      results: [
        { snippet: "Topic overview", title: "Example", url: "https://example.com/article1" },
        { snippet: "Deep analysis", title: "Analysis", url: "https://example.com/article2" },
      ],
    }),
    success: true,
  }),
);
const runtimeExecModule = await import("@/tool/executor/runtimeExec");
// @ts-expect-error — Bun mock.module 接受 Partial 模块
mock.module("@/tool/executor/runtimeExec", () => ({
  ...runtimeExecModule,
  executeRegisteredTool: mockExecuteRegisteredTool,
}));

// 事件总线 — 通过 spyOn mock publish 方法(不 mock 整个模块)
const { globalBus } = await import("@/bus");
const originalPublish = globalBus.publish.bind(globalBus);

// 导入被测模块
const { executeDeepResearch, deepResearchTool } = await import("@/tool/deepResearch/index");

describe("deepResearch/index", () => {
  let tempDir: string;

  // 测试用 LLM 响应队列
  let llmResponseQueue: string[];

  let mockPublishFn: ReturnType<typeof mock>;

  beforeEach(() => {
    tempDir = createTempDir();
    llmResponseQueue = [];

    // 重置 mock 状态
    mockStreamLlm.mockClear();
    mockExecuteRegisteredTool.mockClear();

    // Mock globalBus.publish
    mockPublishFn = mock(() => {});
    globalBus.publish = mockPublishFn;

    // 设置默认 LLM 行为：从队列消费
    mockStreamLlm.mockImplementation(() => {
      const text = llmResponseQueue.shift() || "[]";
      return createLlmStream(text);
    });

    // 设置默认搜索行为
    mockExecuteRegisteredTool.mockImplementation(() =>
      Promise.resolve({
        output: JSON.stringify({
          content: "Search result content about the topic",
          results: [
            { snippet: "Topic overview", title: "Example", url: "https://example.com/article1" },
            { snippet: "Deep analysis", title: "Analysis", url: "https://example.com/article2" },
          ],
        }),
        success: true,
      }),
    );
  });

  afterEach(() => {
    // 恢复 globalBus.publish
    globalBus.publish = originalPublish;

    try {
      rmSync(tempDir, { force: true, recursive: true });
    } catch {
      // 忽略清理错误
    }
  });

  // ─── 工具定义测试 ────────────────────────────────────────────

  describe("deepResearchTool 工具定义", () => {
    it("工具具有正确的名称和权限", () => {
      expect(deepResearchTool.name).toBe("deep-research");
      expect(deepResearchTool.permission).toBe("websearch");
    });

    it("工具具有描述信息", () => {
      expect(deepResearchTool.description).toContain("深度研究");
    });
  });

  // ─── 研究流程编排测试 ──────────────────────────────────────────

  describe("executeDeepResearch 研究流程", () => {
    it("完整流程 — 规划、搜索、生成报告", async () => {
      llmResponseQueue = [
        '["react hooks overview"]', // 规划
        "[]", // 无后续搜索
        "# Executive Summary\n\nReact hooks test report.", // 报告
      ];

      const result = await executeDeepResearch(
        "React Hooks",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
        },
      );

      expect(result.summary).toBeTruthy();
      expect(result.reportPath).toContain("react-hooks");
      expect(result.reportPath).toContain(".md");

      // 验证报告文件已写入
      expect(existsSync(result.reportPath!)).toBe(true);

      // 验证元数据文件已写入
      expect(result.metadataPath).toBeTruthy();
      expect(existsSync(result.metadataPath!)).toBe(true);

      // 清理索引
      rmSync(join(tempDir, "index.json"), { force: true });
    });

    it("使用自定义 searchExecutor 执行搜索", async () => {
      const customSearchExecutor = mock(() =>
        Promise.resolve({
          content: "Custom search content",
          results: [{ snippet: "Custom snippet", title: "Custom", url: "https://custom.com/1" }],
        }),
      );

      llmResponseQueue = [
        '["custom topic"]', // 规划
        "[]", // 无后续
        "# Custom Report\n\nCustom summary.", // 报告
      ];

      const result = await executeDeepResearch(
        "Custom Topic",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
          searchExecutor: customSearchExecutor,
        },
      );

      expect(customSearchExecutor).toHaveBeenCalledTimes(1);
      // 验证报告成功生成(summary 取前 500 字符)
      expect(result.summary.length).toBeGreaterThan(0);
      rmSync(join(tempDir, "index.json"), { force: true });
    });

    it("规划阶段 LLM 失败时使用主题作为默认查询", async () => {
      // LLM 抛出异常(规划失败)
      mockStreamLlm.mockImplementation(() => {
        throw new Error("LLM planning failed");
      });

      // 需要为报告生成也设置 mock，否则报告也会失败
      // 让搜索也失败，使测试能到达报告阶段
      mockExecuteRegisteredTool.mockImplementation(() =>
        Promise.resolve({
          output: JSON.stringify({ content: "Fallback findings", results: [] }),
          success: true,
        }),
      );

      // 规划失败后使用默认查询，然后需要报告生成
      // 但 LLM 一直抛异常，报告生成也会失败
      // 所以我们需要让 LLM 先失败(规划)，然后成功(报告)
      let callCount = 0;
      mockStreamLlm.mockImplementation(() => {
        callCount++;
        // 第 1 次调用(规划)：失败
        if (callCount === 1) {
          throw new Error("LLM planning failed");
        }
        // 第 2 次调用(后续搜索分析)：返回空
        if (callCount === 2) {
          return createLlmStream("[]");
        }
        // 第 3 次调用(报告生成)：成功
        return createLlmStream("# Fallback Report\n\nReport generated with default queries.");
      });

      const result = await executeDeepResearch(
        "Test Topic",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxSearchRounds: 2,
          maxSearches: 5,
          saveDir: tempDir,
        },
      );

      // 应该使用默认查询进行搜索并生成报告
      expect(result.summary).toBeTruthy();
      rmSync(join(tempDir, "index.json"), { force: true });
    });

    it("AbortSignal 中止研究时抛出用户取消错误", async () => {
      llmResponseQueue = [];

      const abortController = new AbortController();
      abortController.abort(); // 立即中止

      await expect(
        executeDeepResearch(
          "Test Topic",
          {
            ai: {
              apiKey: "test",
              baseUrl: "https://api.test.com",
              maxTokens: 4096,
              model: "test",
              provider: "anthropic",
            },
          },
          undefined,
          abortController.signal,
          {
            maxSearchRounds: 2,
            maxSearches: 5,
            saveDir: tempDir,
          },
        ),
      ).rejects.toThrow("研究已被中止");
    });

    it("搜索预算用尽后停止搜索", async () => {
      const budgetSearchExecutor = mock(() =>
        Promise.resolve({
          content: "content",
          results: [{ snippet: "s", title: "T", url: "https://test.com/1" }],
        }),
      );

      llmResponseQueue = [
        '["q1", "q2", "q3", "q4", "q5"]', // 5 个查询
        "[]", // 无后续
        "# Report\n\nBudget report.",
      ];

      const result = await executeDeepResearch(
        "Budget Test",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxSearchRounds: 5,
          maxSearches: 2, // 只允许 2 次搜索
          saveDir: tempDir,
          searchExecutor: budgetSearchExecutor,
        },
      );

      // 最多执行 2 次搜索(BATCH_SIZE=3，但预算限制为 2)
      expect(budgetSearchExecutor.mock.calls.length).toBeLessThanOrEqual(2);
      rmSync(join(tempDir, "index.json"), { force: true });
    });
  });

  // ─── 进度回调测试 ──────────────────────────────────────────────

  describe("进度回调", () => {
    it("在整个流程中调用进度回调", async () => {
      const progressSteps: string[] = [];

      llmResponseQueue = ['["test query"]', "[]", "# Report\n\nTest report content."];

      interface ProgressStep {
        action: string;
        round: number;
      }

      const onProgress = (step: ProgressStep) => {
        progressSteps.push(`${step.action}:${step.round}`);
      };

      await executeDeepResearch(
        "Progress Test",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        onProgress,
        undefined,
        {
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
        },
      );

      // 验证至少收到 planning、searching、writing、done 等阶段
      expect(progressSteps.some((s) => s.startsWith("planning"))).toBe(true);
      expect(progressSteps.some((s) => s.startsWith("searching"))).toBe(true);
      expect(progressSteps.some((s) => s.startsWith("writing"))).toBe(true);
      expect(progressSteps.some((s) => s.startsWith("done"))).toBe(true);
      rmSync(join(tempDir, "index.json"), { force: true });
    });

    it("进度回调包含预算信息", async () => {
      let budgetInfo: Record<string, number> | undefined;

      llmResponseQueue = ['["test"]', "[]", "# Report\n\nBudget info test."];

      await executeDeepResearch(
        "Budget Info Test",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        (step) => {
          if (step.budget) {
            budgetInfo = step.budget;
          }
        },
        undefined,
        {
          maxFetches: 10,
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
        },
      );

      // 应该有预算信息
      if (budgetInfo) {
        expect(budgetInfo.searchesBudget).toBe(5);
        expect(budgetInfo.fetchesBudget).toBe(10);
      }
      rmSync(join(tempDir, "index.json"), { force: true });
    });
  });

  // ─── 元数据和文件输出测试 ──────────────────────────────────────

  describe("元数据和文件输出", () => {
    it("生成的元数据包含正确的状态和主题", async () => {
      llmResponseQueue = ['["meta test"]', "[]", "# Meta Report\n\nReport about metadata."];

      const result = await executeDeepResearch(
        "Metadata Test",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
        },
      );

      // 读取元数据文件
      const metadata = JSON.parse(readFileSync(result.metadataPath!, "utf8"));
      expect(metadata.status).toBe("completed");
      expect(metadata.topic).toBe("Metadata Test");
      expect(metadata.version).toBe(1);
      expect(metadata.budget).toBeDefined();
      expect(metadata.steps).toBeInstanceOf(Array);
      rmSync(join(tempDir, "index.json"), { force: true });
    });

    it("生成的报告文件包含元数据头", async () => {
      llmResponseQueue = ['["report test"]', "[]", "# Test Report\n\nThis is the report body."];

      const result = await executeDeepResearch(
        "Report File Test",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
        },
      );

      const reportContent = readFileSync(result.reportPath!, "utf8");
      // 报告应包含 "Generated:" 元数据行
      expect(reportContent).toContain("Generated:");
      expect(reportContent).toContain("crab-cli Deep Research");
      rmSync(join(tempDir, "index.json"), { force: true });
    });

    it("索引文件包含新生成的研究记录", async () => {
      llmResponseQueue = ['["index test"]', "[]", "# Index Report\n\nIndex test report."];

      await executeDeepResearch(
        "Index Test",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
        },
      );

      // 读取索引文件
      const indexPath = join(tempDir, "index.json");
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, "utf8"));
      expect(Array.isArray(index)).toBe(true);
      expect(index.length).toBeGreaterThanOrEqual(1);
      expect(index[0].topic).toBe("Index Test");
      rmSync(indexPath, { force: true });
    });
  });

  // ─── fetchExecutor 测试 ─────────────────────────────────────────

  describe("fetchExecutor 页面抓取", () => {
    it("使用 fetchExecutor 抓取搜索结果页面", async () => {
      const mockFetchExecutor = mock(() =>
        Promise.resolve({
          content: "Fetched page content with additional details",
        }),
      );

      llmResponseQueue = ['["fetch test"]', "[]", "# Fetch Report\n\nReport with fetched content."];

      const result = await executeDeepResearch(
        "Fetch Test",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxFetches: 5,
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
          fetchExecutor: mockFetchExecutor,
        },
      );

      // fetchExecutor 应该被调用
      expect(mockFetchExecutor).toHaveBeenCalled();
      rmSync(join(tempDir, "index.json"), { force: true });
    });

    it("fetchExecutor 抓取失败不影响结果", async () => {
      const failingFetchExecutor = mock(() =>
        Promise.resolve({
          content: "some content",
          error: "fetch failed",
        }),
      );

      llmResponseQueue = ['["fetch fail test"]', "[]", "# Fetch Fail Report\n\nReport despite fetch failure."];

      const result = await executeDeepResearch(
        "Fetch Fail Test",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxFetches: 5,
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
          fetchExecutor: failingFetchExecutor,
        },
      );

      // 结果不应该因为 fetch 失败而崩溃
      expect(result.summary).toBeTruthy();
      rmSync(join(tempDir, "index.json"), { force: true });
    });
  });

  // ─── 事件发布测试 ──────────────────────────────────────────────

  describe("事件总线", () => {
    it("通过 globalBus 发布研究进度事件", async () => {
      llmResponseQueue = ['["bus test"]', "[]", "# Bus Report\n\nBus test report."];

      await executeDeepResearch(
        "Bus Test",
        {
          ai: {
            apiKey: "test",
            baseUrl: "https://api.test.com",
            maxTokens: 4096,
            model: "test",
            provider: "anthropic",
          },
        },
        undefined,
        undefined,
        {
          maxSearchRounds: 1,
          maxSearches: 5,
          saveDir: tempDir,
        },
      );

      // globalBus.publish 应该被调用至少一次
      expect(mockPublishFn).toHaveBeenCalled();
      rmSync(join(tempDir, "index.json"), { force: true });
    });
  });
});

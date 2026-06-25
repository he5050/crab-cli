/**
 * 代码搜索 agent review 测试。
 *
 * 测试目标:
 *   - 验证 codebaseSearch 在与 agent review(评审)协作时的行为
 *
 * 测试用例:
 *   - 检索结果被 review 模块正确接收
 *   - mock 依赖在测试结束后被还原
 *
 * 策略:
 *   - 通过 DI 注入 mock reviewer（setToolSubAgentReviewer）代替
 *     mock.module("@/agent")，避免 barrel mock 导致其他 named exports
 *     （如 resolveToolSubAgent）丢失、引发 transitive consumer 报错。
 *   - 不 mock exec：测试在真实 TMP_DIR 中创建文件，rg 能直接搜索到。
 *   - 每个测试使用唯一 query 避免模块级 searchCache 碰撞。
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanupTestDir, createGlobalTmpTestDir } from "../../helpers/testPaths";

const TMP_DIR = createGlobalTmpTestDir("crab-codebase-review-");

let reviewImpl: (...args: any[]) => Promise<any>;
let rewriteImpl: (...args: any[]) => Promise<string>;
const reviewSearchResultsMock = mock(async (...args: any[]) => reviewImpl(...args));
const rewriteCodebaseSearchQueryMock = mock(async (...args: any[]) => rewriteImpl(...args));

async function injectMockReviewer() {
  const { resetToolFacingDeps, setToolSubAgentReviewer, setToolSubAgentResolver, setToolSubAgentTracker } =
    await import("@/agent/contracts/toolFacing");
  resetToolFacingDeps();
  setToolSubAgentReviewer({
    reviewSearchResults: reviewSearchResultsMock,
    rewriteCodebaseSearchQuery: rewriteCodebaseSearchQueryMock,
  });
  setToolSubAgentResolver({
    resolve: mock(() =>
      Promise.resolve({
        agentId: "mock",
        agentName: "mock",
        resolved: true,
        shouldDelegate: false,
      }),
    ),
  });
  setToolSubAgentTracker({
    injectMessage: mock(() => false),
    isRunning: mock(() => false),
    listRunning: mock(() => []),
  });
}

async function resetSettings() {
  const { resetSessionSettings } = await import("@/config/settings/unifiedSettings");
  resetSessionSettings();
}

async function enableAgentReviewSetting() {
  const { updateSettings } = await import("@/config/settings/unifiedSettings");
  updateSettings("session", (current) => {
    current.codebase = { ...current.codebase, enableAgentReview: true };
  });
}

async function loadCodebaseSearchTool() {
  const mod = await import("@/tool/codebaseSearch/index.ts");
  return mod.codebaseSearchTool;
}

/**
 * 在 TMP_DIR 中写入两个包含指定关键词的文件，返回关键词。
 * 每次调用使用不同关键词以避免模块级 searchCache 碰撞。
 */
function writeTestFiles(keyword: string) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(TMP_DIR, "keep.ts"), `function ${keyword}() { return true; }`);
  fs.writeFileSync(path.join(TMP_DIR, "drop.ts"), `function ${keyword}() { return false; }`);
}

describe("codebase-search Agent 审查", () => {
  beforeEach(async () => {
    await resetSettings();
    reviewSearchResultsMock.mockClear();
    rewriteCodebaseSearchQueryMock.mockClear();
    rewriteImpl = async () => "keepResult";
    reviewImpl = async (_config, _query, results) => ({
      filteredCount: 1,
      originalCount: results.length,
      results: [
        {
          ...results[0],
          isRecommended: true,
          relevanceReason: "matches query",
          relevanceScore: 0.95,
        },
      ],
      success: true,
    });
    mock.restore();
    await injectMockReviewer();
  });

  afterEach(async () => {
    cleanupTestDir(TMP_DIR);
    await resetSettings();
    mock.restore();
  });

  test("agentReview=true 时用 review agent 过滤搜索结果", async () => {
    const query = "testFilterReview";
    writeTestFiles(query);

    const tool = await loadCodebaseSearchTool();
    const result = (await tool.execute({
      agentReview: true,
      agentReviewMaxResults: 1,
      mode: "text",
      path: TMP_DIR,
      query,
    })) as any;

    expect(reviewSearchResultsMock).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].relevanceScore).toBe(0.95);
    expect(result.agentReview).toEqual({
      enabled: true,
      fallback: false,
      filteredCount: 1,
      originalCount: 2,
      reviewedCount: 1,
      success: true,
    });
  });

  test("settings.codebase.enableAgentReview=true 时自动启用 review", async () => {
    const query = "testSettingsReview";
    writeTestFiles(query);
    await enableAgentReviewSetting();

    const tool = await loadCodebaseSearchTool();
    const result = (await tool.execute({
      agentReviewRetry: false,
      mode: "text",
      path: TMP_DIR,
      query,
    })) as any;

    expect(reviewSearchResultsMock).toHaveBeenCalledTimes(1);
    expect(result.agentReview.success).toBe(true);
  });

  test("review 失败时回退原始搜索结果", async () => {
    const query = "testFallback";
    writeTestFiles(query);
    reviewImpl = async (_config, _query, results) => ({
      error: "llm unavailable",
      filteredCount: 0,
      originalCount: results.length,
      results: [],
      success: false,
    });

    const tool = await loadCodebaseSearchTool();
    const result = (await tool.execute({
      agentReview: true,
      mode: "text",
      path: TMP_DIR,
      query,
    })) as any;

    expect(result.results).toHaveLength(2);
    expect(result.agentReview).toEqual({
      enabled: true,
      error: "llm unavailable",
      fallback: true,
      filteredCount: 0,
      originalCount: 2,
      success: false,
    });
  });

  test("agentReview=false 时不调用 review agent", async () => {
    const query = "testDisabledReview";
    writeTestFiles(query);
    await enableAgentReviewSetting();

    const tool = await loadCodebaseSearchTool();
    const result = (await tool.execute({
      agentReview: false,
      mode: "text",
      path: TMP_DIR,
      query,
    })) as any;

    expect(reviewSearchResultsMock).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(2);
    expect(result.agentReview).toBeUndefined();
  });

  test("结果不足时自动改写查询并补充搜索一次", async () => {
    const query = "testRetryQuery";
    writeTestFiles(query);
    fs.writeFileSync(path.join(TMP_DIR, "retry.ts"), `function betterResult() { return true; }`);
    rewriteImpl = async () => "betterResult";
    let reviewCallCount = 0;
    reviewImpl = async (_config, _query, results) => {
      reviewCallCount += 1;
      if (reviewCallCount === 1) {
        return {
          filteredCount: results.length,
          originalCount: results.length,
          results: [],
          success: true,
        };
      }
      return {
        filteredCount: 0,
        originalCount: results.length,
        results: [
          {
            ...results[0],
            isRecommended: true,
            relevanceReason: "retry matched",
            relevanceScore: 0.91,
          },
        ],
        success: true,
      };
    };

    const tool = await loadCodebaseSearchTool();
    const result = (await tool.execute({
      agentReview: true,
      agentReviewMinResults: 1,
      mode: "text",
      path: TMP_DIR,
      query,
    })) as any;

    expect(reviewSearchResultsMock).toHaveBeenCalledTimes(2);
    expect(rewriteCodebaseSearchQueryMock).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].file).toContain("retry.ts");
    expect(result.agentReview.retry).toMatchObject({
      attempted: true,
      query: "betterResult",
      reviewedCount: 1,
      success: true,
    });
  });

  test("agentReviewRetry=false 时结果不足也不改写查询", async () => {
    const query = "testNoRetry";
    writeTestFiles(query);
    reviewImpl = async (_config, _query, results) => ({
      filteredCount: results.length,
      originalCount: results.length,
      results: [],
      success: true,
    });

    const tool = await loadCodebaseSearchTool();
    const result = (await tool.execute({
      agentReview: true,
      agentReviewMinResults: 1,
      agentReviewRetry: false,
      mode: "text",
      path: TMP_DIR,
      query,
    })) as any;

    expect(reviewSearchResultsMock).toHaveBeenCalledTimes(1);
    expect(rewriteCodebaseSearchQueryMock).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(0);
    expect(result.agentReview.retry).toBeUndefined();
  });

  test("改写失败时保留首次 review 结果并返回 retry 错误元数据", async () => {
    const query = "testRewriteFail";
    writeTestFiles(query);
    rewriteImpl = async () => {
      throw new Error("rewrite unavailable");
    };

    const tool = await loadCodebaseSearchTool();
    const result = (await tool.execute({
      agentReview: true,
      agentReviewMinResults: 2,
      mode: "text",
      path: TMP_DIR,
      query,
    })) as any;

    expect(reviewSearchResultsMock).toHaveBeenCalledTimes(1);
    expect(rewriteCodebaseSearchQueryMock).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(result.agentReview.retry).toMatchObject({
      attempted: true,
      error: "rewrite unavailable",
      success: false,
    });
  });

  test("通过 ToolContext.metadata 上报搜索、review 和重试进度", async () => {
    const query = "testMetadata";
    writeTestFiles(query);
    fs.writeFileSync(path.join(TMP_DIR, "retry.ts"), `function betterResult() { return true; }`);
    const events: { title: string; meta?: Record<string, unknown> }[] = [];
    reviewImpl = async (_config, _query, results) => ({
      filteredCount: results.length,
      originalCount: results.length,
      results: [],
      success: true,
    });
    rewriteImpl = async () => "betterResult";

    const tool = await loadCodebaseSearchTool();
    await tool.execute(
      {
        agentReview: true,
        agentReviewMinResults: 1,
        mode: "text",
        path: TMP_DIR,
        query,
      },
      {
        messageId: "msg_test",
        metadata: (title: string, meta?: Record<string, unknown>) => events.push({ meta, title }),
        sessionId: "ses_test",
      },
    );

    expect(events.map((event) => event.title)).toEqual(
      expect.arrayContaining([
        "代码库搜索中",
        "代码库搜索完成",
        "Agent Review 审查搜索结果",
        "搜索结果不足，改写查询重试",
        "代码库补充搜索中",
        "Agent Review 完成",
      ]),
    );
    expect(events.every((event) => event.meta?.tool === "codebase-search")).toBe(true);
  });
});

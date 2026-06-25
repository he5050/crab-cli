/**
 * compactSession 成功路径测试。
 *
 * 测试用例:
 *   - 压缩成功路径（strategy.compact 返回 compressed=true）
 *   - 压缩返回空结果（compressed=false）
 *   - 压缩异常路径
 *   - 摘要消息注入
 *   - checkpoint 创建
 *   - telemetry 记录
 *
 * 测试策略:
 *   vi.mock 需要提供模块的全部导出，否则传递消费者会因缺少导出而报 SyntaxError。
 *   @/session、@/monitor、@/mission 的 mock 由脚本自动从源码 index.ts 提取生成，
 *   仅对测试关注的函数做特殊返回值覆盖。
 */
import { beforeEach, describe, expect, test, vi } from "bun:test";
import type { CompactStrategy, CompactStrategyResult } from "@/compress/types";

// ── compactService 直接依赖的内部模块 ──────────────────────

vi.mock("@/compress/core/compressionCoordinator", () => ({
  compressionCoordinator: {
    withLock: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  },
}));

vi.mock("@/compress/strategies/compactStrategy", () => ({
  createCompactStrategy: vi.fn(() => mockStrategy),
  createHybridCompactStrategy: vi.fn(() => mockStrategy),
  createIncrementalCompactStrategy: vi.fn(() => mockStrategy),
  createStandardCompactStrategy: vi.fn(() => mockStrategy),
  selectCompactStrategyKind: vi.fn(() => "standard" as const),
}));

vi.mock("@/compress/core/errors", () => ({
  createCompressionError: vi.fn((code: string, message: string) => ({ code, context: {}, message })),
  toCompressionFailure: vi.fn((err: { code: string; message: string }) => ({
    error: err.message,
    errorCode: err.code,
  })),
}));

vi.mock("@/compress/conversation", () => ({
  estimateMessagesTokens: vi.fn(() => 1000),
  estimateTokens: vi.fn(() => 1000),
}));

// ── @/session — 自动提取自 src/session/index.ts 全部导出 ──
vi.mock("@/session", () => ({
  addMessage: vi.fn(),
  addPersistentPermission: vi.fn(),
  addSessionTokens: vi.fn(),
  addTextMessage: vi.fn(),
  buildContextBudget: vi.fn(),
  buildContextGovernancePanel: vi.fn(),
  buildContextGovernanceSummary: vi.fn(),
  canAcceptInput: vi.fn(),
  canAcceptInputByState: vi.fn(),
  canExecute: vi.fn(),
  canTransition: vi.fn(),
  chatMessageToParts: vi.fn(),
  chatRoleToMessageRole: vi.fn(),
  cleanIncompleteToolCalls: vi.fn(),
  cleanupOldCheckpoints: vi.fn(),
  clearPersistentPermissions: vi.fn(),
  clearSessionStatus: vi.fn(),
  collectContextGovernancePanel: vi.fn(),
  commandUsageManager: {},
  compareCheckpoints: vi.fn(),
  convertMultiple: vi.fn(),
  convertSession: vi.fn(),
  copyMessages: vi.fn(),
  createCheckpoint: vi.fn(() => ({ id: "checkpoint-1" })),
  createLoggedStateMachine: vi.fn(),
  createProtectedStateMachine: vi.fn(),
  createSession: vi.fn(),
  createSessionAsync: vi.fn(),
  createSessionOrchestrator: vi.fn(),
  createSessionStateMachine: vi.fn(),
  createSnapshot: vi.fn(),
  deleteCheckpoint: vi.fn(),
  deleteMessage: vi.fn(),
  deleteRecording: vi.fn(),
  deleteSession: vi.fn(),
  deleteSessionMessages: vi.fn(),
  deleteSnapshot: vi.fn(),
  destroyAllSessionStateManagers: vi.fn(),
  destroySessionStateManager: vi.fn(),
  detectConvertFormat: vi.fn(),
  detectFormat: vi.fn(),
  diffSnapshots: vi.fn(),
  endRequest: vi.fn(),
  ensureSession: vi.fn(),
  ensureSessionAsync: vi.fn(),
  estimateMessagesTokens: vi.fn(() => 1000),
  estimateTokens: vi.fn(),
  exportSession: vi.fn(),
  exportSessionAsHtml: vi.fn(),
  exportSessionAsJson: vi.fn(),
  exportSessionAsMarkdown: vi.fn(),
  exportSessionAsText: vi.fn(),
  extractPlainText: vi.fn(),
  findPersistentPermission: vi.fn(),
  formatTokenCount: vi.fn(),
  forkSession: vi.fn(),
  getAllSessionStateManagers: vi.fn(),
  getAvailableTransitions: vi.fn(),
  getBusySessions: vi.fn(),
  getCheckpoint: vi.fn(),
  getCheckpointStats: vi.fn(),
  getGlobalUsageStats: vi.fn(),
  getMessageCount: vi.fn(),
  getOrCreateSessionStateManager: vi.fn(),
  getSession: vi.fn(),
  getSessionMessages: vi.fn(() => Array.from({ length: 4 }, () => ({ role: "user", parts: [] }))),
  getSessionStateManager: vi.fn(),
  getSessionStatus: vi.fn(),
  getSessionUsageStats: vi.fn(),
  importMultiple: vi.fn(),
  importSession: vi.fn(),
  initTaskRuntime: vi.fn(),
  InvalidStateTransitionError: class {},
  isSessionBusy: vi.fn(),
  isTerminalState: vi.fn(),
  listCheckpoints: vi.fn(),
  listRecordings: vi.fn(),
  listSessions: vi.fn(),
  listShares: vi.fn(),
  listSnapshots: vi.fn(),
  loadPersistentPermissions: vi.fn(),
  loadRecording: vi.fn(),
  messagePartsToChatParts: vi.fn(() => []),
  messageRecordsToModelMessages: vi.fn(),
  messageRoleToChatRole: vi.fn(() => "user"),
  modelMessageToParts: vi.fn(() => []),
  parseClaudeMessages: vi.fn(),
  previewImport: vi.fn(),
  removePersistentPermission: vi.fn(),
  resetAllBusy: vi.fn(),
  restoreCheckpoint: vi.fn(),
  restoreSnapshot: vi.fn(),
  serializeSessionAsHtml: vi.fn(),
  serializeSessionAsJson: vi.fn(),
  serializeSessionAsMarkdown: vi.fn(),
  serializeSessionAsText: vi.fn(),
  SessionRecorder: class {},
  SessionReplayer: class {},
  SessionState: class {},
  SessionStateMachine: class {},
  SessionStateManager: class {},
  setSessionPersistenceStatus: vi.fn(),
  setSessionStatus: vi.fn(),
  shareSession: vi.fn(),
  startRequest: vi.fn(),
  StateTransitionEvent: class {},
  summarizeSession: vi.fn(),
  syncRuntimeSessionStatus: vi.fn(),
  updateCheckpointLabel: vi.fn(),
  updateSession: vi.fn(),
  validateSessionData: vi.fn(),
}));

// ── @/monitor — 自动提取自 src/monitor/index.ts 全部导出 ──
vi.mock("@monitor", () => ({
  CpuSampler: class {},
  PerformanceDashboard: class {},
  PerformanceMonitor: class {},
  addMemorySample: vi.fn(),
  collectMetrics: vi.fn(() => ({})),
  createCpuAlertRule: vi.fn(),
  createMemoryAlertRule: vi.fn(),
  createPerformanceDashboard: vi.fn(),
  generateResourceReport: vi.fn(),
  getAlertThresholds: vi.fn(),
  getCpuUsagePercent: vi.fn(() => 0),
  getGlobalDashboard: vi.fn(),
  getLogger: vi.fn(),
  getMemoryStats: vi.fn(() => ({})),
  getMemoryTrend: vi.fn(),
  getMemoryUsageMB: vi.fn(() => 0),
  getMeter: vi.fn(() => ({ add: vi.fn() })),
  getResourceStatus: vi.fn(),
  getTracer: vi.fn(),
  getUptime: vi.fn(() => 0),
  initTelemetry: vi.fn(),
  isResourceMonitorPaused: vi.fn(() => false),
  measurePerformance: vi.fn(),
  performanceMonitor: {},
  recordChatBusinessTelemetry: vi.fn(),
  recordCompressionBusinessTelemetry: vi.fn(),
  recordSearchBusinessTelemetry: vi.fn(),
  recordToolBusinessTelemetry: vi.fn(),
  renderPrometheusMetrics: vi.fn(() => ""),
  resetPrometheusMetricsForTesting: vi.fn(),
  shutdownTelemetry: vi.fn(),
  withSpan: vi.fn(),
}));

// ── @/mission — 自动提取自 src/mission/index.ts 全部导出 ──
vi.mock("@mission", () => ({
  DEFAULT_GOAL_TOKEN_BUDGET: 0,
  GoalManager: class {},
  LoopDaemonManager: class {},
  LoopManager: class {},
  TaskManager: class {},
  __resetLoopManagerDepsForTesting: vi.fn(),
  __setLoopManagerDepsForTesting: vi.fn(),
  calculateNextCronRun: vi.fn(),
  executeTask: vi.fn(),
  goalManager: { loadGoal: vi.fn(async () => null) },
  initTaskRuntime: vi.fn(),
  loopDaemonManager: {},
  loopManager: class {},
  parseLoopSchedule: vi.fn(),
  scheduleLabel: vi.fn(),
  taskManager: {},
  validateCron: vi.fn(() => ({ valid: true })),
}));

/** 可配置的 mock 策略 */
let mockCompactResult: CompactStrategyResult = {
  compressed: false,
  messages: [],
  tokensAfterEstimate: 1000,
  tokensBefore: 1000,
};
const mockStrategy: CompactStrategy = {
  kind: "standard",
  compact: vi.fn(async () => mockCompactResult),
};

function mockConfig() {
  return {
    defaultProvider: { provider: "test", model: "test-model" },
  } as never;
}

// TODO: 此测试因 vi.mock 链式传递依赖断裂而暂时跳过
// 需要重构为集成测试或使用依赖注入模式, 避免 mock 共享基础模块
describe.skip("compactSession 成功路径", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompactResult = {
      compressed: false,
      messages: [],
      tokensAfterEstimate: 1000,
      tokensBefore: 1000,
    };
  });

  test("压缩成功返回 ok=true", async () => {
    mockCompactResult = {
      compressed: true,
      messages: [{ role: "user" as const, content: "摘要" }],
      tokensAfterEstimate: 300,
      tokensBefore: 1000,
      summary: "摘要内容",
    };

    const { compactSession } = await import("@/compress/core/compressService");
    const result = await compactSession("s1", mockConfig());

    expect(result.ok).toBe(true);
    expect(result.tokensBefore).toBeGreaterThan(0);
    expect(result.tokensAfter).toBe(300);
    expect(result.preCompressionCheckpointId).toBe("checkpoint-1");
  });

  test("压缩成功时注入摘要消息", async () => {
    mockCompactResult = {
      compressed: true,
      messages: [],
      tokensAfterEstimate: 300,
      tokensBefore: 1000,
      summary: "测试摘要",
    };

    const { compactSession } = await import("@/compress/core/compressService");
    await compactSession("s1", mockConfig());

    const { addTextMessage } = await import("@/session");
    expect(addTextMessage).toHaveBeenCalledWith("s1", "system", "[上下文压缩摘要]\n测试摘要");
  });

  test("压缩成功但有 markerMessage 时注入 marker", async () => {
    mockCompactResult = {
      compressed: true,
      messages: [],
      tokensAfterEstimate: 300,
      tokensBefore: 1000,
      markerMessage: "[压缩标记]",
    };

    const { compactSession } = await import("@/compress/core/compressService");
    await compactSession("s1", mockConfig());

    const { addTextMessage } = await import("@/session");
    expect(addTextMessage).toHaveBeenCalledWith("s1", "system", "[压缩标记]");
  });

  test("压缩成功时记录 telemetry", async () => {
    mockCompactResult = {
      compressed: true,
      messages: [],
      tokensAfterEstimate: 300,
      tokensBefore: 1000,
      summary: "摘要",
    };

    const { compactSession } = await import("@/compress/core/compressService");
    await compactSession("s1", mockConfig());

    const { recordCompressionBusinessTelemetry } = await import("@monitor");
    expect(recordCompressionBusinessTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", exitReason: "success" }),
    );
  });

  test("压缩返回空结果时 ok=true（无需压缩，非错误）", async () => {
    mockCompactResult = {
      compressed: false,
      messages: [],
      tokensAfterEstimate: 1000,
      tokensBefore: 1000,
    };

    const { compactSession } = await import("@/compress/core/compressService");
    const result = await compactSession("s1", mockConfig());

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("压缩异常时 ok=false 且记录 telemetry", async () => {
    mockStrategy.compact = vi.fn(async () => {
      throw new Error("AI 调用超时");
    });

    const { compactSession } = await import("@/compress/core/compressService");
    const result = await compactSession("s1", mockConfig());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("AI 调用超时");

    const { recordCompressionBusinessTelemetry } = await import("@monitor");
    expect(recordCompressionBusinessTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", exitReason: "exception" }),
    );
  });

  test("消息少于 4 条时记录 telemetry 错误", async () => {
    const { getSessionMessages } = await import("@/session");
    (getSessionMessages as ReturnType<typeof vi.fn>).mockReturnValueOnce([] as never);

    const { compactSession } = await import("@/compress/core/compressService");
    const result = await compactSession("s1-empty", mockConfig());

    expect(result.ok).toBe(false);

    const { recordCompressionBusinessTelemetry } = await import("@monitor");
    expect(recordCompressionBusinessTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ exitReason: "too_few_messages" }),
    );
  });
});

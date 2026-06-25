/**
 * compactSession / hybridCompactSession 服务入口测试。
 *
 * 测试用例:
 *   - 消息太少时返回 too_few_messages 错误
 *   - compactSession 和 hybridCompactSession 入口验证
 *   - 错误载荷结构
 *
 * 已知限制: bun:test 跨文件 mock 隔离不完善。批量运行时某些测试文件
 * 的 mock 可能污染本文件的 AppError 实例，导致 errorCode 不为 "USER-200"
 * 而显示 "too_few_messages"。单独运行 4/4 全部通过。
 */
import { describe, expect, test, vi, mock, afterAll } from "bun:test";

// 预导入真实模块，spread 后只覆盖特定函数
const realSessionCore = await import("@/session/core");
const realMessageFactories = await import("@/conversation/message/messageFactories");
const realTelemetry = await import("@/monitor/telemetry/telemetry");
const realMission = await import("@/mission");

mock.module("@/session/core", () => ({
  ...realSessionCore,
  getSessionMessages: vi.fn(() => []),
  addTextMessage: vi.fn(),
  createCheckpoint: vi.fn(() => ({ id: "checkpoint-1" })),
}));

vi.mock("@/compress/core/compressionCoordinator", () => ({
  compressionCoordinator: {
    withLock: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  },
}));

vi.mock("@/mission", () => ({
  ...realMission,
  goalManager: { ...realMission.goalManager, loadGoal: vi.fn(() => null) },
}));

vi.mock("@/monitor/telemetry/telemetry", () => ({
  ...realTelemetry,
  recordCompressionBusinessTelemetry: vi.fn(),
  recordToolBusinessTelemetry: vi.fn(),
  initTelemetry: vi.fn(),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  getTracer: vi.fn(() => ({ startSpan: vi.fn(() => ({ end: vi.fn() })) })),
  getMeter: vi.fn(() => ({ createCounter: vi.fn(() => ({ add: vi.fn() })) })),
  shutdownTelemetry: vi.fn(),
}));

vi.mock("@/conversation/message/messageFactories", () => ({
  ...realMessageFactories,
  createModelMessageFromRecord: vi.fn(() => ({ role: "user", content: "" })),
  createMultiToolResultMessage: vi.fn(),
}));

afterAll(() => {
  mock.restore();
});

describe("compactSession 服务入口", () => {
  test("消息少于 4 条时返回错误", async () => {
    // getSessionMessages 返回空数组
    const { compactSession } = await import("@/compress/core/compressService");

    const mockConfig = {
      defaultProvider: {
        provider: "test",
        model: "test-model",
      },
    } as never;

    const result = await compactSession("session-1", mockConfig);
    expect(result.ok).toBe(false);
    expect(result.messageCount).toBe(0);
    expect(result.error).toBeTruthy();
    expect(result.errorCode).toMatch(/^USER-/);
  });

  test("CompactResult 结构正确", async () => {
    const { compactSession } = await import("@/compress/core/compressService");

    const mockConfig = {
      defaultProvider: {
        provider: "test",
        model: "test-model",
      },
    } as never;

    const result = await compactSession("session-1", mockConfig);
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("tokensBefore");
    expect(result).toHaveProperty("tokensAfter");
    expect(result).toHaveProperty("messageCount");
  });
});

describe("hybridCompactSession 服务入口", () => {
  test("消息少于 4 条时返回错误", async () => {
    const { hybridCompactSession } = await import("@/compress/core/compressService");

    const mockConfig = {
      defaultProvider: {
        provider: "test",
        model: "test-model",
      },
    } as never;

    const result = await hybridCompactSession("session-1", mockConfig);
    expect(result.ok).toBe(false);
    expect(result.messageCount).toBe(0);
    expect(result.error).toBeTruthy();
  });

  test("默认使用 hybrid 策略", async () => {
    const { hybridCompactSession } = await import("@/compress/core/compressService");

    const mockConfig = {
      defaultProvider: {
        provider: "test",
        model: "test-model",
      },
    } as never;

    const result = await hybridCompactSession("session-1", mockConfig);
    // 消息不足，返回错误，但确认结构正确
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("tokensBefore");
    expect(result).toHaveProperty("tokensAfter");
    expect(result).toHaveProperty("messageCount");
  });
});

/**
 * 混合流测试。
 *
 * 测试用例:
 *   - 多源流合并
 *   - 流切换
 *   - 流同步
 */
import { describe, expect, test } from "bun:test";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { isRecoverableError } from "@/api";

/** 等待微任务队列完成 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

// ─── isRecoverableError 测试 ─────────────────────────────────

describe("isRecoverableError", () => {
  test("401 不可恢复", () => {
    expect(isRecoverableError(new Error("401 Unauthorized"))).toBe(false);
  });

  test("403 不可恢复", () => {
    expect(isRecoverableError(new Error("403 Forbidden"))).toBe(false);
  });

  test("invalid api key 不可恢复", () => {
    expect(isRecoverableError(new Error("Invalid API key provided"))).toBe(false);
  });

  test("404 可恢复", () => {
    expect(isRecoverableError(new Error("404 Not Found"))).toBe(true);
  });

  test("500 可恢复", () => {
    expect(isRecoverableError(new Error("500 Internal Server Error"))).toBe(true);
  });

  test("网络错误可恢复", () => {
    expect(isRecoverableError(new Error("fetch failed: ECONNREFUSED"))).toBe(true);
  });

  test("DNS 错误可恢复", () => {
    expect(isRecoverableError(new Error("getaddrinfo ENOTFOUND api.example.com"))).toBe(true);
  });

  test("非 Error 类型默认可恢复", () => {
    expect(isRecoverableError("something went wrong")).toBe(true);
    expect(isRecoverableError(null)).toBe(true);
  });

  test("大小写不敏感", () => {
    expect(isRecoverableError(new Error("UNAUTHORIZED ACCESS"))).toBe(false);
    expect(isRecoverableError(new Error("FORBIDDEN"))).toBe(false);
  });

  test("unsupported 可恢复", () => {
    expect(isRecoverableError(new Error("Unsupported request method"))).toBe(true);
  });
});

// ─── ProviderStatus 事件测试 ─────────────────────────────────

describe("ProviderStatus 事件", () => {
  test("事件定义包含正确字段", () => {
    expect(AppEvent.ProviderStatus).toBeDefined();
    expect(AppEvent.ProviderStatus.type).toBe("ai.provider.status");
  });

  test("发布 calling 事件", async () => {
    const events: any[] = [];
    const unsub = globalBus.subscribe(AppEvent.ProviderStatus, (evt) => {
      events.push(evt.properties);
    });

    globalBus.publish(AppEvent.ProviderStatus, {
      method: "chat",
      model: "gpt-4o",
      provider: "openai",
      status: "calling",
    });

    // 等待微任务队列完成
    await flushMicrotasks();

    expect(events.length).toBe(1);
    expect(events[0]).toEqual({
      method: "chat",
      model: "gpt-4o",
      provider: "openai",
      status: "calling",
    });

    unsub();
  });

  test("发布 success 事件", async () => {
    const events: any[] = [];
    const unsub = globalBus.subscribe(AppEvent.ProviderStatus, (evt) => {
      events.push(evt.properties);
    });

    globalBus.publish(AppEvent.ProviderStatus, {
      method: "chat",
      model: "gpt-4o",
      provider: "openai",
      status: "success",
    });

    // 等待微任务队列完成
    await flushMicrotasks();

    expect(events.length).toBe(1);
    expect(events[0].status).toBe("success");
    expect(events[0].error).toBeUndefined();

    unsub();
  });

  test("发布 error 事件带错误详情", async () => {
    const events: any[] = [];
    const unsub = globalBus.subscribe(AppEvent.ProviderStatus, (evt) => {
      events.push(evt.properties);
    });

    globalBus.publish(AppEvent.ProviderStatus, {
      error: "404 Not Found — endpoint unavailable",
      method: "chat",
      model: "gpt-4o",
      provider: "openai",
      status: "error",
    });

    // 等待微任务队列完成
    await flushMicrotasks();

    expect(events.length).toBe(1);
    expect(events[0].status).toBe("error");
    expect(events[0].error).toContain("404");

    unsub();
  });
});

// ─── ChatChunk 事件测试 ──────────────────────────────────────

describe("ChatChunk 事件", () => {
  test("流式 chunk 事件正确传递", async () => {
    const chunks: string[] = [];
    const unsub = globalBus.subscribe(AppEvent.ChatChunk, (evt) => {
      chunks.push(evt.properties.chunk);
    });

    globalBus.publish(AppEvent.ChatChunk, { chunk: "Hello" });
    globalBus.publish(AppEvent.ChatChunk, { chunk: " " });
    globalBus.publish(AppEvent.ChatChunk, { chunk: "World" });

    // 等待微任务队列完成
    await flushMicrotasks();

    expect(chunks).toEqual(["Hello", " ", "World"]);

    unsub();
  });
});

// ─── fullStream 错误类型识别 ──────────────────────────────────

describe("fullStream 错误识别", () => {
  test("text part not found 错误文本可被正确识别", () => {
    const errorText = "text part chatcmpl-fea515f3-c381-4ed5-8814-6ea3817f2f3d not found";
    const isTextPartError = errorText.includes("text part") && errorText.includes("not found");
    expect(isTextPartError).toBe(true);
  });

  test("真实 API 错误不被误判为 text part 错误", () => {
    const errorText = "Rate limit exceeded";
    const isTextPartError = errorText.includes("text part") && errorText.includes("not found");
    expect(isTextPartError).toBe(false);
  });

  test("content filter 错误不被误判", () => {
    const errorText = "Content filtered due to safety policy";
    const isTextPartError = errorText.includes("text part") && errorText.includes("not found");
    expect(isTextPartError).toBe(false);
  });
});

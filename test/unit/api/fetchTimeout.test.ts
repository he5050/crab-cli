/**
 * fetchWithTimeout 带超时 fetch 工具单元测试
 *
 * 测试目标:
 * - 正常请求返回 response
 * - 超时触发 abort
 * - abortSignal 组合（外部 signal + 内部超时）
 * - timeoutMs=0 时不超时
 * - fetch 失败时抛出错误
 * - 超时后 cleanup（clearTimeout 被调用）
 */

import { describe, it, expect, afterEach, mock, spyOn } from "bun:test";
import { fetchWithTimeout } from "@/api/utils/fetchTimeout";

describe("fetchWithTimeout", () => {
  let clearTimeoutSpy: ReturnType<typeof spyOn>;
  let originalFetch: typeof globalThis.fetch;

  afterEach(() => {
    mock.restore();
    globalThis.fetch = originalFetch;
  });

  it("正常请求应返回 response", async () => {
    const fakeResponse = new Response("ok");
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(fakeResponse)) as unknown as typeof globalThis.fetch;

    clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    const result = await fetchWithTimeout("https://api.example.com/test");
    expect(result).toBe(fakeResponse);
  });

  it("超时应触发 abort 并抛出错误", async () => {
    // 创建一个监听 abort 信号后永远挂起的 fetch mock
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const mockFetchImpl = mock(
      (_url: string, init: RequestInit) =>
        // 当 abort 信号触发时 reject，模拟真实 fetch 行为
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(abortError), { once: true });
        }),
    );

    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchImpl as unknown as typeof globalThis.fetch;

    clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    await expect(fetchWithTimeout("https://api.example.com/test", { timeoutMs: 10 })).rejects.toThrow(
      "The operation was aborted",
    );

    // 超时后 clearTimeout 应被调用
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("外部 abortSignal 应与内部超时信号组合", async () => {
    const controller = new AbortController();
    const mockFetchImpl = mock((_url: string, init: RequestInit) => {
      // 验证传入的 signal 存在
      expect(init.signal).toBeDefined();
      return Promise.resolve(new Response("ok"));
    });

    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchImpl as unknown as typeof globalThis.fetch;

    clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    await fetchWithTimeout("https://api.example.com/test", {
      abortSignal: controller.signal,
      timeoutMs: 30000,
    });
  });

  it("外部 abortSignal 触发时应中止请求", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const mockFetchImpl = mock(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(abortError), { once: true });
        }),
    );

    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetchImpl as unknown as typeof globalThis.fetch;

    clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    const promise = fetchWithTimeout("https://api.example.com/test", {
      abortSignal: controller.signal,
      timeoutMs: 30000,
    });
    // 手动触发外部 abort
    controller.abort();
    await expect(promise).rejects.toThrow("The operation was aborted");
  });

  it("timeoutMs=0 时 fetch 应在 setTimeout 回调前正常完成", async () => {
    const fakeResponse = new Response("ok");
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(fakeResponse)) as unknown as typeof globalThis.fetch;

    clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    // timeoutMs=0 意味着 setTimeout(cb, 0)，如果 fetch 同步 resolve 则应在超时回调前完成
    const result = await fetchWithTimeout("https://api.example.com/test", { timeoutMs: 0 });
    expect(result).toBe(fakeResponse);
  });

  it("fetch 失败时应抛出错误且保证 clearTimeout 被调用", async () => {
    const networkError = new TypeError("Failed to fetch");
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.reject(networkError)) as unknown as typeof globalThis.fetch;

    clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    await expect(fetchWithTimeout("https://api.example.com/test", { timeoutMs: 30000 })).rejects.toThrow(
      "Failed to fetch",
    );

    // 无论成功还是失败，clearTimeout 都应被调用
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("正常请求完成后应保证 clearTimeout 被调用", async () => {
    const fakeResponse = new Response("ok");
    originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(fakeResponse)) as unknown as typeof globalThis.fetch;

    clearTimeoutSpy = spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    await fetchWithTimeout("https://api.example.com/test", { timeoutMs: 30000 });
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

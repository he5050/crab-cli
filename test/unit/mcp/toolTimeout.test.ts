/**
 * 工具 per-tool timeoutMs 测试。
 *
 * 覆盖矩阵:
 *   1. 无 timeoutMs 的工具按原行为执行(不进入 race)
 *   2. timeoutMs: 100 工具在 50ms 内完成 → 正常返回
 *   3. timeoutMs: 50 工具耗时 200ms → 抛出 ToolTimeoutError
 *   4. 超时错误的 name/code/toolName/timeoutMs 字段正确
 *   5. 工具正常完成后定时器被清理(无泄漏，可观测)
 *   6. timeoutMs: 0 → 不施加超时
 *   7. timeoutMs: -1 → 不施加超时
 *   8. 超时时 ToolTimeout 事件被发布，payload 正确
 *   9. 超时触发 ctx.abortSignal(下游可响应)
 *   10. 工具自身抛错(非超时)时错误被原样保留，不会被误判为超时
 *   11. ToolTimeoutError 公共类可独立构造使用
 *   12. ToolDefinition.timeoutMs 字段可被 defineTool 透传
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type ToolDefinition, ToolTimeoutError, defineTool } from "@/tool/types";
import { runWithTimeout } from "@/tool/executor/toolTimeout";
import { AppEvent } from "@/bus";
import { globalBus } from "@/bus";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("runWithTimeout — 无超时配置", () => {
  test("无 timeoutMs 字段:直接透传 execute，不进入 race", async () => {
    let execCalled = false;
    const tool = defineTool({
      description: "no timeout",
      execute: async () => {
        execCalled = true;
        await sleep(80);
        return "ok";
      },
      name: "t_no_timeout",
      parameters: z.object({}),
      permission: "test",
    });
    const ctx = { messageId: "m1", sessionId: "s1" };
    const start = Date.now();
    const result = await runWithTimeout(tool, {}, ctx);
    const elapsed = Date.now() - start;
    expect(result).toBe("ok");
    expect(execCalled).toBe(true);
    // 无 race:应至少执行 70ms(避免 timer 抖动)
    expect(elapsed).toBeGreaterThanOrEqual(70);
  });

  test("timeoutMs: 0 视为无超时", async () => {
    const tool = defineTool({
      description: "zero",
      execute: async () => {
        await sleep(60);
        return "ok-zero";
      },
      name: "t_zero_timeout",
      parameters: z.object({}),
      permission: "test",
      timeoutMs: 0,
    });
    const result = await runWithTimeout(tool, {});
    expect(result).toBe("ok-zero");
  });

  test("timeoutMs: -1 视为无超时", async () => {
    const tool = defineTool({
      description: "neg",
      execute: async () => {
        await sleep(60);
        return "ok-neg";
      },
      name: "t_neg_timeout",
      parameters: z.object({}),
      permission: "test",
      timeoutMs: -1,
    });
    const result = await runWithTimeout(tool, {});
    expect(result).toBe("ok-neg");
  });
});

describe("runWithTimeout — 正常完成路径", () => {
  test("工具在 timeoutMs 之内完成:返回正确值", async () => {
    const tool = defineTool({
      description: "fast",
      execute: async () => {
        await sleep(50);
        return "fast-result";
      },
      name: "t_fast",
      parameters: z.object({}),
      permission: "test",
      timeoutMs: 200,
    });
    const result = await runWithTimeout(tool, {});
    expect(result).toBe("fast-result");
  });

  test("工具完成时 timer 已被清理(无泄漏)", async () => {
    const clearedTimers: ReturnType<typeof setTimeout>[] = [];
    const realClearTimeout = globalThis.clearTimeout;
    // Spy clearTimeout to record what gets cleared
    const clearSpy = ((timer: ReturnType<typeof setTimeout>) => {
      clearedTimers.push(timer);
      return realClearTimeout(timer);
    }) as typeof clearTimeout;
    (globalThis as any).clearTimeout = clearSpy;

    try {
      const tool = defineTool({
        description: "clear timer",
        execute: async () => {
          await sleep(20);
          return "done";
        },
        name: "t_clear",
        parameters: z.object({}),
        permission: "test",
        timeoutMs: 200,
      });
      await runWithTimeout(tool, {});
      // 至少应该清理一次(成功路径的 finally)
      expect(clearedTimers.length).toBeGreaterThanOrEqual(1);
    } finally {
      (globalThis as any).clearTimeout = realClearTimeout;
    }
  });
});

describe("runWithTimeout — 超时路径", () => {
  test("工具超过 timeoutMs 时抛出 ToolTimeoutError", async () => {
    const tool = defineTool({
      description: "slow",
      execute: async () => {
        await sleep(200);
        return "never";
      },
      name: "t_slow",
      parameters: z.object({}),
      permission: "test",
      timeoutMs: 50,
    });
    expect(runWithTimeout(tool, {})).rejects.toThrow(ToolTimeoutError);
  });

  test("超时报错携带正确字段:name/code/toolName/timeoutMs/message", async () => {
    const tool = defineTool({
      description: "slow fields",
      execute: async () => {
        await sleep(150);
        return "never";
      },
      name: "t_slow_fields",
      parameters: z.object({}),
      permission: "test",
      timeoutMs: 30,
    });
    try {
      await runWithTimeout(tool, {});
      expect(true).toBe(false); // 不应到达
    } catch (error) {
      expect(error).toBeInstanceOf(ToolTimeoutError);
      const e = error as ToolTimeoutError;
      expect(e.name).toBe("ToolTimeoutError");
      expect(e.code).toBe("TOOL_TIMEOUT");
      expect(e.toolName).toBe("t_slow_fields");
      expect(e.timeoutMs).toBe(30);
      expect(e.message).toContain("t_slow_fields");
      expect(e.message).toContain("30");
    }
  });

  test("工具自身抛错(非超时)原样保留，不被误判为超时", async () => {
    const tool = defineTool({
      description: "throw",
      execute: async () => {
        await sleep(10);
        throw new Error("original-failure");
      },
      name: "t_throw",
      parameters: z.object({}),
      permission: "test",
      timeoutMs: 1000,
    });
    try {
      await runWithTimeout(tool, {});
      expect(true).toBe(false);
    } catch (error) {
      // 必须是原始错误，不是 ToolTimeoutError
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("original-failure");
      expect(error).not.toBeInstanceOf(ToolTimeoutError);
    }
  });

  test("超时后迟到的工具 resolve 不会覆盖超时错误(锁定 timedOut 哨兵语义)", async () => {
    let resolveTool: ((v: unknown) => void) | undefined;
    const tool = defineTool({
      description: "late resolve",
      execute: () =>
        new Promise<unknown>((r) => {
          resolveTool = r;
        }),
      name: "t_late_resolve",
      parameters: z.object({}),
      permission: "test",
      timeoutMs: 30,
    });
    const promise = runWithTimeout(tool, {});
    // 早期挂载 no-op 拒绝处理器，避免 30ms 超时触发后到我们 await 之间
    // 出现 unhandled rejection 把测试顶掉(这也是真实使用中的良好实践)
    promise.catch(() => {});
    // 等待超时触发(30ms 超时 + 调度抖动余量)
    await sleep(60);
    // 工具在超时后才返回，迟到 resolve 必须被忽略(不得覆盖 timeout 错误)
    resolveTool?.("late-value");
    expect(promise).rejects.toThrow(ToolTimeoutError);
  });
});

describe("runWithTimeout — abortSignal 联动", () => {
  test("超时时 ctx.abortSignal 被触发", async () => {
    let abortFired = false;
    const ac = new AbortController();
    ac.signal.addEventListener("abort", () => {
      abortFired = true;
    });

    const tool = defineTool({
      description: "abort on timeout",
      execute: async (_args, ctx) =>
        // 监听 ctx.abortSignal 模拟可响应下游
        new Promise((_resolve, reject) => {
          const sig = ctx?.abortSignal;
          if (!sig) {
            return reject(new Error("no signal"));
          }
          if (sig.aborted) {
            abortFired = true;
            return reject(new Error("aborted-pre"));
          }
          sig.addEventListener(
            "abort",
            () => {
              abortFired = true;
              reject(new Error("aborted-by-timeout"));
            },
            { once: true },
          );
          // 长 sleep
          setTimeout(() => reject(new Error("never")), 500);
        }),
      name: "t_abort",
      parameters: z.object({}),
      permission: "test",
      timeoutMs: 30,
    });

    const ctx = { abortSignal: ac.signal, messageId: "m1", sessionId: "s1" };
    expect(runWithTimeout(tool, {}, ctx)).rejects.toThrow(ToolTimeoutError);
    // 允许微小竞态:abort 可能在 error 抛出的同时触发
    await sleep(10);
    expect(abortFired).toBe(true);
  });
});

describe("runWithTimeout — 事件发布", () => {
  test("超时时发布 ToolTimeout 事件，payload 字段正确", async () => {
    const received: any[] = [];
    const unsub = globalBus.subscribe(AppEvent.ToolTimeout, (evt) => {
      received.push(evt.properties);
    });

    try {
      const tool = defineTool({
        description: "event test",
        execute: async () => {
          await sleep(200);
          return "never";
        },
        name: "t_event",
        parameters: z.object({}),
        permission: "test",
        timeoutMs: 25,
      });

      const ctx = { messageId: "msg-1", sessionId: "sess-1" };
      try {
        await runWithTimeout(tool, {}, ctx);
      } catch {
        // Expected
      }

      // 给事件队列一点时间
      await sleep(20);

      expect(received.length).toBeGreaterThanOrEqual(1);
      const payload = received[0];
      expect(payload.toolName).toBe("t_event");
      expect(payload.timeoutMs).toBe(25);
      expect(payload.sessionId).toBe("sess-1");
      expect(payload.messageId).toBe("msg-1");
    } finally {
      unsub();
    }
  });

  test("未超时时不应发布 ToolTimeout 事件", async () => {
    const received: any[] = [];
    const unsub = globalBus.subscribe(AppEvent.ToolTimeout, (evt) => {
      received.push(evt.properties);
    });

    try {
      const tool = defineTool({
        description: "no event",
        execute: async () => {
          await sleep(20);
          return "ok";
        },
        name: "t_no_event",
        parameters: z.object({}),
        permission: "test",
        timeoutMs: 200,
      });
      const result = await runWithTimeout(tool, {});
      expect(result).toBe("ok");
      await sleep(30);
      expect(received.length).toBe(0);
    } finally {
      unsub();
    }
  });
});

describe("ToolTimeoutError — 公共类", () => {
  test("可直接 new 出结构化错误", () => {
    const err = new ToolTimeoutError("custom_tool", 999, "boom");
    expect(err).toBeInstanceOf(ToolTimeoutError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ToolTimeoutError");
    expect(err.code).toBe("TOOL_TIMEOUT");
    expect(err.toolName).toBe("custom_tool");
    expect(err.timeoutMs).toBe(999);
    expect(err.message).toBe("boom");
  });

  test("未提供 message 时使用默认信息", () => {
    const err = new ToolTimeoutError("mytool", 100);
    expect(err.message).toContain("mytool");
    expect(err.message).toContain("100");
  });
});

describe("ToolDefinition.timeoutMs — 字段可被 defineTool 透传", () => {
  test("defineTool 返回的对象保留 timeoutMs", () => {
    const tool = defineTool({
      description: "field test",
      execute: async () => "x",
      name: "t_field",
      parameters: z.object({}),
      permission: "test",
      timeoutMs: 777,
    });
    expect(tool.timeoutMs).toBe(777);
    expect(tool.name).toBe("t_field");
  });

  test("未设置 timeoutMs 时该字段为 undefined(不影响其他字段)", () => {
    const tool: ToolDefinition = defineTool({
      description: "undef",
      execute: async () => "x",
      name: "t_undef",
      parameters: z.object({}),
      permission: "test",
    });
    expect(tool.timeoutMs).toBeUndefined();
  });
});

/**
 * src/tool/askUser 单元测试
 *
 * 测试范围:
 *   - 通过 ToolContext.askUser 回调的路径
 *   - 缺少 context 时通过 EventBus 的路径（超时兜底）
 *   - 用户取消场景
 *
 * 策略: mock.module 仅替换 @/core/logging/logger；Bus 使用真实模块 +
 * spyOn 采集 publish/subscribe 调用，避免 mock.module 跨文件泄漏。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ToolContext } from "@/tool/types";

// ── Mock 外部依赖 ──────────────────────────────────────────────────

mock.module("@/core/logging/logger", () => ({
  createLogger: () => ({ debug: () => {}, error: () => {}, info: () => {}, warn: () => {} }),
}));

// NOTE: 不 mock @/bus 和 @/core/id — mock.module 存在跨文件泄漏问题。
// @/bus 使用真实模块 + spyOn；prefixedId 是纯函数，无需 mock。

import { globalBus, AppEvent } from "@/bus";
import { __resetGlobalBusForTest } from "@/bus";
import { askUserQuestionTool } from "@/tool/askUser";

let publishSpy: ReturnType<typeof spyOn>;
let subscribeSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  __resetGlobalBusForTest();
  publishSpy = spyOn(globalBus, "publish");
  subscribeSpy = spyOn(globalBus, "subscribe").mockImplementation(() => () => {});
});

afterAll(() => {
  mock.restore();
});

afterEach(() => {
  publishSpy.mockClear();
  subscribeSpy.mockClear();
});

// ═══════════════════════════════════════════════════════════════════
// 通过 ToolContext.askUser 回调
// ═══════════════════════════════════════════════════════════════════
describe("askUserQuestionTool — callback 路径", () => {
  const ctxWithCallback: ToolContext = {
    sessionId: "s1",
    messageId: "m1",
    askUser: mock(async () => "选项 A"),
  };

  afterEach(() => {
    (ctxWithCallback.askUser as ReturnType<typeof mock>).mockClear();
  });

  it("应通过 askUser 回调返回答案", async () => {
    (ctxWithCallback.askUser as ReturnType<typeof mock>).mockResolvedValueOnce("选项 A");
    const r = (await askUserQuestionTool.execute({ question: "请选择方案" }, ctxWithCallback)) as Record<
      string,
      unknown
    >;

    expect(r.success).toBe(true);
    expect(r.answer).toBe("选项 A");
    expect(r.question).toBe("请选择方案");
  });

  it("用户取消时应返回 cancelled", async () => {
    (ctxWithCallback.askUser as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("取消"));
    const r = (await askUserQuestionTool.execute({ question: "确认?" }, ctxWithCallback)) as Record<string, unknown>;

    expect(r.success).toBe(false);
    expect(r.cancelled).toBe(true);
  });

  it("应传递 multiSelect 和 options", async () => {
    (ctxWithCallback.askUser as ReturnType<typeof mock>).mockResolvedValueOnce(["A", "B"]);
    const opts = [
      { label: "选项A", value: "A", description: "描述A" },
      { label: "选项B", value: "B", description: "描述B" },
    ];
    const r = (await askUserQuestionTool.execute(
      { question: "多选", options: opts, multiSelect: true },
      ctxWithCallback,
    )) as Record<string, unknown>;

    expect(r.success).toBe(true);
    expect(r.answer).toEqual(["A", "B"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 通过 EventBus 路径（无 context）
// ═══════════════════════════════════════════════════════════════════
describe("askUserQuestionTool — EventBus 路径", () => {
  /** 从 publishSpy 调用中提取最后一次 publish 的载荷 */
  function lastPublishedProps(): Record<string, unknown> {
    const lastCall = publishSpy.mock.calls[publishSpy.mock.calls.length - 1];
    return lastCall ? (lastCall[1] as Record<string, unknown>) : {};
  }

  it("应发布 UserInputRequested 事件", async () => {
    // 不传 context，走 EventBus 路径
    // Promise 不会在测试中 resolve（需要事件响应），用 setTimeout 超时兜底
    const timer = setTimeout(() => {}, 10000);

    // 触发执行但不 await（会超时）
    askUserQuestionTool.execute({ question: "测试问题" });
    // 给事件循环一个 tick 来执行 publish
    await new Promise((r) => setTimeout(r, 10));

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const props = lastPublishedProps();
    expect(props).not.toBeNull();
    expect(props.question).toBe("测试问题");

    clearTimeout(timer);
  });

  it("应包含 requestId 和所有参数", async () => {
    askUserQuestionTool.execute({
      question: "选择语言",
      options: [{ label: "TS", value: "ts" }],
      defaultValue: "ts",
      placeholder: "输入语言",
    });
    await new Promise((r) => setTimeout(r, 10));

    const props = lastPublishedProps();
    expect(props.requestId).toMatch(/^ask_/);
    expect(props.defaultValue).toBe("ts");
    expect(props.placeholder).toBe("输入语言");
    expect(Array.isArray(props.options)).toBe(true);
  });
});

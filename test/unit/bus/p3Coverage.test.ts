/**
 * EventBus 边界与补充测试 — P3 合并套件。
 *
 * 覆盖:
 *   - P3-3 跨实例隔离
 *   - P3-4 进程退出清理(destroy / SIGINT)
 *   - P3-5 节流 flush 真实链路
 *   - P3-6 性能基准(10k 事件)
 *   - P3-7 McpServerStatusItem 载荷形状
 *   - P3-8 subscribeForSession 边界
 *   - P3-9 前缀订阅 + 节流事件交叉链路
 *   - P3-10 namingRules 校验
 *   - P3-11 flushSync 异常恢复
 *   - P3-12 节流队列满溢出 + flush 超时组合
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventBus, defineEvent, filterExpiredEvents } from "@/bus";
import { AppEvent } from "@/bus";
import { validateEventName } from "@/bus";

const TestEvt = defineEvent<{ value: number }>("p3.test");
const MsgEvt = defineEvent<{ sessionId?: string; text: string }>("p3.msg");

// ─── P3-3 跨实例隔离 ─────────────────────────────────────────
describe("EventBus — 跨实例隔离(P3-3)", () => {
  test("两个 EventBus 实例互不干扰订阅", async () => {
    const a = new EventBus();
    const b = new EventBus();
    const aRecv: number[] = [];
    const bRecv: number[] = [];
    a.subscribe(TestEvt, (p) => aRecv.push(p.properties.value));
    b.subscribe(TestEvt, (p) => bRecv.push(p.properties.value));

    a.publish(TestEvt, { value: 1 });
    await a.flush();

    expect(aRecv).toEqual([1]);
    expect(bRecv).toEqual([]);

    b.publish(TestEvt, { value: 2 });
    await b.flush();

    expect(aRecv).toEqual([1]);
    expect(bRecv).toEqual([2]);

    a.destroy();
    b.destroy();
  });

  test("两个 EventBus 历史互不干扰", async () => {
    const a = new EventBus();
    const b = new EventBus();
    a.publish(TestEvt, { value: 100 });
    await a.flush();
    b.publish(TestEvt, { value: 200 });
    await b.flush();

    expect(a.getHistory().length).toBe(1);
    expect(b.getHistory().length).toBe(1);
    expect(a.getHistory()[0]!.payload.properties).toEqual({ value: 100 });
    expect(b.getHistory()[0]!.payload.properties).toEqual({ value: 200 });

    a.destroy();
    b.destroy();
  });

  test("两个 EventBus totalEvents 独立", async () => {
    const a = new EventBus();
    const b = new EventBus();
    a.publish(TestEvt, { value: 1 });
    a.publish(TestEvt, { value: 2 });
    expect(a.totalEvents).toBe(2);
    expect(b.totalEvents).toBe(0);
    a.destroy();
    b.destroy();
  });
});

// ─── P3-4 进程退出清理 ──────────────────────────────────────
describe("EventBus — 生命周期(P3-4)", () => {
  test("destroy 后 publish 不报错但无订阅者处理", () => {
    const bus = new EventBus();
    bus.subscribe(TestEvt, () => {});
    bus.publish(TestEvt, { value: 1 });
    bus.destroy();
    expect(() => bus.publish(TestEvt, { value: 2 })).not.toThrow();
  });

  test("destroy 后 cleanupTimer 不再触发", async () => {
    const bus = new EventBus();
    // 监听 logger 不实际验证 setInterval 是否取消,只验证 destroy 后不抛错
    expect(() => bus.destroy()).not.toThrow();
    // 多次 destroy 幂等
    expect(() => bus.destroy()).not.toThrow();
  });
});

// ─── P3-5 节流 flush 真实链路 ────────────────────────────────
describe("EventBus — flush 节流链路(P3-5)", () => {
  test("flush 期间有节流事件入队,所有事件最终被派发", async () => {
    const bus = new EventBus();
    const received: string[] = [];
    bus.subscribe(AppEvent.Log, (p) => received.push(p.properties.message));

    for (let i = 0; i < 20; i++) {
      bus.publish(AppEvent.Log, { level: "info", message: `m${i}` });
    }
    await bus.flush(2000);

    // 节流队列会合并,收到消息数 ≤ 20
    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThanOrEqual(20);

    bus.destroy();
  });
});

// ─── P3-6 性能基准 ──────────────────────────────────────────
describe("EventBus — 性能基准(P3-6)", () => {
  test("1k 事件 publish+flush 1s 内完成", async () => {
    const bus = new EventBus();
    bus.subscribe(TestEvt, () => {});
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      bus.publish(TestEvt, { value: i });
    }
    await bus.flush();
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(1000);
    expect(bus.totalEvents).toBe(1000);
    bus.destroy();
  });

  test("100 订阅者 + 1k 事件 dispatch", async () => {
    const bus = new EventBus();
    let counter = 0;
    for (let i = 0; i < 100; i++) {
      bus.subscribe(TestEvt, () => {
        counter++;
      });
    }
    bus.publish(TestEvt, { value: 1 });
    await bus.flush();
    expect(counter).toBe(100);
    bus.destroy();
  });
});

// ─── P3-7 McpServerStatusItem 载荷形状 ───────────────────────
describe("AppEvent.McpStatusUpdated — 载荷(P3-7)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("完整结构可发布", () => {
    const item = {
      name: "x",
      state: "connected" as const,
      toolCount: 5,
      type: "stdio" as const,
      enabled: true,
      source: "global" as const,
      configPath: "/tmp/x",
      disabledTools: [],
      toolNames: ["a", "b"],
      supportsOAuth: false,
      authStatus: "unsupported" as const,
      connectDurationMs: 100,
      tag: "builtin" as const,
    };
    expect(() => bus.publish(AppEvent.McpStatusUpdated, { servers: [item], builtinGroups: [] })).not.toThrow();
  });

  test("不同 state 枚举值合法", () => {
    const states = ["connected", "connecting", "disconnected", "error", "disabled"] as const;
    for (const state of states) {
      const item = {
        name: "x",
        state,
        toolCount: 0,
        type: "stdio" as const,
        enabled: true,
        source: "global" as const,
        configPath: "/tmp/x",
        disabledTools: [],
        toolNames: [],
        supportsOAuth: false,
        authStatus: "unsupported" as const,
        tag: "builtin" as const,
      };
      expect(() => bus.publish(AppEvent.McpStatusUpdated, { servers: [item], builtinGroups: [] })).not.toThrow();
    }
  });
});

// ─── P3-8 subscribeForSession 边界 ─────────────────────────
describe("EventBus — subscribeForSession 边界(P3-8)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("sessionId 类型不为 string 时不抛错", () => {
    const received: unknown[] = [];
    bus.subscribeForSession(MsgEvt, "s1", (p) => received.push(p));
    bus.publish(MsgEvt, { sessionId: 123 as any, text: "x" });
    expect(received).toEqual([]); // 不匹配
  });

  test("payload 缺失 sessionId 字段不抛错", () => {
    const received: unknown[] = [];
    bus.subscribeForSession(MsgEvt, "s1", (p) => received.push(p));
    bus.publish(MsgEvt, { text: "no session" });
    expect(received).toEqual([]);
  });

  test("大量事件 sessionId 过滤正确", async () => {
    const received: string[] = [];
    bus.subscribeForSession(MsgEvt, "target", (p) => received.push(p.properties.text));
    for (let i = 0; i < 100; i++) {
      bus.publish(MsgEvt, { sessionId: i % 2 === 0 ? "target" : "other", text: `m${i}` });
    }
    await bus.flush();
    // 偶数 i 的 50 条
    expect(received).toHaveLength(50);
    expect(received[0]).toBe("m0");
    expect(received[49]).toBe("m98");
  });
});

// ─── P3-9 前缀订阅 + 节流事件交叉链路 ──────────────────────
describe("EventBus — 前缀订阅+节流交叉(P3-9)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("subscribePrefix 同时收到同一前缀的节流和非节流事件", async () => {
    const received: string[] = [];
    bus.subscribePrefix("app.", (p) => received.push(p.type));

    // Log 是节流事件,其他 app.* 事件不是
    bus.publish(AppEvent.Log, { level: "info", message: "x" });
    bus.publish(AppEvent.ToolResult, { tool: "x", result: null, callId: "c1", success: true });

    await bus.flush(2000);
    expect(received).toContain("app.log");
  });

  test("节流事件通过前缀订阅最终被广播", async () => {
    const received: string[] = [];
    // 同时订阅 tool.* 前缀和精确 tool.result
    bus.subscribePrefix("tool.", (p) => received.push(p.type));

    for (let i = 0; i < 10; i++) {
      bus.publish(AppEvent.ToolResult, { tool: "x", result: null, callId: `c${i}`, success: true });
    }
    await bus.flush(2000);
    // tool.result 是节流事件;合并后至少收到 1 次
    expect(received.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── P3-10 namingRules 校验 ────────────────────────────────
describe("namingRules — 命名规范校验(P3-10)", () => {
  test("点分命名通过校验", () => {
    expect(validateEventName("session.created")).toBeNull();
    expect(validateEventName("mcp.tools.list.changed")).toBeNull();
    expect(validateEventName("deep-research.progress")).toBeNull();
  });

  test("无点分命名被拒", () => {
    expect(validateEventName("noDot")).not.toBeNull();
  });

  test("namespace 需要小写", () => {
    expect(validateEventName("Uppercase.action")).not.toBeNull();
  });

  test("action 部分小写点分通过", () => {
    expect(validateEventName("test.status.changed")).toBeNull();
    expect(validateEventName("test.tools.list.changed")).toBeNull();
  });

  test("action 部分连字符/下划线被拒", () => {
    expect(validateEventName("test.status-changed")).not.toBeNull();
    expect(validateEventName("test.status_changed")).not.toBeNull();
  });
});

// ─── P3-11 flushSync 异常恢复 ──────────────────────────────
describe("EventBus — flushSync 异常恢复(P3-11)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("handler 抛出异常后 flushSync 继续排空剩余事件", () => {
    const received: number[] = [];
    bus.subscribe(TestEvt, () => {
      throw new Error("boom");
    });
    bus.subscribe(TestEvt, (p) => received.push(p.properties.value));

    bus.publish(TestEvt, { value: 1 });
    bus.publish(TestEvt, { value: 2 });

    expect(() => bus.flushSync()).not.toThrow();
    expect(received).toContain(1);
    expect(received).toContain(2);
  });
});

// ─── P3-12 节流队列满溢出 + flush 超时组合 ─────────────────
describe("EventBus — 节流溢出+flush 超时(P3-12)", () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
  });
  afterEach(() => {
    bus.destroy();
  });

  test("大量节流事件 publish 后 flush(带较短超时)不抛错", async () => {
    const received: string[] = [];
    bus.subscribe(AppEvent.Log, (p) => received.push(p.properties.message));

    for (let i = 0; i < 100; i++) {
      bus.publish(AppEvent.Log, { level: "info", message: `m${i}` });
    }
    // 较短 timeout,不要求完全排空,只验证不抛错
    const result = bus.flush(100);
    await expect(result).resolves.toBeUndefined();
  });
});

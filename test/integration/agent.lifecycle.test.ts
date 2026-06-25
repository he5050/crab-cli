/**
 * Agent 生命周期集成测试
 *
 * 测试 Agent 生命周期的完整流程:
 *   - Agent 启动和初始化
 *   - 生命周期钩子触发
 *   - 状态转换
 *   - 错误处理
 *   - 完成和清理
 *
 * 边界:
 *   1. 使用 Mock Agent 模拟真实场景
 *   2. 验证钩子调用顺序
 *   3. 测试错误隔离
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LifecycleHookManager } from "@/agent/session/hookManager";
import { type HookContext, type LifecycleEvent, createLifecycleHooks } from "@/agent/session/hookManager";
import type { HeartbeatMonitor } from "@/agent/runtime/heartbeat";
import { type HeartbeatStatus, createHeartbeatMonitor } from "@/agent/runtime/heartbeat";

// ─── Mock Agent 实现 ─────────────────────────────────────────────────────

interface MockAgentConfig {
  id: string;
  name: string;
  steps?: number;
  failOnStep?: number;
  failOnStart?: boolean;
}

class MockLifecycleAgent {
  readonly id: string;
  readonly name: string;
  private state: "idle" | "running" | "completed" | "failed" = "idle";
  private stepIndex = 0;
  private hooks: LifecycleHookManager;
  private heartbeat?: HeartbeatMonitor;
  private readonly maxSteps: number;
  private readonly failOnStep?: number;
  private readonly failOnStart: boolean;

  constructor(config: MockAgentConfig, hooks: LifecycleHookManager) {
    this.id = config.id;
    this.name = config.name;
    this.maxSteps = config.steps ?? 3;
    this.failOnStep = config.failOnStep;
    this.failOnStart = config.failOnStart ?? false;
    this.hooks = hooks;
  }

  async start(): Promise<void> {
    await this.hooks.emit("beforeStart", {
      agentName: this.name,
      sessionId: this.id,
    });

    if (this.failOnStart) {
      const error = new Error(`${this.id} 启动失败`);
      await this.hooks.emit("onError", {
        agentName: this.name,
        error,
        sessionId: this.id,
      });
      this.state = "failed";
      return;
    }

    this.state = "running";
    await this.hooks.emit("afterStart", {
      agentName: this.name,
      sessionId: this.id,
    });
  }

  async run(): Promise<void> {
    while (this.stepIndex < this.maxSteps && this.state === "running") {
      await this.hooks.emit("beforeStep", {
        agentName: this.name,
        sessionId: this.id,
        stepIndex: this.stepIndex,
      });

      // 模拟工具调用
      await this.hooks.emit("onToolCall", {
        agentName: this.name,
        sessionId: this.id,
        stepIndex: this.stepIndex,
        toolName: "mock_tool",
      });

      // 模拟工具执行
      const toolResult = { step: this.stepIndex, success: true };
      await this.hooks.emit("onToolResult", {
        agentName: this.name,
        data: toolResult,
        sessionId: this.id,
        stepIndex: this.stepIndex,
        toolName: "mock_tool",
      });

      // 检查是否失败
      if (this.failOnStep === this.stepIndex) {
        const error = new Error(`${this.id} 在步骤 ${this.stepIndex} 失败`);
        await this.hooks.emit("onError", {
          agentName: this.name,
          error,
          sessionId: this.id,
          stepIndex: this.stepIndex,
        });
        this.state = "failed";
        return;
      }

      await this.hooks.emit("afterStep", {
        agentName: this.name,
        sessionId: this.id,
        stepIndex: this.stepIndex,
      });

      this.stepIndex++;
    }

    if (this.state === "running") {
      this.state = "completed";
      await this.hooks.emit("onComplete", {
        agentName: this.name,
        data: { totalSteps: this.stepIndex },
        sessionId: this.id,
      });
    }
  }

  async cancel(): Promise<void> {
    this.state = "idle";
    await this.hooks.emit("onCancelled", {
      agentName: this.name,
      sessionId: this.id,
    });
  }

  getState() {
    return this.state;
  }

  getStepIndex() {
    return this.stepIndex;
  }

  attachHeartbeat(heartbeat: HeartbeatMonitor) {
    this.heartbeat = heartbeat;
  }
}

// ─── 测试套件 ─────────────────────────────────────────────────────

describe("Agent 生命周期集成", () => {
  let hooks: LifecycleHookManager;
  let events: { event: LifecycleEvent; context: HookContext }[];

  beforeEach(() => {
    hooks = createLifecycleHooks();
    events = [];
  });

  afterEach(() => {
    hooks.clear();
    events = [];
  });

  describe("完整生命周期流程", () => {
    test("Agent 成功完成所有步骤", async () => {
      // 注册钩子记录所有事件
      hooks.on("beforeStart", (ctx) => {
        events.push({ context: ctx, event: "beforeStart" });
      });
      hooks.on("afterStart", (ctx) => {
        events.push({ context: ctx, event: "afterStart" });
      });
      hooks.on("beforeStep", (ctx) => {
        events.push({ context: ctx, event: "beforeStep" });
      });
      hooks.on("afterStep", (ctx) => {
        events.push({ context: ctx, event: "afterStep" });
      });
      hooks.on("onToolCall", (ctx) => {
        events.push({ context: ctx, event: "onToolCall" });
      });
      hooks.on("onToolResult", (ctx) => {
        events.push({ context: ctx, event: "onToolResult" });
      });
      hooks.on("onComplete", (ctx) => {
        events.push({ context: ctx, event: "onComplete" });
      });

      const agent = new MockLifecycleAgent({ id: "agent-1", name: "TestAgent", steps: 2 }, hooks);

      await agent.start();
      expect(agent.getState()).toBe("running");

      await agent.run();
      expect(agent.getState()).toBe("completed");
      expect(agent.getStepIndex()).toBe(2);

      // 验证事件顺序
      expect(events.map((e) => e.event)).toEqual([
        "beforeStart",
        "afterStart",
        "beforeStep",
        "onToolCall",
        "onToolResult",
        "afterStep",
        "beforeStep",
        "onToolCall",
        "onToolResult",
        "afterStep",
        "onComplete",
      ]);

      // 验证 context 数据
      const completeEvent = events.find((e) => e.event === "onComplete");
      expect(completeEvent?.context.data).toEqual({ totalSteps: 2 });
    });

    test("Agent 在步骤中失败", async () => {
      hooks.on("beforeStart", (ctx) => {
        events.push({ context: ctx, event: "beforeStart" });
      });
      hooks.on("afterStart", (ctx) => {
        events.push({ context: ctx, event: "afterStart" });
      });
      hooks.on("beforeStep", (ctx) => {
        events.push({ context: ctx, event: "beforeStep" });
      });
      hooks.on("onToolCall", (ctx) => {
        events.push({ context: ctx, event: "onToolCall" });
      });
      hooks.on("onToolResult", (ctx) => {
        events.push({ context: ctx, event: "onToolResult" });
      });
      hooks.on("onError", (ctx) => {
        events.push({ context: ctx, event: "onError" });
      });

      const agent = new MockLifecycleAgent({ failOnStep: 1, id: "agent-fail", name: "FailingAgent", steps: 3 }, hooks);

      await agent.start();
      await agent.run();

      expect(agent.getState()).toBe("failed");

      // 验证错误事件
      const errorEvent = events.find((e) => e.event === "onError");
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.context.error).toBeDefined();
      expect(errorEvent?.context.error?.message).toContain("在步骤 1 失败");
      expect(errorEvent?.context.stepIndex).toBe(1);
    });

    test("Agent 启动失败", async () => {
      hooks.on("beforeStart", (ctx) => {
        events.push({ context: ctx, event: "beforeStart" });
      });
      hooks.on("onError", (ctx) => {
        events.push({ context: ctx, event: "onError" });
      });

      const agent = new MockLifecycleAgent({ failOnStart: true, id: "agent-bad", name: "BadAgent" }, hooks);

      await agent.start();

      expect(agent.getState()).toBe("failed");

      const errorEvent = events.find((e) => e.event === "onError");
      expect(errorEvent).toBeDefined();
    });
  });

  describe("生命周期钩子隔离", () => {
    test("钩子错误不中断 Agent 执行", async () => {
      hooks.on("beforeStep", () => {
        throw new Error("钩子错误");
      });
      hooks.on("afterStep", (ctx) => {
        events.push({ context: ctx, event: "afterStep" });
      });

      const agent = new MockLifecycleAgent({ id: "agent-resilient", name: "ResilientAgent", steps: 2 }, hooks);

      await agent.start();
      await agent.run();

      // Agent 仍应完成
      expect(agent.getState()).toBe("completed");
      // AfterStep 仍应被调用
      expect(events.filter((e) => e.event === "afterStep")).toHaveLength(2);
    });

    test("异步钩子错误不中断 Agent 执行", async () => {
      hooks.on("onToolCall", async () => {
        throw new Error("异步钩子错误");
      });
      hooks.on("onToolResult", (ctx) => {
        events.push({ context: ctx, event: "onToolResult" });
      });

      const agent = new MockLifecycleAgent({ id: "agent-async", name: "AsyncAgent", steps: 1 }, hooks);

      await agent.start();
      await agent.run();

      expect(agent.getState()).toBe("completed");
    });
  });

  describe("生命周期与心跳集成", () => {
    test("心跳监控 Agent 执行", async () => {
      let lastHeartbeatStatus: HeartbeatStatus = "stopped";

      const heartbeat = createHeartbeatMonitor({
        intervalMs: 50,
        maxMissedBeats: 3,
        timeoutMs: 200,
      });

      heartbeat.onHeartbeat((evt) => {
        lastHeartbeatStatus = evt.status;
      });

      const agent = new MockLifecycleAgent({ id: "agent-beat", name: "HeartbeatAgent", steps: 2 }, hooks);
      agent.attachHeartbeat(heartbeat);

      heartbeat.start("session-beat");
      expect(heartbeat.status).toBe("running");

      await agent.start();
      agent.run(); // 不等待，让心跳运行

      // 发送几个心跳
      heartbeat.ping();
      heartbeat.ping();
      heartbeat.ping();

      // 等待检查间隔
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(heartbeat.beatCount).toBeGreaterThan(0);

      heartbeat.stop();
      expect(heartbeat.status).toBe("stopped");
    });

    test("心跳超时检测", (done) => {
      const heartbeat = createHeartbeatMonitor({
        intervalMs: 30,
        maxMissedBeats: 1,
        timeoutMs: 100,
      });

      heartbeat.onHeartbeat((evt) => {
        if (evt.status === "timeout") {
          expect(evt.missedBeats).toBeGreaterThan(0);
          heartbeat.stop();
          done();
        }
      });

      heartbeat.start("session-timeout");

      // 不调用 ping，模拟心跳停止
    });
  });

  describe("生命周期钩子优先级", () => {
    test("高优先级钩子先执行", async () => {
      const order: string[] = [];

      hooks.on(
        "onComplete",
        () => {
          order.push("low");
        },
        { priority: 0 },
      );
      hooks.on(
        "onComplete",
        () => {
          order.push("medium");
        },
        { priority: 50 },
      );
      hooks.on(
        "onComplete",
        () => {
          order.push("high");
        },
        { priority: 100 },
      );

      await hooks.emit("onComplete", {});

      expect(order).toEqual(["high", "medium", "low"]);
    });

    test("同优先级按注册顺序执行", async () => {
      const order: string[] = [];

      hooks.on("onComplete", () => {
        order.push("first");
      });
      hooks.on("onComplete", () => {
        order.push("second");
      });
      hooks.on("onComplete", () => {
        order.push("third");
      });

      await hooks.emit("onComplete", {});

      expect(order).toEqual(["first", "second", "third"]);
    });
  });

  describe("一次性钩子", () => {
    test("once 钩子只执行一次", async () => {
      let count = 0;
      hooks.once("onComplete", () => {
        count++;
      });

      await hooks.emit("onComplete", {});
      await hooks.emit("onComplete", {});
      await hooks.emit("onComplete", {});

      expect(count).toBe(1);
      expect(hooks.getHookCount("onComplete")).toBe(0);
    });

    test("once 钩子执行后自动清理", async () => {
      hooks.once("onComplete", () => {});

      expect(hooks.getHookCount("onComplete")).toBe(1);

      await hooks.emit("onComplete", {});

      expect(hooks.getHookCount("onComplete")).toBe(0);
    });
  });

  describe("状态查询", () => {
    test("getHookCount 返回正确的钩子数量", () => {
      hooks.on("beforeStart", () => {});
      hooks.on("afterStart", () => {});
      hooks.on("onComplete", () => {});

      expect(hooks.getHookCount("beforeStart")).toBe(1);
      expect(hooks.getHookCount("afterStart")).toBe(1);
      expect(hooks.getHookCount("onComplete")).toBe(1);
      expect(hooks.getHookCount()).toBe(3);
    });

    test("debug 返回调试信息", () => {
      hooks.on("beforeStart", () => {});
      hooks.on("onError", () => {});

      const info = hooks.debug();

      expect(info["beforeStart"]).toBe(1);
      expect(info["onError"]).toBe(1);
      expect(info["onComplete"]).toBeUndefined(); // Debug() 只返回有钩子的事件
    });

    test("clear 清除所有钩子", () => {
      hooks.on("beforeStart", () => {});
      hooks.on("onError", () => {});

      hooks.clear();

      expect(hooks.getHookCount()).toBe(0);
    });
  });
});

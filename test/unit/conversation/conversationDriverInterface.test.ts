/**
 * ConversationDriver 接口契约测试
 *
 * 覆盖 P2-3 重构:Agent 与 Conversation 解耦
 *   1. 接口导出与类型完整性
 *   2. Mock Driver 实现满足接口契约
 *   3. SendMessageOptions / 事件名常量正确
 *   4. 事件订阅/退订生命周期
 */

import { describe, expect, it } from "bun:test";
import type {
  ConversationDriver,
  ConversationDriverEvent,
  ConversationDriverListener,
  SendMessageOptions,
} from "@/conversation/types/driver";
import type { ConversationResult } from "@/conversation";
import type { ModelMessage } from "ai";
import type { AgentPersistentState } from "@/agent/core/state";

/**
 * Mock 实现，用于验证接口契约
 */
class MockConversationDriver implements ConversationDriver {
  messages: ModelMessage[] = [];
  sentOptions: SendMessageOptions[] = [];
  aborted = false;
  listeners = new Map<ConversationDriverEvent, Set<ConversationDriverListener>>();
  restoredState: AgentPersistentState | null = null;

  async sendMessage(content: string): Promise<ConversationResult>;
  async sendMessage(options: SendMessageOptions): Promise<void>;
  async sendMessage(input: string | SendMessageOptions): Promise<ConversationResult | void> {
    const options = typeof input === "string" ? { content: input } : input;
    this.sentOptions.push(options);
    if (typeof input === "string") {
      return { ok: true, text: "", toolRounds: 0 };
    }
  }

  getMessages(): readonly ModelMessage[] {
    return this.messages;
  }

  abort(reason?: string): void {
    this.aborted = true;
  }

  on(event: ConversationDriverEvent, listener: ConversationDriverListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)!.delete(listener);
  }

  restoreState(state: AgentPersistentState): void {
    this.restoredState = state;
  }

  getState(): AgentPersistentState {
    return {} as AgentPersistentState;
  }

  /** 测试辅助:模拟触发事件 */
  emit(event: ConversationDriverEvent, payload: unknown): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const l of set) {
        l(payload);
      }
    }
  }
}

describe("ConversationDriver 接口契约 (P2-3)", () => {
  it("MockDriver 实现完整接口", () => {
    const driver: ConversationDriver = new MockConversationDriver();
    expect(driver).toBeDefined();
    expect(typeof driver.sendMessage).toBe("function");
    expect(typeof driver.getMessages).toBe("function");
    expect(typeof driver.abort).toBe("function");
    expect(typeof driver.on).toBe("function");
    expect(typeof driver.restoreState).toBe("function");
    expect(typeof driver.getState).toBe("function");
  });

  it("sendMessage 接收 SendMessageOptions", async () => {
    const driver = new MockConversationDriver();
    await driver.sendMessage({
      abortSignal: undefined,
      content: "Hello",
      metadata: { source: "test" },
      sessionId: "sess_1",
    });
    expect(driver.sentOptions).toHaveLength(1);
    expect(driver.sentOptions[0]!.content).toBe("Hello");
    expect(driver.sentOptions[0]!.sessionId).toBe("sess_1");
  });

  it("getMessages 返回只读数组", () => {
    const driver = new MockConversationDriver();
    driver.messages.push({ content: "Hi", role: "user" });
    const messages = driver.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    // TypeScript readonly 防止 push，但运行时仍可写
  });

  it("abort 标记中断状态", () => {
    const driver = new MockConversationDriver();
    expect(driver.aborted).toBe(false);
    driver.abort("user_requested");
    expect(driver.aborted).toBe(true);
  });

  it("on 订阅事件 + 返回退订函数", () => {
    const driver = new MockConversationDriver();
    let count = 0;
    const off = driver.on("message", () => {
      count++;
    });
    driver.emit("message", { text: "hello" });
    expect(count).toBe(1);
    // 退订
    off();
    driver.emit("message", { text: "world" });
    expect(count).toBe(1);
  });

  it("on 支持多监听者", () => {
    const driver = new MockConversationDriver();
    let countA = 0,
      countB = 0;
    driver.on("complete", () => countA++);
    driver.on("complete", () => countB++);
    driver.emit("complete", null);
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it("restoreState 接收 AgentPersistentState", () => {
    const driver = new MockConversationDriver();
    const state = {} as AgentPersistentState;
    driver.restoreState(state);
    expect(driver.restoredState).toBe(state);
  });

  it("getState 返回 AgentPersistentState", () => {
    const driver = new MockConversationDriver();
    const state = driver.getState();
    expect(state).toBeDefined();
  });

  it("支持所有 6 种事件名", () => {
    const driver = new MockConversationDriver();
    const events: ConversationDriverEvent[] = ["message", "tool-call", "tool-result", "error", "complete", "aborted"];
    const received: string[] = [];
    for (const evt of events) {
      driver.on(evt, (p) => received.push(`${evt}:${String(p)}`));
    }
    for (const evt of events) {
      driver.emit(evt, evt);
    }
    expect(received).toHaveLength(6);
  });
});

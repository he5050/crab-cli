/**
 * LlmConfigState 值对象测试
 */

import { describe, expect, it } from "bun:test";
import { LlmConfigState, type LlmConfigSnapshot } from "@/conversation/context/llmConfig";

const validSnapshot: LlmConfigSnapshot = {
  modelId: "claude-sonnet-4-6",
  providerId: "anthropic",
  temperature: 0.7,
  topP: 0.9,
};

describe("LlmConfigState (P2-5)", () => {
  it("基础构造成功", () => {
    const cfg = new LlmConfigState();
    expect(cfg).toBeDefined();
  });

  it("toSnapshot 返回只读快照", () => {
    const cfg = new LlmConfigState();
    cfg.restoreFrom(validSnapshot);
    const snap = cfg.toSnapshot();
    expect(snap.temperature).toBe(0.7);
    expect(snap.topP).toBe(0.9);
  });

  it("restoreFrom 恢复配置", () => {
    const cfg = new LlmConfigState();
    cfg.restoreFrom(validSnapshot);
    expect(cfg.modelId).toBe("claude-sonnet-4-6");
    expect(cfg.providerId).toBe("anthropic");
    expect(cfg.temperature).toBe(0.7);
    expect(cfg.topP).toBe(0.9);
  });

  it("toSnapshot 空配置", () => {
    const cfg = new LlmConfigState();
    const snap = cfg.toSnapshot();
    expect(snap.modelId).toBeUndefined();
    expect(snap.providerId).toBeUndefined();
    expect(snap.temperature).toBeUndefined();
    expect(snap.topP).toBeUndefined();
  });
});

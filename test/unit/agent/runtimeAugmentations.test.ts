/**
 * Agent 运行时增强测试。
 *
 * 测试用例:
 *   - 构建运行时增强(含 Attention 系统)
 *   - 监听 EventBus 上相关事件
 *   - 多 Agent 注册/激活生命周期
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { addAttention, clearDismissed, dismissAttention, resetAttention } from "@/agent/runtime/attention";
import { buildAgentRuntimeAugmentations } from "@/agent/runtime/augmentations";
import { getLastCompressionTime } from "@/agent/runtime/compression";
import { type AgentInfo, _resetAll, initBuiltinAgents, registerAgent, setActiveAgent } from "@/agent";
import type { AppConfigSchema } from "@/schema/config";

const mockConfig: AppConfigSchema = {
  agents: [],
  customHeaders: {},
  defaultProvider: {
    model: "gpt-4",
    provider: "openai",
  },
  devMode: false,
  maxContextTokens: 200_000,
  maxSpawnDepth: 3,
  permissions: [],
  profile: "default",
  providerConfig: {},
  proxy: { browserDebugPort: 9222, enabled: false, port: 7890, searchEngine: "duckduckgo" },
  sensitiveCommands: { commands: [], enabled: true },
  theme: "dark",
  toolResultTokenLimitPercent: 30,
} as unknown as AppConfigSchema;

const testAgent: AgentInfo = {
  description: "用于 runtime augmentation 测试",
  label: "增强测试 Agent",
  mode: "primary",
  name: "augmentation-agent",
  options: {},
  prompt: "test",
};

describe("agent 运行时增强", () => {
  beforeEach(() => {
    mock.restore();
    resetAttention();
    clearDismissed();
    _resetAll();
    initBuiltinAgents();
    registerAgent(testAgent);
    setActiveAgent("general");
  });

  test("buildAgentRuntimeAugmentations 聚合 attention 和 compression prompt", async () => {
    addAttention("检查权限边界", {
      description: "需要重点审查工具白名单",
      level: "warning",
    });

    // Warm up compression subscription before publishing event
    getLastCompressionTime();

    const before = Date.now() - 1;
    globalBus.publish(AppEvent.CompressCompleted, {
      compressionRatio: "75%",
      method: "hybrid",
      sessionId: "main",
      tokensAfter: 300,
      tokensBefore: 1200,
    });

    // EventBus.publish uses queueMicrotask — flush before asserting
    globalBus.flushSync();

    const result = buildAgentRuntimeAugmentations({
      lastCompressionTimestamp: before,
    });

    expect(result.prefix).toContain("当前关注点");
    expect(result.prefix).toContain("检查权限边界");
    expect(result.prefix).toContain("主会话发生了上下文压缩");
    expect(result.lastCompressionTimestamp).toBeGreaterThan(before);
  });

  test("AgentSession.sendMessage 会把 runtime augmentation 注入消息", async () => {
    addAttention("必须同步任务状态", { level: "critical" });
    const before = Date.now() - 1;
    globalBus.publish(AppEvent.CompressCompleted, {
      compressionRatio: "60%",
      method: "hybrid",
      sessionId: "main",
      tokensAfter: 240,
      tokensBefore: 600,
    });

    // EventBus.publish uses queueMicrotask — flush before using session
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    let capturedMessage = "";
    const mod = await import("@/agent/session/session.ts");
    mod.__setAgentSessionDepsForTesting({
      ConversationHandler: class {
        async sendMessage(content: string) {
          capturedMessage = content;
          return { error: "mocked failure", ok: false, text: "", toolRounds: 0 };
        }
        destroy() {}
        clearHistory() {}
        getMessages() {
          return capturedMessage ? [{ content: capturedMessage, role: "user" }] : [];
        }
        setAdditionalToolSchemas() {}
      } as any,
    });

    const { AgentSession } = mod;
    const session = new AgentSession("augmentation-agent", mockConfig);
    const result = await session.sendMessage("继续推进任务");
    const firstMessage = session.getMessages()[0];

    expect(result.ok).toBe(false);
    expect(result.error).toBe("mocked failure");
    expect(firstMessage?.role).toBe("user");
    expect(String(firstMessage?.content)).toContain("当前关注点");
    expect(String(firstMessage?.content)).toContain("主会话发生了上下文压缩");
    expect(String(firstMessage?.content)).toContain("继续推进任务");

    session.destroy();
  });
});

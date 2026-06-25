/**
 * 已知限制: bun:test 的 mock 注册在文件间泄漏。
 * 本文件可能受其他测试文件的 mock 影响。
 * 建议使用 --only 或隔离运行: npx bun test test/unit/compress/compactionGoalInjection.test.ts
 */

/**
 * P2-4 — maybeCompact Goal 注入测试。
 *
 * 测试 maybeCompact 在成功压缩后是否正确注入活跃 Goal 信息：
 *   - Goal status 为 "pursuing" 时注入 system 消息包含 "Goal 目标提醒"
 *   - Goal status 为 "completed" 时不注入
 *   - 无 sessionId 时不尝试注入
 *
 * 使用 installDbIsolation 提供真实 DB 环境，goalManager 直接操作 Goal 记录。
 * 仅 mock @api 使 completeLlm 返回摘要文本（与 compaction.test.ts 模式一致）。
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ModelMessage } from "ai";
import { goalManager } from "@/mission";
import { installDbIsolation } from "../../helpers/dbIsolation";

installDbIsolation("compaction-goal-");

const TEST_SESSION = "ses-goal-inject-test";

afterEach(() => {
  mock.restore();
  try {
    goalManager.clearGoal(TEST_SESSION);
  } catch {
    // ignore cleanup errors
  }
});

/**
 * 构造足够多的消息让 maybeCompact 触发压缩。
 * keepRecentTurns=4 → 至少需要 5 个 user 消息（10 条消息以上）
 */
function buildMessages(turns = 10): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let i = 0; i < turns; i++) {
    messages.push({ content: `用户消息 ${i}`, role: "user" });
    messages.push({ content: `助手回复 ${i}`, role: "assistant" });
  }
  return messages;
}

describe("P2-4 maybeCompact Goal 注入", () => {
  test("Goal status=pursuing 时注入 system 消息包含 Goal 目标提醒", async () => {
    goalManager.createGoal({
      objective: "完成核心模块开发",
      sessionId: TEST_SESSION,
    });

    const completeLlm = mock(async () => ({
      text: "## 测试摘要\nGoal 注入验证。",
    }));
    mock.module("@api", () => ({ completeLlm }));

    const { maybeCompact } = await import("@/compress/conversation/compaction");

    const messages = buildMessages();
    const mockConfig = {
      defaultProvider: { model: "test-model", provider: "test" },
      providerConfig: {},
    } as any;

    const compactionConfig = {
      keepRecentTurns: 4,
      targetRatio: 0.3,
      tokenThreshold: 1,
      toolOutputTruncateLength: 2000,
    };

    const result = await maybeCompact(messages, mockConfig, compactionConfig, TEST_SESSION);

    expect(result.compacted).toBe(true);

    // 压缩后的消息数组应包含一条 system 角色的 Goal 提醒
    const goalMessage = messages.find(
      (m) => m.role === "system" && typeof m.content === "string" && (m.content as string).includes("Goal 目标提醒"),
    );
    expect(goalMessage).toBeDefined();
    expect(goalMessage!.content as string).toContain("完成核心模块开发");
    expect(goalMessage!.content as string).toContain("pursuing");
  });

  test("Goal status=completed 时不注入", async () => {
    // 创建 Goal 然后将其标记为 achieved
    goalManager.createGoal({
      objective: "已完成任务",
      sessionId: TEST_SESSION,
    });
    goalManager.modelUpdateGoal(TEST_SESSION, {
      explanation: "目标已完成",
      status: "achieved",
    });

    const completeLlm = mock(async () => ({
      text: "## 测试摘要\ncompleted Goal 不注入验证。",
    }));
    mock.module("@api", () => ({ completeLlm }));

    const { maybeCompact } = await import("@/compress/conversation/compaction");

    const messages = buildMessages();
    const mockConfig = {
      defaultProvider: { model: "test-model", provider: "test" },
      providerConfig: {},
    } as any;

    const compactionConfig = {
      keepRecentTurns: 4,
      targetRatio: 0.3,
      tokenThreshold: 1,
      toolOutputTruncateLength: 2000,
    };

    const result = await maybeCompact(messages, mockConfig, compactionConfig, TEST_SESSION);

    expect(result.compacted).toBe(true);

    // 不应有 system 角色的 Goal 提醒
    const goalMessage = messages.find(
      (m) => m.role === "system" && typeof m.content === "string" && (m.content as string).includes("Goal 目标提醒"),
    );
    expect(goalMessage).toBeUndefined();
  });

  test("无 sessionId 时不尝试注入 Goal", async () => {
    goalManager.createGoal({
      objective: "不应被注入",
      sessionId: TEST_SESSION,
    });

    const completeLlm = mock(async () => ({
      text: "## 测试摘要\n无 sessionId 不注入验证。",
    }));
    mock.module("@api", () => ({ completeLlm }));

    const { maybeCompact } = await import("@/compress/conversation/compaction");

    const messages = buildMessages();
    const mockConfig = {
      defaultProvider: { model: "test-model", provider: "test" },
      providerConfig: {},
    } as any;

    const compactionConfig = {
      keepRecentTurns: 4,
      targetRatio: 0.3,
      tokenThreshold: 1,
      toolOutputTruncateLength: 2000,
    };

    // 注意: 不传 sessionId
    const result = await maybeCompact(messages, mockConfig, compactionConfig);

    expect(result.compacted).toBe(true);

    // 不应有 Goal 提醒消息
    const goalMessage = messages.find(
      (m) => m.role === "system" && typeof m.content === "string" && (m.content as string).includes("Goal 目标提醒"),
    );
    expect(goalMessage).toBeUndefined();
  });

  test("无 Goal 时不注入", async () => {
    // 不创建任何 Goal

    const completeLlm = mock(async () => ({
      text: "## 测试摘要\n无 Goal 不注入验证。",
    }));
    mock.module("@api", () => ({ completeLlm }));

    const { maybeCompact } = await import("@/compress/conversation/compaction");

    const messages = buildMessages();
    const mockConfig = {
      defaultProvider: { model: "test-model", provider: "test" },
      providerConfig: {},
    } as any;

    const compactionConfig = {
      keepRecentTurns: 4,
      targetRatio: 0.3,
      tokenThreshold: 1,
      toolOutputTruncateLength: 2000,
    };

    const result = await maybeCompact(messages, mockConfig, compactionConfig, TEST_SESSION);

    expect(result.compacted).toBe(true);

    // 不应有 Goal 提醒消息
    const goalMessage = messages.find(
      (m) => m.role === "system" && typeof m.content === "string" && (m.content as string).includes("Goal 目标提醒"),
    );
    expect(goalMessage).toBeUndefined();
  });
});

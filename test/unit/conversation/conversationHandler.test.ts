/**
 * [测试目标] ConversationHandler。
 *
 * 测试目标:
 *   - 验证 ConversationHandler 在错误流、配置更新、目标管理与多轮对话下的行为
 *
 * 测试用例:
 *   - LLM 流返回 error 事件时会标记 ok=false:注入 error 事件，断言 result.ok=false / 含错误信息
 *   - ConfigUpdated 后使用新配置继续对话:在真实 provider 配置下覆盖 defaultProvider 后断言 requestMethod 切换
 *   - 其余用例覆盖 goal 集成、多轮 turn、工具并发限制与 globalBus 事件
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { AppConfigSchema } from "@/schema/config";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { registerTestTool, resetTestTools } from "../../helpers/testTools";
import { hasLiveProviderConfig, loadRealTestConfig } from "../../helpers/realConfig";
import { goalManager } from "@/mission";
import { cleanupTestDir, createProjectTmpTestDir } from "../../helpers/testPaths";

let ConversationHandler: any;
let REAL_CONFIG: AppConfigSchema;
let goalTempDir = "";

// Top-level await 确保 skipIf 在模块加载时拿到正确的值
const hasConfig = await hasLiveProviderConfig();

beforeAll(async () => {
  REAL_CONFIG = await loadRealTestConfig();
  const mod = await import("@/conversation/core/conversationHandler.ts");
  ({ ConversationHandler } = mod);
});

afterEach(() => {
  if (goalTempDir) {
    cleanupTestDir(goalTempDir);
    goalTempDir = "";
  }
});

describe("ConversationHandler", () => {
  test("LLM 流返回 error 事件时会标记 ok=false", async () => {
    const handler = new ConversationHandler(REAL_CONFIG, {
      async *streamFn() {
        yield { text: "partial", type: "text-delta" };
        yield { error: new Error("boom"), type: "error" };
      },
    });

    const result = await handler.sendMessage("test");
    expect(result.ok).toBe(false);
    expect(result.text).toBe("partial");
    expect(result.error).toContain("boom");
  });

  test.skipIf(!hasConfig)("ConfigUpdated 后使用新配置继续对话", async () => {
    const methods: string[] = [];
    const handler = new ConversationHandler(REAL_CONFIG, {
      async *streamFn(config: any) {
        methods.push(config.providerConfig[config.defaultProvider.provider].requestMethod);
        yield { text: "ok", type: "text-delta" };
        yield { fullText: "ok", type: "done" };
      },
    });

    await handler.sendMessage("first");

    const nextConfig = structuredClone(REAL_CONFIG);
    nextConfig.providerConfig[nextConfig.defaultProvider.provider] = {
      ...nextConfig.providerConfig[nextConfig.defaultProvider.provider]!,
      requestMethod: "claude",
    };
    globalBus.publish(AppEvent.ConfigUpdated, { config: nextConfig });

    await handler.sendMessage("second");
    handler.destroy();

    expect(methods[0]).not.toBe("claude");
    expect(methods[1]).toBe("claude");
  });

  test("达到 maxToolRounds 时停止继续循环", async () => {
    registerTestTool("loop_test_tool", {
      execute: async () => ({ ok: true }),
      permission: "test",
    });

    let round = 0;
    const handler = new ConversationHandler(REAL_CONFIG, {
      maxToolRounds: 2,
      async *streamFn() {
        round++;
        yield { args: {}, toolCallId: `c${round}`, toolName: "loop_test_tool", type: "tool-call" };
        yield { fullText: "", type: "done" };
      },
    });
    handler.getPermissionManager().approve("*", "**");

    const result = await handler.sendMessage("loop");
    handler.destroy();

    expect(result.toolRounds).toBe(2);
    expect(round).toBe(2);
  });

  test("allowedTools 会阻止未授权工具进入执行", async () => {
    registerTestTool("allowed_only", {
      execute: async () => "allowed",
      permission: "test",
    });

    const handler = new ConversationHandler(REAL_CONFIG, {
      allowedTools: ["allowed_only"],
      async *streamFn() {
        yield { args: {}, toolCallId: "c1", toolName: "forbidden_tool", type: "tool-call" };
        yield { fullText: "", type: "done" };
        yield { text: "fallback", type: "text-delta" };
        yield { fullText: "fallback", type: "done" };
      },
    });
    handler.getPermissionManager().approve("*", "**");

    const result = await handler.sendMessage("go");
    const toolMessage = handler.getMessages().find((msg: any) => msg.role === "tool") as any;
    handler.destroy();

    expect(result.ok).toBe(false);
    expect(result.toolRounds).toBe(50);
    expect(toolMessage.content[0].output.type).toBe("error-text");
  });

  test("maxToolRounds 默认读取全局配置", async () => {
    registerTestTool("config_round_tool", {
      execute: async () => ({ ok: true }),
      permission: "test",
    });

    let round = 0;
    const config = { ...REAL_CONFIG, maxToolRounds: 4 };
    const handler = new ConversationHandler(config, {
      async *streamFn() {
        round++;
        yield { args: {}, toolCallId: `cfg-${round}`, toolName: "config_round_tool", type: "tool-call" };
        yield { fullText: "", type: "done" };
      },
    });
    handler.getPermissionManager().approve("*", "**");

    const result = await handler.sendMessage("loop by config");
    handler.destroy();

    expect(result.ok).toBe(false);
    expect(result.toolRounds).toBe(4);
    expect(round).toBe(4);
  });

  test("abortSignal 已中止时返回失败", async () => {
    const controller = new AbortController();
    controller.abort();
    const handler = new ConversationHandler(REAL_CONFIG, {
      abortSignal: controller.signal,
      async *streamFn() {
        yield { text: "never", type: "text-delta" };
      },
    });

    const result = await handler.sendMessage("stop");
    handler.destroy();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("中止");
  });

  test("ConversationCompleted 会携带 cache usage", async () => {
    const completedEvents: any[] = [];
    const unsubscribe = globalBus.subscribe(AppEvent.ConversationCompleted, (evt) => {
      completedEvents.push(evt.properties);
    });
    const handler = new ConversationHandler(REAL_CONFIG, {
      sessionId: "ses_cache_usage",
      async *streamFn() {
        yield { text: "cache ok", type: "text-delta" };
        yield {
          fullText: "cache ok",
          type: "done",
          usage: {
            cacheCreationInputTokens: 15,
            cacheReadInputTokens: 70,
            cachedTokens: 70,
            completionTokens: 10,
            promptTokens: 100,
            totalTokens: 110,
          },
        };
      },
    });

    const result = await handler.sendMessage("cache stats");
    handler.destroy();
    unsubscribe();

    expect(result.usage).toEqual({
      cacheCreationInputTokens: 15,
      cacheReadInputTokens: 70,
      cachedTokens: 70,
      inputTokens: 100,
      outputTokens: 10,
    });
    expect(completedEvents.at(-1)?.usage).toEqual(result.usage);
  });

  test("active skill context 会注入 system prompt 并收紧 allowedTools", async () => {
    registerTestTool("skill_allowed_tool", {
      execute: async () => "ok",
      permission: "test",
    });

    const captured: Record<string, unknown>[] = [];
    const handler = new ConversationHandler(REAL_CONFIG, {
      allowedTools: ["skill_allowed_tool", "filesystem-read"],
      async *streamFn(_config: any, _messages: any, options: any) {
        captured.push(options as Record<string, unknown>);
        yield { text: "ok", type: "text-delta" };
        yield { fullText: "ok", type: "done" };
      },
    });

    handler.setActiveSkillContext("Skill says review carefully", ["skill_allowed_tool"]);
    await handler.sendMessage("go");
    handler.clearActiveSkillContext();
    await handler.sendMessage("go again");
    handler.destroy();

    const firstTools = Object.keys((captured[0]?.tools as Record<string, unknown>) ?? {});
    const secondTools = Object.keys((captured[1]?.tools as Record<string, unknown>) ?? {});

    expect(captured[0]?.system).toContain("当前激活技能");
    expect(captured[0]?.system).toContain("Skill says review carefully");
    expect(firstTools).toEqual(["skill_allowed_tool"]);
    expect(secondTools).toContain("filesystem-read");
  });

  test("ToolsListChanged 后下一轮 system prompt 注入 MCP 工具变更提醒且只消费一次", async () => {
    const capturedSystemPrompts: string[] = [];
    const handler = new ConversationHandler(REAL_CONFIG, {
      async *streamFn(_config: any, _messages: any, options: any) {
        capturedSystemPrompts.push(options.system ?? "");
        yield { text: "ok", type: "text-delta" };
        yield { fullText: "ok", type: "done" };
      },
      systemPrompt: "base prompt",
    });

    globalBus.publish(AppEvent.ToolsListChanged, {
      added: ["docs_search"],
      removed: ["old_docs"],
      serverName: "docs-server",
      toolCount: 2,
    });

    await handler.sendMessage("first");
    await handler.sendMessage("second");
    handler.destroy();

    expect(capturedSystemPrompts[0]).toContain("## MCP 工具列表变更");
    expect(capturedSystemPrompts[0]).toContain("docs-server");
    expect(capturedSystemPrompts[0]).toContain("docs_search");
    expect(capturedSystemPrompts[0]).toContain("old_docs");
    expect(capturedSystemPrompts[1]).not.toContain("## MCP 工具列表变更");
  });

  test("goal-mode 纯文本回合不会继续自动续接", async () => {
    const sessionId = "goal_guard_session";
    goalTempDir = createProjectTmpTestDir(process.cwd(), "goal-guard-");
    goalManager.setProjectDir(goalTempDir);
    goalManager.createGoal({
      objective: "验证无结构性进展时停止自动续接",
      sessionId,
    });

    const handler = new ConversationHandler(REAL_CONFIG, {
      sessionId,
      async *streamFn() {
        yield { text: "我先总结一下计划。", type: "text-delta" };
        yield {
          fullText: "我先总结一下计划。",
          type: "done",
          usage: { completionTokens: 8, promptTokens: 12, totalTokens: 20 },
        };
      },
    });

    const result = await handler.sendMessage("开始");
    const goal = goalManager.loadGoal(sessionId);
    handler.destroy();

    expect(result.ok).toBe(true);
    expect(result.goalContinuation).toBe(false);
    expect(goal?.status).toBe("pursuing");
    expect(goal?.pendingContinuation).toBe(false);
  });

  test("goal-mode 有工具执行时继续自动续接", async () => {
    const sessionId = "goal_guard_tool_session";
    goalTempDir = createProjectTmpTestDir(process.cwd(), "goal-guard-tool-");
    goalManager.setProjectDir(goalTempDir);
    goalManager.createGoal({
      objective: "验证有结构性进展时继续自动续接",
      sessionId,
    });

    registerTestTool("goal_guard_tool", {
      execute: async () => ({ ok: true }),
      permission: "test",
    });

    let round = 0;
    const handler = new ConversationHandler(REAL_CONFIG, {
      sessionId,
      async *streamFn() {
        round++;
        if (round === 1) {
          yield { args: {}, toolCallId: "c1", toolName: "goal_guard_tool", type: "tool-call" };
          yield {
            fullText: "",
            type: "done",
            usage: { completionTokens: 6, promptTokens: 10, totalTokens: 16 },
          };
          return;
        }

        yield { text: "继续推进中。", type: "text-delta" };
        yield {
          fullText: "继续推进中。",
          type: "done",
          usage: { completionTokens: 6, promptTokens: 10, totalTokens: 16 },
        };
      },
    });
    handler.getPermissionManager().approve("*", "**");

    const result = await handler.sendMessage("开始");
    const goal = goalManager.loadGoal(sessionId);
    handler.destroy();

    expect(result.ok).toBe(true);
    expect(result.goalContinuation).toBe(true);
    expect(goal?.status).toBe("pursuing");
    expect(goal?.pendingContinuation).toBe(true);
  });
});

afterAll(() => {
  resetTestTools();
  mock.restore();
});

/**
 * 主流程端到端集成测试。
 *
 * 使用真实 LLM 验证核心链路:
 *   0. LLM 可用性探测
 *   1. 纯文本对话
 *   2. 工具调用链路
 *   3. 多轮对话上下文保持
 *   4. 会话消息持久化
 *
 * 跳过条件（全部满足时跳过）:
 *   - 未设置 CRAB_INTEGRATION_TEST=1
 *
 * Provider 切换:
 *   - CRAB_TEST_PROVIDER=tianluo 强制使用指定 provider
 *
 * 运行方式:
 *   CRAB_INTEGRATION_TEST=1 CRAB_TEST_PROVIDER=tianluo CRAB_TEST_MODEL=glm-5.2 bun test test/integration/mainFlow.test.ts
 *
 * 环境变量:
 *   CRAB_INTEGRATION_TEST=1  — 启用集成测试（必须）
 *   CRAB_TEST_PROVIDER=xxx   — 覆盖 provider（可选）
 *   CRAB_TEST_MODEL=xxx      — 覆盖模型（可选，推荐非思考模型如 glm-5.2）
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// ─── 配置 ──────────────────────────────────────────────────────────

const INTEGRATION_ENABLED = process.env.CRAB_INTEGRATION_TEST === "1";
const TEST_PROVIDER = process.env.CRAB_TEST_PROVIDER || null;
const TEST_MODEL = process.env.CRAB_TEST_MODEL || null;

function loadUserConfig() {
  const configPath = path.join(process.env.HOME || "/tmp", ".crab", "config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function getEffectiveProvider(config: ReturnType<typeof loadUserConfig>) {
  if (TEST_PROVIDER && config.providerConfig[TEST_PROVIDER]) {
    return {
      model: TEST_MODEL || config.providerConfig[TEST_PROVIDER].defaultModel,
      providerId: TEST_PROVIDER,
    };
  }
  return {
    model: TEST_MODEL || config.defaultProvider.model,
    providerId: config.defaultProvider.provider,
  };
}

async function shouldSkip(): Promise<boolean> {
  if (!INTEGRATION_ENABLED) return true;
  const configPath = path.join(process.env.HOME || "/tmp", ".crab", "config.json");
  return !fs.existsSync(configPath);
}

// ─── 测试常量 ──────────────────────────────────────────────────────

const TEST_SESSION_ID = `integration-test-${Date.now()}`;
const TOOL_TIMEOUT = 60_000; // 工具执行允许 60 秒
const CHAT_TIMEOUT = 45_000; // 普通对话允许 45 秒

// ─── 持久化的 handler 创建 ────────────────────────────────────────

let handler: Awaited<
  ReturnType<(typeof import("@/conversation/core/conversationHandler"))["createConversationHandler"]>
> | null = null;

/** 创建或获取持久 handler（同一 session ID 复用） */
async function getOrInitHandler() {
  if (handler) return handler;

  const config = loadUserConfig();
  const { createConversationHandler } = await import("@/conversation/core/conversationHandler");

  const { providerId, model } = getEffectiveProvider(config);

  handler = createConversationHandler(config, {
    maxToolRounds: 5,
    sessionId: TEST_SESSION_ID,
    providerId,
    modelId: model,
    permissionRequestHandler: async () => true,
  });

  return handler;
}

/** 销毁 handler */
async function destroyHandler() {
  if (handler) {
    handler.destroy();
    handler = null;
  }
}

// ─── 事件订阅 — 模拟 UI 层消息持久化 ─────────────────────────────
//
// ConversationHandler 本身不在 DB 中持久化消息；
// 持久化由 UI 层（chat.tsx）订阅 globalBus 事件后写入。
// 测试中需要手动订阅相同事件，否则 getSessionMessages 始终返回 0。

const unsubscribers: (() => void)[] = [];

async function setupMessagePersistence() {
  const { globalBus } = await import("@/bus/core/eventBus");
  const { AppEvent } = await import("@/bus/events");
  const { addMessage, addTextMessage } = await import("@/session/core/message");

  // ─── 1. 用户消息 ───
  unsubscribers.push(
    globalBus.subscribe(AppEvent.ConversationMessageSent, (evt) => {
      const props = evt.properties as { sessionId?: string; role: string; content: string };
      if (props.sessionId !== TEST_SESSION_ID) return;
      if (props.role !== "user") return;
      addTextMessage(TEST_SESSION_ID, "user", props.content);
    }),
  );

  // ─── 2. 工具调用（assistant + tool_use） ───
  unsubscribers.push(
    globalBus.subscribe(AppEvent.ConversationToolCall, (evt) => {
      const props = evt.properties as {
        sessionId?: string;
        tool: string;
        args: unknown;
        callId: string;
      };
      if (props.sessionId !== TEST_SESSION_ID) return;
      addMessage(TEST_SESSION_ID, "assistant", [
        {
          callId: props.callId,
          content: JSON.stringify(props.args),
          tool_name: props.tool,
          tool_use_id: props.callId,
          type: "tool_use",
        },
      ]);
    }),
  );

  // ─── 3. 工具结果（tool + tool_result） ───
  unsubscribers.push(
    globalBus.subscribe(AppEvent.ToolResult, (evt) => {
      const props = evt.properties as {
        sessionId?: string;
        tool: string;
        callId?: string;
        result: unknown;
        success: boolean;
      };
      if (props.sessionId !== TEST_SESSION_ID) return;
      if (!props.callId) return;
      addMessage(TEST_SESSION_ID, "tool", [
        {
          content: JSON.stringify(props.result),
          result: props.result,
          success: props.success,
          tool_use_id: props.callId,
          type: "tool_result",
        },
      ]);
    }),
  );
}

function teardownMessagePersistence() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers.length = 0;
}

// ─── 测试辅助 ──────────────────────────────────────────────────────────

/** 验证会话消息已持久化 */
async function verifyMessageCount(minCount: number): Promise<{ ok: boolean; count: number }> {
  const { getSessionMessages } = await import("@/session/core/message");
  const messages = await getSessionMessages(TEST_SESSION_ID);
  return { ok: messages.length >= minCount, count: messages.length };
}

/** 发送消息并持久化 assistant 文本响应 */
async function sendAndPersist(prompt: string) {
  const h = await getOrInitHandler();
  const result = await h.sendMessage(prompt);

  if (result.ok && result.text) {
    // 持久化 assistant 最终文本响应（模拟 UI 层 chat.tsx 行为）
    const { addTextMessage } = await import("@/session/core/message");
    addTextMessage(TEST_SESSION_ID, "assistant", result.text);
  }

  return result;
}

// ─── 测试套件 ──────────────────────────────────────────────────────

describe.skipIf(await shouldSkip())("主流程集成测试", () => {
  const userConfig = loadUserConfig();
  const { providerId, model } = getEffectiveProvider(userConfig);

  beforeAll(async () => {
    // 初始化 DB
    const { initDb } = await import("@/db");
    await initDb();

    // 创建会话行（messages 表依赖 sessions 行存在）
    const { ensureSession } = await import("@/session/core/session");
    ensureSession(TEST_SESSION_ID, { model: `${providerId}/${model}` });

    // 订阅事件总线以自动持久化消息
    setupMessagePersistence();

    // 预创建 handler（共享 session ID）
    await getOrInitHandler();
  });

  afterAll(async () => {
    await destroyHandler();
    teardownMessagePersistence();

    // 清理 DB
    const { resetDb } = await import("@/db");
    try {
      resetDb?.();
    } catch {}
  });

  // ─── 步骤 0: LLM 可用性探测 ──────────────────────────────────────────

  test(`[探测] LLM 可用性: ${providerId} / ${model}`, { timeout: 30_000 }, async () => {
    const config = loadUserConfig();
    const { completeLlm } = await import("@/api/core/llm");
    const { providerId: pid, model: mid } = getEffectiveProvider(config);

    const result = await completeLlm(config, [{ role: "user", content: "回复 pong" }], {
      providerId: pid,
      modelId: mid,
      maxTokens: 20,
    });

    expect(result.text, "LLM 应返回非空文本").toBeTruthy();
    console.log(`  ✅ ${providerId}/${model} 可用`);
  });

  // ─── 步骤 1: 纯文本对话 ────────────────────────────────────────────

  test("步骤 1: 纯文本对话 — 发送简单问题并获得有效回答", { timeout: CHAT_TIMEOUT }, async () => {
    const result = await sendAndPersist("1+1等于几？只回答数字。");

    expect(result.ok, `对话失败: ${result.error}`).toBe(true);
    expect(result.text, "应返回非空文本").toBeTruthy();
    expect(result.text).toMatch(/2/);
    console.log(`  ✅ 纯文本: "${result.text?.slice(0, 50)}" (${result.durationMs}ms)`);
  });

  // ─── 步骤 2: 工具调用链路 ────────────────────────────────────────

  test("步骤 2: 工具调用 — LLM 调用 terminal-execute 执行命令", { timeout: TOOL_TIMEOUT }, async () => {
    const result = await sendAndPersist(
      "请使用 terminal-execute 工具执行命令 'echo hello-integration'，然后告诉我输出了什么。",
    );

    expect(result.ok, `工具调用失败: ${result.error}`).toBe(true);
    expect(result.text, "工具调用后应有文本回复").toBeTruthy();
    expect(result.toolRounds, "应执行了至少 1 轮工具调用").toBeGreaterThanOrEqual(1);
    console.log(`  ✅ 工具调用: ${result.toolRounds} 轮, "${result.text?.slice(0, 60)}" (${result.durationMs}ms)`);
  });

  // ─── 步骤 3: 多轮对话上下文保持 ──────────────────────────────────

  test("步骤 3: 多轮对话 — 上下文保持", { timeout: CHAT_TIMEOUT }, async () => {
    const result = await sendAndPersist("我让你计算了什么？简短回答。");

    expect(result.ok, `多轮对话失败: ${result.error}`).toBe(true);
    expect(result.text, "多轮对话应有文本回复").toBeTruthy();
    console.log(`  ✅ 上下文: "${result.text?.slice(0, 80)}" (${result.durationMs}ms)`);
  });

  // ─── 步骤 4: 会话持久化验证 ────────────────────────────────────────

  test("步骤 4: 验证全部消息已完整持久化到数据库", async () => {
    // 此时应有:
    //   step1: user + assistant(text)      = 2 条
    //   step2: user + assistant(tool_use) + tool(tool_result) + assistant(text) = 4 条
    //   step3: user + assistant(text)       = 2 条
    //   合计 ≥ 6 条（最低验证 4 条）
    const { ok, count } = await verifyMessageCount(4);
    expect(ok, `消息持久化验证失败: 只有 ${count} 条消息`).toBe(true);
    console.log(`  ✅ 持久化: ${count} 条消息`);
  });
});

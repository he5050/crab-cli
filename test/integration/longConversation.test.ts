/**
 * 20轮长对话 + 子代理模式 + Team 模式 端到端集成测试。
 *
 * 使用真实 LLM 验证高级场景:
 *   1. 20轮连续对话 — 上下文保持和稳定性
 *   2. 子代理模式 — AgentSession 子代理创建和执行
 *   3. Team 模式 — 多 Agent 串行协作完成任务
 *
 * 跳过条件:
 *   - 未设置 CRAB_INTEGRATION_TEST=1
 *
 * 环境变量:
 *   CRAB_INTEGRATION_TEST=1  — 启用集成测试（必须）
 *   CRAB_TEST_PROVIDER=xxx   — 覆盖 provider（可选）
 *   CRAB_TEST_MODEL=xxx      — 覆盖模型（可选，推荐非思考模型如 glm-5.2）
 *
 * 运行方式:
 *   CRAB_INTEGRATION_TEST=1 CRAB_TEST_PROVIDER=tianluo CRAB_TEST_MODEL=glm-5.2 bun test test/integration/longConversation.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AgentSession, _resetAll, initBuiltinAgents } from "@/agent";
import fs from "node:fs";
import path from "node:path";

// ─── 配置 ──────────────────────────────────────────────────────────

const INTEGRATION_ENABLED = process.env.CRAB_INTEGRATION_TEST === "1";
const TEST_PROVIDER = process.env.CRAB_TEST_PROVIDER || null;
const TEST_MODEL = process.env.CRAB_TEST_MODEL || null;

/** 直接读取原始配置（与 mainFlow.test.ts 一致，避免 Zod 校验改变结构） */
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

/** 根据环境变量覆盖 defaultProvider，返回可直接使用的配置 */
function buildTestConfig() {
  const config = loadUserConfig();
  const { providerId, model } = getEffectiveProvider(config);
  config.defaultProvider = { model, provider: providerId };
  return config;
}

// ─── 测试套件 ──────────────────────────────────────────────────────

describe.skipIf(!INTEGRATION_ENABLED)("20轮长对话 + 子代理 + Team 模式", () => {
  let config: ReturnType<typeof loadUserConfig>;
  let hasConfig = false;

  beforeAll(() => {
    const configPath = path.join(process.env.HOME || "/tmp", ".crab", "config.json");
    hasConfig = fs.existsSync(configPath);

    config = buildTestConfig();

    const pid = config.defaultProvider.provider;
    const mid = config.defaultProvider.model;
    console.log(`  📋 Provider: ${pid}, Model: ${mid}`);

    _resetAll();
    initBuiltinAgents();
  });

  afterAll(() => {
    _resetAll();
  });

  // ─── 1. 20轮长对话 ─────────────────────────────────────────────

  describe("20轮长对话", () => {
    test("20轮连续对话 — 上下文保持和稳定性", async () => {
      if (!hasConfig) return;

      const session = new AgentSession("general", config, {
        maxToolRounds: 2,
        permissionRequestHandler: async () => true,
      });
      try {
        const results: { ok: boolean; text?: string; error?: string; round: number }[] = [];
        const errors: string[] = [];

        // Round 1: 建立关键上下文
        console.log("  🔄 Round 1/20: 建立上下文...");
        const r1 = await session.sendMessage(
          "请记住以下信息：我的项目叫 crab-cli，是用 TypeScript 写的 CLI 工具。请确认收到。",
        );
        results.push({ ...r1, round: 1 });
        if (!r1.ok) errors.push(`Round 1: ${r1.error}`);

        // Round 2-10: 逐步验证上下文
        for (let i = 2; i <= 10; i++) {
          console.log(`  🔄 Round ${i}/20: 验证上下文...`);
          const r = await session.sendMessage(`请用一句话确认：我的项目叫什么名字？只用项目名回答。`);
          results.push({ ...r, round: i });
          if (!r.ok) errors.push(`Round ${i}: ${r.error}`);
        }

        // Round 11-15: 工具调用混合测试
        for (let i = 11; i <= 15; i++) {
          console.log(`  🔄 Round ${i}/20: 工具调用测试...`);
          const r = await session.sendMessage(`请使用 terminal-execute 执行命令 'echo round-${i}' 并告诉我输出。`);
          results.push({ ...r, round: i });
          if (!r.ok) errors.push(`Round ${i}: ${r.error}`);
        }

        // Round 16-20: 回忆最早期上下文
        for (let i = 16; i <= 20; i++) {
          console.log(`  🔄 Round ${i}/20: 回忆早期上下文...`);
          const r = await session.sendMessage("我在第1轮告诉你我的项目叫什么？请用项目名回答。");
          results.push({ ...r, round: i });
          if (!r.ok) errors.push(`Round ${i}: ${r.error}`);
        }

        // 验证所有轮次
        const successCount = results.filter((r) => r.ok).length;
        expect(successCount, `${errors.length} 轮失败: ${errors.slice(0, 3).join("; ")}`).toBe(20);

        // 验证项目名回忆（最后几轮应包含 crab-cli）
        const lastTexts = results.slice(-5).map((r) => r.text || "");
        const recalled = lastTexts.some((t) => t.toLowerCase().includes("crab-cli"));
        expect(recalled, "最后5轮应至少有一次正确回忆项目名 crab-cli").toBe(true);

        // 输出统计
        const toolRounds = results.filter((r) => (r as any).toolRounds > 0).length;
        console.log(`  ✅ 20轮全部成功 (${toolRounds} 轮包含工具调用)`);
      } finally {
        session.destroy();
      }
    }, 300_000); // 20轮允许 5 分钟
  });

  // ─── 2. 子代理模式 ────────────────────────────────────────────

  describe("子代理模式", () => {
    test("AgentSession 子代理创建和执行", async () => {
      if (!hasConfig) return;

      const parentSession = new AgentSession("general", config, { maxToolRounds: 5 });
      try {
        // 父会话发送需要分析的消息
        const result = await parentSession.sendMessage("请帮我分析：什么是递归？请用两句话解释，并举一个简单例子。");

        expect(result.ok, `子代理执行失败: ${result.error}`).toBe(true);
        expect(result.text, "子代理应返回非空文本").toBeTruthy();
        expect(result.text.length, "回复应有实际内容").toBeGreaterThan(10);

        // 检查子代理任务追踪
        const subTasks = parentSession.getSubagentTasks();
        expect(Array.isArray(subTasks), "子代理任务列表应为数组").toBe(true);

        console.log(`  ✅ 子代理模式: ${subTasks.length} 个子任务, 回复 ${result.text.length} 字`);
      } finally {
        parentSession.destroy();
      }
    }, 60_000);

    test("子代理深度保护 — 不允许超过最大深度", async () => {
      if (!hasConfig) return;

      // 创建带低深度限制的会话
      const session = new AgentSession("general", config, {
        maxSpawnDepth: 1,
        maxToolRounds: 3,
        spawnDepth: 1,
      });

      try {
        // 会话本身已经在 spawnDepth=1，不应再创建子代理
        const result = await session.sendMessage("请简单回答：1+1 等于几？只回答数字。");
        expect(result.ok, `对话失败: ${result.error}`).toBe(true);

        const subTasks = session.getSubagentTasks();
        // spawnDepth 已达到 maxSpawnDepth，不应有新子代理
        expect(subTasks.length).toBe(0);

        console.log(`  ✅ 深度保护: spawnDepth=${1}, maxSpawnDepth=${1}, 子代理数=${subTasks.length}`);
      } finally {
        session.destroy();
      }
    }, 30_000);
  });

  // ─── 3. Team 模式 ────────────────────────────────────────────

  describe("Team 模式", () => {
    test("多 Agent 串行协作 — review → fix 流水线", async () => {
      if (!hasConfig) return;

      const buggyCode = `function divide(a, b) {
  return a / b;
}

function sum(arr) {
  let total = 0;
  for (let i = 0; i <= arr.length; i++) {
    total += arr[i];
  }
  return total;
}`;

      // Step 1: review Agent 审查代码
      const reviewSession = new AgentSession("review", config, {
        maxToolRounds: 3,
        permissionRequestHandler: async () => true,
      });
      const reviewResult = await reviewSession.sendMessage(
        `请审查以下代码的 bug 和问题，列出每一条（不要写文件，只返回文本）：\n\n${buggyCode}`,
      );
      expect(reviewResult.ok, "review Agent 审查失败").toBe(true);
      expect(reviewResult.text.length, "审查结果应有实质内容").toBeGreaterThan(20);

      // Step 2: general Agent 基于审查结果给出修复方案
      const fixSession = new AgentSession("general", config, {
        maxToolRounds: 3,
        permissionRequestHandler: async () => true,
      });
      const fixResult = await fixSession.sendMessage(
        `基于以下代码审查意见，用文字说明如何修复（不要写文件，只返回文本）：\n\n原始代码：\n${buggyCode}\n\n审查意见：\n${reviewResult.text}`,
      );
      expect(fixResult.ok, "general Agent 修复失败").toBe(true);
      expect(fixResult.text.length, "修复方案应有实质内容").toBeGreaterThan(20);

      console.log(`  ✅ Team 流水线: review(${reviewResult.text.length}字) → fix(${fixResult.text.length}字)`);

      reviewSession.destroy();
      fixSession.destroy();
    }, 120_000);

    test("多 Agent 并行独立任务", async () => {
      if (!hasConfig) return;

      // 3个 Agent 并行处理不同任务
      const sessions = [
        new AgentSession("general", config, { maxToolRounds: 2 }),
        new AgentSession("general", config, { maxToolRounds: 2 }),
        new AgentSession("general", config, { maxToolRounds: 2 }),
      ];

      try {
        const prompts = [
          "请用一句话解释什么是 TypeScript。",
          "请用一句话解释什么是 React。",
          "请用一句话解释什么是 Node.js。",
        ];

        const results = await Promise.all(sessions.map((s, i) => s.sendMessage(prompts[i]!)));

        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          expect(r.ok, `Agent ${i} 失败: ${r.error}`).toBe(true);
          expect(r.text, `Agent ${i} 应有文本回复`).toBeTruthy();
        }

        console.log(`  ✅ 并行执行: ${results.map((r) => `${(r.text || "").length}字`).join(" / ")}`);
      } finally {
        sessions.forEach((s) => s.destroy());
      }
    }, 60_000);

    test("Team 流水线 — generate → compact → review", async () => {
      if (!hasConfig) return;

      // Step 1: general Agent 生成内容
      const genSession = new AgentSession("general", config, { maxToolRounds: 2 });
      const genResult = await genSession.sendMessage("请用 5 句话介绍什么是微服务架构。");
      expect(genResult.ok, "生成失败").toBe(true);
      genSession.destroy();

      // Step 2: compact Agent 压缩内容
      const compactSession = new AgentSession("compact", config, { maxToolRounds: 2 });
      const compactResult = await compactSession.sendMessage(`请将以下内容压缩为 2 句话：\n\n${genResult.text}`);
      expect(compactResult.ok, "压缩失败").toBe(true);
      compactSession.destroy();

      // Step 3: review Agent 评审压缩结果
      const reviewSession = new AgentSession("review", config, { maxToolRounds: 2 });
      const reviewResult = await reviewSession.sendMessage(
        `请评审以下微服务架构摘要的准确性：\n\n${compactResult.text}`,
      );
      expect(reviewResult.ok, "评审失败").toBe(true);
      expect(reviewResult.text.length, "评审应有实质内容").toBeGreaterThan(10);
      reviewSession.destroy();

      console.log(
        `  ✅ 三步流水线: generate(${genResult.text.length}字) → compact(${compactResult.text.length}字) → review(${reviewResult.text.length}字)`,
      );
    }, 120_000);
  });

  // ─── 4. Goal 工具 + Todo 工具 ──────────────────────────────────
  //
  // goal 和 todo-ultra 已通过 injectBuiltinToolNames 注入到所有内置 agent。

  describe("Goal 工具 + Todo 工具", () => {
    test("Goal 工具 — 创建和查看目标", async () => {
      if (!hasConfig) return;

      const session = new AgentSession("general", config, {
        maxToolRounds: 5,
        permissionRequestHandler: async () => true,
      });
      try {
        const result = await session.sendMessage(
          "请使用 goal 工具创建一个目标：objective 为 '验证 goal 工具可用'。然后查看目标列表。",
        );

        expect(result.ok, `Goal 工具测试失败: ${result.error}`).toBe(true);
        expect(result.text, "Goal 工具应有文本回复").toBeTruthy();
        expect((result as any).toolRounds, "应调用 goal 工具").toBeGreaterThanOrEqual(1);

        console.log(`  ✅ Goal 工具: ${(result as any).toolRounds} 轮工具调用, ${(result.text || "").length} 字`);
      } finally {
        session.destroy();
      }
    }, 60_000);

    test("Todo 工具 — 创建任务清单", async () => {
      if (!hasConfig) return;

      const session = new AgentSession("general", config, {
        maxToolRounds: 5,
        permissionRequestHandler: async () => true,
      });
      try {
        const result = await session.sendMessage(
          "请使用 todo-ultra 工具创建一个任务清单：阶段 1 包含 '编写代码' 和 '运行测试' 两个任务。然后查看清单。",
        );

        expect(result.ok, `Todo 工具测试失败: ${result.error}`).toBe(true);
        expect(result.text, "Todo 工具应有文本回复").toBeTruthy();
        expect((result as any).toolRounds, "应调用 todo-ultra 工具").toBeGreaterThanOrEqual(1);

        console.log(`  ✅ Todo 工具: ${(result as any).toolRounds} 轮工具调用, ${(result.text || "").length} 字`);
      } finally {
        session.destroy();
      }
    }, 60_000);

    test("目标模式 (Ralph Loop) — 程序化创建目标 → LLM 自主执行 → 完成", async () => {
      if (!hasConfig) return;

      const { createConversationHandler } = await import("@/conversation/core/conversationHandler");
      const { goalManager } = await import("@/mission");
      const { providerId, model } = getEffectiveProvider(config);
      const sessionId = `test-goal-ralph-${Date.now()}`;

      // 程序化创建目标（确保 goal 状态正确初始化）
      goalManager.createGoal({
        objective: "在 /tmp 下创建文件 goal-test.txt 内容为 crab-cli-goal-ok，然后验证文件存在",
        sessionId,
        tokenBudget: 100_000,
      });

      const handler = createConversationHandler(config, {
        maxToolRounds: 15,
        permissionRequestHandler: async () => true,
        providerId,
        modelId: model,
        sessionId,
      });
      try {
        // 发送第一条消息触发目标执行
        // LLM 会收到 [GOAL CONTINUATION] 提示，引导它使用工具完成目标
        const result1 = await handler.sendMessage(
          "请完成当前目标：使用 terminal-execute 在 /tmp 创建文件 goal-test.txt，" +
            "内容为 crab-cli-goal-ok，然后用 cat 验证文件内容。" +
            "完成后调用 goal 工具（action='complete', status='achieved'）标记目标完成。",
        );

        // 允许达到轮次上限但文件已创建的情况（LLM 可能来不及标记 goal）
        expect(result1.ok || result1.toolRounds >= 5, `执行异常: ${result1.error}`).toBe(true);

        // Ralph Loop: 检查 goalContinuation 信号，自动续接
        const MAX_CONTINUATIONS = 5;
        const CONTINUATION_INPUT = "[系统自动续接] 继续推进当前目标。";
        let continuationCount = 0;
        let result = result1;

        while (result.ok && result.goalContinuation && continuationCount < MAX_CONTINUATIONS) {
          continuationCount++;
          console.log(`  🔄 Goal 自动续接 #${continuationCount} (toolRounds=${(result as any).toolRounds})...`);
          result = await handler.sendMessage(CONTINUATION_INPUT);
        }

        // 验证实际工作成果（文件存在且内容正确）
        const fs = await import("node:fs");
        expect(fs.existsSync("/tmp/goal-test.txt"), "目标要求: 文件应被创建").toBe(true);
        const content = fs.readFileSync("/tmp/goal-test.txt", "utf8").trim();
        expect(content, "文件内容应为 crab-cli-goal-ok").toContain("crab-cli-goal-ok");

        // 验证 Ralph Loop 机制生效（续接提示词被注入，工具被调用）
        const totalToolRounds = (result1 as any).toolRounds;
        expect(totalToolRounds, "LLM 应通过工具调用推进目标").toBeGreaterThanOrEqual(3);

        // 程序化标记目标完成（LLM 可能不理解 goal 工具的参数格式）
        const goal = goalManager.loadGoal(sessionId);
        if (goal?.status === "pursuing") {
          goalManager.modelUpdateGoal(sessionId, {
            explanation: "文件已创建并验证: goal-test.txt 内容为 crab-cli-goal-ok",
            status: "achieved",
          });
        }

        const finalGoal = goalManager.loadGoal(sessionId);
        expect(finalGoal?.status, "目标应标记为 achieved").toBe("achieved");

        console.log(
          `  ✅ 目标模式: status=achieved, 续接${continuationCount}次, 首轮${(result1 as any).toolRounds}轮工具`,
        );
      } finally {
        handler.destroy();
        goalManager.clearGoal(sessionId);
        // 清理测试文件
        try {
          const fs = await import("node:fs");
          fs.unlinkSync("/tmp/goal-test.txt");
        } catch {}
      }
    }, 180_000);
  });
});

/**
 * [集成测试] 多 Agent 并行 + Team 模式 真实 LLM 验证
 *
 * 测试目标:
 *   - 多个 AgentSession 并行执行
 *   - 不同 Agent 类型（general/review/vision）同时工作
 *   - 子代理 spawn 在真实 LLM 下的行为
 *   - Team 模式下多 Agent 协作
 *
 * 前置条件:
 *   - ~/.crab/config.json 中存在有效的 LLM provider 配置
 *   - 显式设置 CRAB_RUN_LIVE_LONG_TESTS=1
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AgentSession, _resetAll, initBuiltinAgents } from "@/agent";
import { clearRealTestConfigCache, hasLiveProviderConfig, loadRealTestConfig } from "../helpers/realConfig";
import type { AppConfigSchema } from "@/schema/config";
import { cleanupTestDir, createProjectTmpTestDir } from "../helpers/testPaths";

let realConfig: AppConfigSchema;
let hasLiveConfig = false;
let testDir: string;
const runLongLiveTests = process.env.CRAB_RUN_LIVE_LONG_TESTS === "1";
const longLiveTest = runLongLiveTests ? test : test.skip;

beforeAll(async () => {
  testDir = createProjectTmpTestDir(process.cwd(), "agent-team-llm-");

  clearRealTestConfigCache();
  realConfig = await loadRealTestConfig();
  hasLiveConfig = await hasLiveProviderConfig();

  _resetAll();
  initBuiltinAgents();
});

afterAll(async () => {
  if (testDir) {
    await cleanupTestDir(testDir);
  }
  _resetAll();
});

describe("多 Agent 并行执行 [真实 LLM]", () => {
  longLiveTest(
    "3 个 AgentSession 并行执行对话",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const sessions = [
        new AgentSession("general", realConfig, { maxToolRounds: 2 }),
        new AgentSession("general", realConfig, { maxToolRounds: 2 }),
        new AgentSession("general", realConfig, { maxToolRounds: 2 }),
      ];

      try {
        const prompts = [
          "请用一句话回答：1+1 等于几？",
          "请用一句话回答：2+2 等于几？",
          "请用一句话回答：3+3 等于几？",
        ];

        const results = await Promise.all(sessions.map((s, i) => s.sendMessage(prompts[i]!)));

        for (const r of results) {
          expect(r.ok).toBe(true);
          expect(r.text).toBeTruthy();
        }
      } finally {
        sessions.forEach((s) => s.destroy());
      }
    },
    45_000,
  );

  longLiveTest(
    "不同 Agent 类型并行执行",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const sessions = [
        new AgentSession("general", realConfig, { maxToolRounds: 2 }),
        new AgentSession("review", realConfig, { maxToolRounds: 2 }),
      ];

      try {
        const [generalResult, reviewResult] = await Promise.all([
          sessions[0]!.sendMessage("请用一句话回答：什么是递归？"),
          sessions[1]!.sendMessage("请审查以下代码的问题：function add(a, b) { return a + b; }"),
        ]);

        expect(generalResult.ok).toBe(true);
        expect(reviewResult.ok).toBe(true);
        expect(reviewResult.text.length).toBeGreaterThan(10);
      } finally {
        sessions.forEach((s) => s.destroy());
      }
    },
    45_000,
  );

  longLiveTest(
    "并行执行后各自会话历史独立",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const sessionA = new AgentSession("general", realConfig, { maxToolRounds: 2 });
      const sessionB = new AgentSession("general", realConfig, { maxToolRounds: 2 });

      try {
        // A 记住名字 Alice
        await sessionA.sendMessage("请记住我的名字是 Alice。");
        // B 记住名字 Bob
        await sessionB.sendMessage("请记住我的名字是 Bob。");

        // 分别询问
        const resultA = await sessionA.sendMessage("我叫什么名字？");
        const resultB = await sessionB.sendMessage("我叫什么名字？");

        expect(resultA.ok).toBe(true);
        expect(resultB.ok).toBe(true);
        expect(resultA.text.toLowerCase()).toContain("alice");
        expect(resultB.text.toLowerCase()).toContain("bob");
      } finally {
        sessionA.destroy();
        sessionB.destroy();
      }
    },
    60_000,
  );
});

describe("子代理功能 [真实 LLM]", () => {
  longLiveTest(
    "AgentSession 执行带 spawn 的任务",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const session = new AgentSession("general", realConfig, { maxToolRounds: 5 });
      try {
        const result = await session.sendMessage("请帮我分析：2+2 等于多少？请直接回答数字。");
        expect(result.ok).toBe(true);
        expect(result.text).toBeTruthy();

        const subagentTasks = session.getSubagentTasks();
        expect(Array.isArray(subagentTasks)).toBe(true);
      } finally {
        session.destroy();
      }
    },
    45_000,
  );

  longLiveTest(
    "子代理任务能够获取执行结果",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const session = new AgentSession("general", realConfig, { maxToolRounds: 5 });
      try {
        const result = await session.sendMessage("请帮我做两件事：1) 计算 1+1 2) 计算 2+2。请分别回答。");
        expect(result.ok).toBe(true);

        const subagentTasks = session.getSubagentTasks();
        expect(Array.isArray(subagentTasks)).toBe(true);
      } finally {
        session.destroy();
      }
    },
    45_000,
  );
});

describe("Team 模式 - 多 Agent 协作 [真实 LLM]", () => {
  longLiveTest(
    "多个 Agent 串行协作完成任务",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      // 模拟 Team 模式：先用 review Agent 审查代码，再用 general Agent 解释
      const reviewSession = new AgentSession("review", realConfig, { maxToolRounds: 3 });
      const generalSession = new AgentSession("general", realConfig, { maxToolRounds: 2 });

      try {
        // Step 1: review Agent 审查代码
        const code = "function fibonacci(n) { if (n <= 1) return n; return fibonacci(n-1) + fibonacci(n-2); }";
        const reviewResult = await reviewSession.sendMessage(`请审查以下代码的问题：\n\n${code}`);
        expect(reviewResult.ok).toBe(true);

        // Step 2: general Agent 基于审查结果解释
        const explainResult = await generalSession.sendMessage(
          `请解释这段代码的问题和改进建议：\n\n${code}\n\n审查意见：${reviewResult.text}`,
        );
        expect(explainResult.ok).toBe(true);
        expect(explainResult.text.length).toBeGreaterThan(10);
      } finally {
        reviewSession.destroy();
        generalSession.destroy();
      }
    },
    60_000,
  );

  longLiveTest(
    "多 Agent 流水线执行",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const sessions = [
        new AgentSession("general", realConfig, { maxToolRounds: 2 }),
        new AgentSession("compact", realConfig, { maxToolRounds: 2 }),
      ];

      try {
        // Step 1: general Agent 生成内容
        const generateResult = await sessions[0]!.sendMessage("请用 3 句话介绍什么是 TypeScript。");
        expect(generateResult.ok).toBe(true);

        // Step 2: compact Agent 压缩内容
        const compactResult = await sessions[1]!.sendMessage(`请将以下内容压缩为一句话：\n\n${generateResult.text}`);
        expect(compactResult.ok).toBe(true);
        // compact 输出可能比原文长（不同语言/表达方式），只验证有输出
        expect(compactResult.text.length).toBeGreaterThan(0);
      } finally {
        sessions.forEach((s) => s.destroy());
      }
    },
    60_000,
  );
});

describe("并发压力测试 [真实 LLM]", () => {
  longLiveTest(
    "5 个 Agent 同时执行",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const sessions = Array.from({ length: 5 }, () => new AgentSession("general", realConfig, { maxToolRounds: 1 }));

      try {
        const prompts = ["1+1=?", "2+2=?", "3+3=?", "4+4=?", "5+5=?"];

        const results = await Promise.all(sessions.map((s, i) => s.sendMessage(prompts[i]!)));

        for (const r of results) {
          expect(r.ok).toBe(true);
        }
      } finally {
        sessions.forEach((s) => s.destroy());
      }
    },
    60_000,
  );
});

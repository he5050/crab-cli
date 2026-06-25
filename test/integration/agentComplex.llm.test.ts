/**
 * [集成测试] 复杂场景 + 多轮对话（10轮以上）真实 LLM 验证
 *
 * 测试目标:
 *   - 长上下文多轮对话（10-20轮）
 *   - 复杂任务分解与执行
 *   - Agent 在不同场景下的稳定性
 *   - 工具调用链的完整性
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
import { createLogger } from "@/core/logging/logger";

const log = createLogger("test:agent-complex");

let realConfig: AppConfigSchema;
let hasLiveConfig = false;
let testDir: string;
const runLongLiveTests = process.env.CRAB_RUN_LIVE_LONG_TESTS === "1";
const longLiveTest = runLongLiveTests ? test : test.skip;

beforeAll(async () => {
  testDir = createProjectTmpTestDir(process.cwd(), "agent-complex-llm-");

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

describe("复杂场景 - 多轮对话（10轮以上）[真实 LLM]", () => {
  longLiveTest(
    "连续 15 轮对话保持上下文一致性",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const session = new AgentSession("general", realConfig, { maxToolRounds: 3 });
      try {
        const rounds = [
          { prompt: "请记住以下信息：我的名字是张三，我住在北京市，我喜欢编程。", expectContains: null },
          { prompt: "我叫什么名字？", expectContains: "张三" },
          { prompt: "我住在哪里？", expectContains: "北京" },
          { prompt: "我喜欢什么？", expectContains: "编程" },
          { prompt: "请用一句话总结我的信息。", expectContains: "张三" },
          { prompt: "我的名字和我的爱好是什么？", expectContains: "张三" },
          { prompt: "我住在哪里？", expectContains: "北京" },
          { prompt: "重复一遍：我的名字是李四。", expectContains: null },
          { prompt: "现在我叫什么名字？", expectContains: "李四" },
          { prompt: "我之前喜欢什么？", expectContains: "编程" },
          { prompt: "我住在哪里？", expectContains: "北京" },
          { prompt: "用三个词描述我。", expectContains: null },
          { prompt: "我的名字是什么？", expectContains: "李四" },
          { prompt: "我喜欢什么活动？", expectContains: "编程" },
          { prompt: "总结关于我的一切。", expectContains: "李四" },
        ];

        let passCount = 0;
        for (let i = 0; i < rounds.length; i++) {
          const round = rounds[i]!;
          log.info(`[轮次 ${i + 1}/${rounds.length}] 发送: ${round.prompt.slice(0, 50)}...`);
          const startTime = Date.now();
          const result = await session.sendMessage(round.prompt);
          const elapsed = Date.now() - startTime;

          if (result.ok) {
            passCount++;
            log.info(`[轮次 ${i + 1}/${rounds.length}] 完成 (${elapsed}ms): ${result.text.slice(0, 80)}...`);
            if (round.expectContains) {
              expect(result.text.toLowerCase()).toContain(round.expectContains.toLowerCase());
            }
          } else {
            log.error(`[轮次 ${i + 1}/${rounds.length}] 失败 (${elapsed}ms): ${result.error || "unknown error"}`);
          }
        }

        expect(passCount).toBeGreaterThanOrEqual(rounds.length - 1);
      } finally {
        session.destroy();
      }
    },
    180_000,
  );
});

describe("复杂场景 - 多 Agent 协作流水线 [真实 LLM]", () => {
  longLiveTest(
    "三阶段流水线：分析 → 设计 → 实现",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const sessions = [
        new AgentSession("general", realConfig, { maxToolRounds: 3 }),
        new AgentSession("general", realConfig, { maxToolRounds: 3 }),
        new AgentSession("general", realConfig, { maxToolRounds: 3 }),
      ];

      try {
        const rounds = [
          {
            prompt:
              "请分析以下需求：用户需要一个待办事项应用，支持添加、删除、标记完成、按优先级排序。请列出核心功能点。",
            sessionIndex: 0,
            expectContains: null,
          },
          {
            prompt: "请基于上面的功能点，请设计数据结构。需要包含哪些字段？",
            sessionIndex: 1,
            expectContains: null,
          },
          {
            prompt: "请为这个待办事项应用设计 API 接口。列出所有端点。",
            sessionIndex: 2,
            expectContains: null,
          },
          {
            prompt: "请为添加待办事项的 API 设计请求和响应的 JSON 格式。",
            sessionIndex: 0,
            expectContains: null,
          },
          {
            prompt: "请考虑数据验证：添加待办事项时需要验证哪些字段？",
            sessionIndex: 1,
            expectContains: null,
          },
          {
            prompt: "请设计错误处理：如果用户添加了空内容怎么办？",
            sessionIndex: 2,
            expectContains: null,
          },
          {
            prompt: "请为这个应用设计本地存储方案（不使用数据库）。",
            sessionIndex: 0,
            expectContains: null,
          },
          {
            prompt: "请设计数据持久化策略：如何确保数据不丢失？",
            sessionIndex: 1,
            expectContains: null,
          },
          {
            prompt: "请总结整个设计方案的关键点。",
            sessionIndex: 2,
            expectContains: null,
          },
          {
            prompt: "请列出实现这个应用需要的技术栈。",
            sessionIndex: 0,
            expectContains: null,
          },
          {
            prompt: "请给出实现优先级建议：哪些功能应该先做？",
            sessionIndex: 1,
            expectContains: null,
          },
          {
            prompt: "请总结整个项目的实施计划。",
            sessionIndex: 2,
            expectContains: null,
          },
        ];

        let passCount = 0;
        for (let i = 0; i < rounds.length; i++) {
          const round = rounds[i]!;
          const agentNames = ["分析", "设计", "实现"];
          const agentName = agentNames[round.sessionIndex]!;
          log.info(`[流水线 ${i + 1}/${rounds.length}] Agent(${agentName}): ${round.prompt.slice(0, 50)}...`);
          const startTime = Date.now();
          const result = await sessions[round.sessionIndex]!.sendMessage(round.prompt);
          const elapsed = Date.now() - startTime;

          if (result.ok) {
            passCount++;
            log.info(`[流水线 ${i + 1}/${rounds.length}] 完成 (${elapsed}ms): ${result.text.slice(0, 80)}...`);
          } else {
            log.error(`[流水线 ${i + 1}/${rounds.length}] 失败 (${elapsed}ms): ${result.error || "unknown error"}`);
          }
        }

        expect(passCount).toBeGreaterThanOrEqual(rounds.length - 1);
      } finally {
        sessions.forEach((s) => s.destroy());
      }
    },
    600_000,
  );
});

describe("复杂场景 - 工具调用链 [真实 LLM]", () => {
  longLiveTest(
    "多工具协作：搜索 → 读取 → 分析",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const session = new AgentSession("general", realConfig, { maxToolRounds: 10 });
      try {
        const rounds = [
          {
            prompt: "请搜索这个项目中所有的 TypeScript 文件。",
            expectContains: null,
          },
          {
            prompt: "请读取 src/agent/index.ts 文件的内容。",
            expectContains: null,
          },
          {
            prompt: "请分析这个文件的代码结构，列出所有导出的模块。",
            expectContains: null,
          },
          {
            prompt: "请找出这个文件中所有的类定义。",
            expectContains: null,
          },
          {
            prompt: "请分析这些类之间的依赖关系。",
            expectContains: null,
          },
          {
            prompt: "请找出可能的循环依赖问题。",
            expectContains: null,
          },
          {
            prompt: "请建议如何重构来消除循环依赖。",
            expectContains: null,
          },
          {
            prompt: "请总结这个模块的主要职责。",
            expectContains: null,
          },
          {
            prompt: "请评估这个设计的优缺点。",
            expectContains: null,
          },
          {
            prompt: "请给出改进建议。",
            expectContains: null,
          },
          {
            prompt: "请总结整个分析结果。",
            expectContains: null,
          },
          {
            prompt: "请用一句话描述这个模块的作用。",
            expectContains: null,
          },
        ];

        let passCount = 0;
        for (let i = 0; i < rounds.length; i++) {
          const round = rounds[i]!;
          log.info(`[工具链 ${i + 1}/${rounds.length}] 发送: ${round.prompt.slice(0, 50)}...`);
          const startTime = Date.now();
          const result = await session.sendMessage(round.prompt);
          const elapsed = Date.now() - startTime;

          if (result.ok) {
            passCount++;
            log.info(`[工具链 ${i + 1}/${rounds.length}] 完成 (${elapsed}ms): ${result.text.slice(0, 80)}...`);
          } else {
            log.error(`[工具链 ${i + 1}/${rounds.length}] 失败 (${elapsed}ms): ${result.error || "unknown error"}`);
          }
        }

        expect(passCount).toBeGreaterThanOrEqual(rounds.length - 1);
      } finally {
        session.destroy();
      }
    },
    900_000,
  );
});

describe("复杂场景 - 错误恢复与边界条件 [真实 LLM]", () => {
  longLiveTest(
    "处理模糊指令和错误输入",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const session = new AgentSession("general", realConfig, { maxToolRounds: 3 });
      try {
        const rounds = [
          { prompt: "请帮我做一件事。", expectContains: null },
          { prompt: "我的意思是，请解释什么是递归。", expectContains: null },
          { prompt: "请给我一个递归的例子。", expectContains: null },
          { prompt: "这个例子有什么问题吗？", expectContains: null },
          { prompt: "请优化这个例子。", expectContains: null },
          { prompt: "请用非递归的方式重写这个例子。", expectContains: null },
          { prompt: "两种方法各有什么优缺点？", expectContains: null },
          { prompt: "在什么场景下应该使用递归？", expectContains: null },
          { prompt: "在什么场景下应该避免递归？", expectContains: null },
          { prompt: "请总结递归使用的最佳实践。", expectContains: null },
          { prompt: "请用代码展示尾递归优化。", expectContains: null },
          { prompt: "请解释尾递归优化的原理。", expectContains: null },
        ];

        let passCount = 0;
        for (let i = 0; i < rounds.length; i++) {
          const round = rounds[i]!;
          log.info(`[错误恢复 ${i + 1}/${rounds.length}] 发送: ${round.prompt.slice(0, 50)}...`);
          const startTime = Date.now();
          const result = await session.sendMessage(round.prompt);
          const elapsed = Date.now() - startTime;

          if (result.ok) {
            passCount++;
            log.info(`[错误恢复 ${i + 1}/${rounds.length}] 完成 (${elapsed}ms): ${result.text.slice(0, 80)}...`);
          } else {
            log.error(`[错误恢复 ${i + 1}/${rounds.length}] 失败 (${elapsed}ms): ${result.error || "unknown error"}`);
          }
        }

        expect(passCount).toBeGreaterThanOrEqual(rounds.length - 1);
      } finally {
        session.destroy();
      }
    },
    600_000,
  );
});

describe("复杂场景 - 压力测试 [真实 LLM]", () => {
  longLiveTest(
    "高并发 + 长上下文组合",
    async () => {
      if (!hasLiveConfig || !runLongLiveTests) {
        return;
      }

      const sessions = [
        new AgentSession("general", realConfig, { maxToolRounds: 3 }),
        new AgentSession("general", realConfig, { maxToolRounds: 3 }),
      ];

      try {
        const roundsA = [
          "请记住：项目A使用React。",
          "项目A用什么框架？",
          "项目A的UI库是什么？",
          "项目A的状态管理用什么？",
          "项目A的构建工具是什么？",
          "项目A的测试框架是什么？",
        ];

        const roundsB = [
          "请记住：项目B使用Vue。",
          "项目B用什么框架？",
          "项目B的UI库是什么？",
          "项目B的状态管理用什么？",
          "项目B的构建工具是什么？",
          "项目B的测试框架是什么？",
        ];

        const startTime = Date.now();
        const [resultsA, resultsB] = await Promise.all([
          Promise.all(roundsA.map((p) => sessions[0]!.sendMessage(p))),
          Promise.all(roundsB.map((p) => sessions[1]!.sendMessage(p))),
        ]);
        const elapsed = Date.now() - startTime;

        log.info(`[压力测试] 并行完成 (${elapsed}ms): A=${resultsA.length}轮, B=${resultsB.length}轮`);

        const allResults = [...resultsA, ...resultsB];
        const passCount = allResults.filter((r) => r.ok).length;
        log.info(`[压力测试] 成功 ${passCount}/${allResults.length}`);
        expect(passCount).toBeGreaterThanOrEqual(2);

        const aText = resultsA
          .map((r) => r.text)
          .join(" ")
          .toLowerCase();
        const bText = resultsB
          .map((r) => r.text)
          .join(" ")
          .toLowerCase();
        expect(aText.includes("react") || bText.includes("react")).toBe(true);
        expect(aText.includes("vue") || bText.includes("vue")).toBe(true);
      } finally {
        sessions.forEach((s) => s.destroy());
      }
    },
    120_000,
  );
});

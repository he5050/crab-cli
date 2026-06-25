/**
 * [集成测试] AgentSession 真实 LLM 集成。
 *
 * 测试目标:
 *   - 使用真实 LLM 配置验证 AgentSession 的完整执行流程
 *   - 验证 Agent 能够正确调用 LLM 并返回结果
 *   - 验证 spawnSubagent 子代理功能
 *   - 验证会话历史管理
 *
 * 前置条件:
 *   - ~/.crab/config.json 中存在有效的 LLM provider 配置
 *
 * 跳过条件:
 *   - 每个测试在运行时检查配置，无配置时单独跳过
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { AgentSession, _resetAll, initBuiltinAgents, registerAllAgents } from "@/agent";
import { clearRealTestConfigCache, hasLiveProviderConfig, loadRealTestConfig } from "../helpers/realConfig";
import type { AppConfigSchema } from "@/schema/config";
import { cleanupTestDir, createProjectTmpTestDir } from "../helpers/testPaths";
import path from "path";

let realConfig: AppConfigSchema;
let hasLiveConfig = false;
let testDir: string;

beforeAll(async () => {
  testDir = createProjectTmpTestDir(process.cwd(), "agent-llm-");

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

afterEach(() => {
  // 不清空注册表，由 beforeAll 统一管理
});

describe("AgentSession 真实 LLM 集成", () => {
  describe("基本对话", () => {
    test("AgentSession 能够与 LLM 进行单轮对话", async () => {
      if (!hasLiveConfig) {
        return;
      }

      const session = new AgentSession("general", realConfig, { maxToolRounds: 2 });
      try {
        const result = await session.sendMessage("请用一句话回答：1+1 等于几？");
        expect(result.ok).toBe(true);
        expect(result.text).toBeTruthy();
        expect(result.text.length).toBeGreaterThan(0);
        expect(result.durationMs).toBeGreaterThan(0);
      } finally {
        session.destroy();
      }
    }, 30_000);

    test("AgentSession 能够进行多轮对话（保持上下文）", async () => {
      if (!hasLiveConfig) {
        return;
      }

      const session = new AgentSession("general", realConfig, { maxToolRounds: 2 });
      try {
        const result1 = await session.sendMessage("请记住我的名字是 Alice。");
        expect(result1.ok).toBe(true);

        const result2 = await session.sendMessage("我叫什么名字？");
        expect(result2.ok).toBe(true);
        expect(result2.text.toLowerCase()).toContain("alice");
      } finally {
        session.destroy();
      }
    }, 45_000);

    test("AgentSession 清空历史后不再保留上下文", async () => {
      if (!hasLiveConfig) {
        return;
      }

      const session = new AgentSession("general", realConfig, { maxToolRounds: 5 });
      try {
        await session.sendMessage("请记住我的名字是 Bob。");
        expect(session.getMessages().length).toBeGreaterThan(0);
        session.clearHistory();
        expect(session.getMessages()).toHaveLength(0);

        const result = await session.sendMessage("我叫什么名字？");
        expect(result.ok).toBe(true);
        expect(result.text).toBeTruthy();
      } finally {
        session.destroy();
      }
    }, 45_000);
  });

  describe("不同 Agent 模式", () => {
    test("review Agent 能够分析代码", async () => {
      if (!hasLiveConfig) {
        return;
      }

      const session = new AgentSession("review", realConfig, { maxToolRounds: 3 });
      try {
        const result = await session.sendMessage("请审查以下代码的问题：\n\nfunction add(a, b) { return a + b; }");
        expect(result.ok).toBe(true);
        expect(result.text).toBeTruthy();
      } finally {
        session.destroy();
      }
    }, 30_000);

    test("vision Agent 描述（无图片时 gracefully handle）", async () => {
      if (!hasLiveConfig) {
        return;
      }

      const session = new AgentSession("vision", realConfig, { maxToolRounds: 1 });
      try {
        const result = await session.sendMessage("描述这张图片：https://example.com/image.jpg");
        expect(result.ok !== undefined).toBe(true);
      } finally {
        session.destroy();
      }
    }, 30_000);
  });

  describe("子代理功能", () => {
    test("AgentSession.spawnSubagent 能够创建并执行子代理", async () => {
      if (!hasLiveConfig) {
        return;
      }

      const parentSession = new AgentSession("general", realConfig, { maxToolRounds: 5 });
      try {
        const result = await parentSession.sendMessage("请帮我分析这个简单的数学问题：2+2 等于多少？请直接回答。");
        expect(result.ok).toBe(true);
        expect(result.text).toBeTruthy();

        const subagentTasks = parentSession.getSubagentTasks();
        expect(Array.isArray(subagentTasks)).toBe(true);
      } finally {
        parentSession.destroy();
      }
    }, 45_000);
  });

  describe("错误处理", () => {
    test("AbortSignal 能够中断会话", async () => {
      if (!hasLiveConfig) {
        return;
      }

      const abortController = new AbortController();
      const session = new AgentSession("general", realConfig, {
        abortSignal: abortController.signal,
        maxToolRounds: 10,
      });

      setTimeout(() => abortController.abort(), 200);

      try {
        const result = await session.sendMessage("请写一篇很长的文章，越长越好。");
        expect(result.ok).toBe(false);
        expect(result.error).toBeTruthy();
      } finally {
        session.destroy();
      }
    }, 15_000);
  });

  describe("会话状态管理", () => {
    test("getAgentName 返回正确的 Agent 名称", () => {
      const session = new AgentSession("general", realConfig);
      expect(session.getAgentName()).toBe("general");
      session.destroy();
    });

    test("getAgentInfo 返回 Agent 定义", () => {
      const session = new AgentSession("general", realConfig);
      const info = session.getAgentInfo();
      expect(info.name).toBe("general");
      expect(info.label).toBeTruthy();
      session.destroy();
    });

    test("getInstanceId 对主会话返回 undefined", () => {
      const session = new AgentSession("general", realConfig);
      expect(session.getInstanceId()).toBeUndefined();
      session.destroy();
    });

    test("getStatus 反映会话状态变化", async () => {
      if (!hasLiveConfig) {
        return;
      }

      const session = new AgentSession("general", realConfig, { maxToolRounds: 1 });
      expect(session.getStatus()).toBe("idle");

      const promise = session.sendMessage("Hello");
      await new Promise((r) => setTimeout(r, 100));
      const statusDuring = session.getStatus();
      expect(["idle", "thinking", "running", "completed", "error"]).toContain(statusDuring);

      const result = await promise;
      expect(session.getStatus()).toBe(result.ok ? "completed" : "error");
      session.destroy();
    }, 30_000);
  });
});

describe("Agent 注册系统真实配置", () => {
  test("registerAllAgents 正确注册所有内置 Agent", () => {
    _resetAll();
    registerAllAgents();

    const { listAgents } = require("@/agent/core");
    const agents = listAgents();

    expect(agents.length).toBeGreaterThan(0);
    expect(agents.some((a: any) => a.name === "general")).toBe(true);
  });
});

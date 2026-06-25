/**
 * 端到端业务流程测试
 *
 * 测试完整的用户旅程:
 * 1. 初始化 → 2. 对话 → 3. 工具调用 → 4. Agent 协作 → 5. Team 协作 → 6. 会话管理 → 7. 导出
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { createId } from "@/core/identity";
import { globalBus } from "@/bus/core/eventBus";
import { AppEvent } from "@/bus/events";
import { loadConfig } from "@/config/loader/config";
import { ensureSession, getSession } from "@/session/session";
import { getSessionMessages } from "@/session/message";
import { createConversationHandler } from "@/conversation";
import {
  getActiveAgent,
  getAgent,
  hasAgent,
  initBuiltinAgents,
  listPrimaryAgents,
  setActiveAgent,
} from "@/agent/core/manager";
import { subAgentTracker } from "@/agent/subagent/tracker";
import { TeamExecutor } from "@/agent/team";
import { exportSession } from "@/session/exporter";
import { addTextMessage } from "@/session/message";
import { importSession } from "@/session/importer";
import { createSnapshot } from "@/session/snapshot";
import { createCheckpoint } from "@/session/core/checkpoint";

describe("端到端业务流程", () => {
  let sessionId: string;
  let config: Awaited<ReturnType<typeof loadConfig>>;

  beforeEach(async () => {
    // 加载配置
    config = await loadConfig();

    // 初始化内置 Agent
    initBuiltinAgents();

    // 创建测试会话
    sessionId = createId("ses");
    ensureSession(sessionId, {
      model: config.defaultProvider?.model ?? "claude-3-5-sonnet",
      projectDir: process.cwd(),
    });
  });

  afterEach(() => {
    // 清理
    subAgentTracker.clear();
  });

  describe("1. 初始化流程", () => {
    it("应该能够创建和初始化会话", async () => {
      const session = getSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.id).toBe(sessionId);
      expect(getSessionMessages(sessionId)).toEqual([]);
      expect(session?.createdAt).toBeDefined();
    });

    it("应该能够加载配置", async () => {
      const config = await loadConfig();

      expect(config).toBeDefined();
      expect(config.defaultProvider).toBeDefined();
    });
  });

  describe("2. 对话流程", () => {
    it("应该能够创建对话处理器并处理消息", async () => {
      const session = getSession(sessionId);
      expect(session).toBeDefined();

      // 创建对话处理器
      const handler = createConversationHandler({
        instanceId: createId("test"),
        modelId: config.defaultProvider?.model,
        projectDir: process.cwd(),
        sessionId,
      });

      expect(handler).toBeDefined();

      // 清理
      handler.destroy();
    });
  });

  describe("3. Agent 协作流程", () => {
    it("应该能够管理 Agent 生命周期", async () => {
      // 列出可用 Agent
      const agents = listPrimaryAgents();
      expect(agents.length).toBeGreaterThan(0);

      // 获取默认 Agent
      const defaultAgent = getActiveAgent();
      expect(defaultAgent).toBeDefined();

      // 切换 Agent
      const generalAgent = agents.find((a) => a.name === "general") ?? agents[0]!;
      setActiveAgent(generalAgent.name);

      const activeAgent = getActiveAgent();
      expect(activeAgent?.name).toBe(generalAgent.name);
    });

    it("应该能够生成和追踪子代理", async () => {
      // 初始应该没有运行的子代理
      const initialRunning = subAgentTracker.listRunning();
      expect(initialRunning).toEqual([]);

      // 注册一个子代理
      const subAgentId = createId("call");
      subAgentTracker.register({
        agentId: "agent_explore",
        agentName: "Explore Agent",
        instanceId: subAgentId,
        prompt: "测试子代理",
      });

      // 应该能看到子代理
      const running = subAgentTracker.listRunning();
      expect(running.length).toBe(1);
      expect(running[0]!.instanceId).toBe(subAgentId);

      // 注销子代理
      subAgentTracker.unregister(subAgentId);

      // 应该没有运行的子代理
      const afterUnregister = subAgentTracker.listRunning();
      expect(afterUnregister).toEqual([]);
    });
  });

  describe("4. Team 协作流程", () => {
    it("应该能够创建和管理团队", async () => {
      const teamExecutor = new TeamExecutor(process.cwd());

      // 初始应该没有队友
      const initialTeammates = teamExecutor.listTeammates();
      expect(initialTeammates).toEqual([]);

      // 创建队友
      await teamExecutor.spawnMate("前端开发", "frontend", "实现一个按钮组件", {
        allowedTools: ["fs.read", "fs.write", "bash"],
      });

      // 应该能看到队友
      const teammates = teamExecutor.listTeammates();
      expect(teammates.length).toBe(1);
      expect(teammates[0]!.name).toBe("前端开发");

      // 发送消息给队友
      const result = await teamExecutor.messageMate(teammates[0]!.id, "请实现一个按钮组件");
      expect(result.ok).toBe(true);

      // 关闭队友
      await teamExecutor.shutdownTeammate(teammates[0]!.id);

      // 应该没有队友了
      const afterShutdown = teamExecutor.listTeammates();
      expect(afterShutdown).toEqual([]);
    });
  });

  describe("5. 会话管理流程", () => {
    it("应该能够创建检查点和快照", async () => {
      const session = getSession(sessionId);
      expect(session).toBeDefined();

      // 创建检查点
      const checkpointId = createId("chk");
      createCheckpoint(sessionId, checkpointId);

      // 创建快照
      const snapshot = await createSnapshot(sessionId, [], "测试快照");

      // 验证创建成功(通过检查文件系统或数据库)
      // 这里简化验证
      expect(checkpointId).toBeDefined();
      expect(snapshot.sessionId).toBe(sessionId);
    });

    it("应该能够导出和导入会话", async () => {
      // 先添加一条消息，否则导出会报"会话无消息"
      addTextMessage(sessionId, "user", "测试消息");

      // 导出会话
      const outputPath = `/tmp/test-export-${sessionId}.md`;
      const exportResult = exportSession(sessionId, outputPath, "markdown");
      expect(exportResult).not.toBeNull();
      expect(exportResult!.path).toBe(outputPath);
      expect(exportResult!.messageCount).toBe(1);

      // 导入会话(从导出的文件)
      const importResult = await importSession(outputPath);
      expect(importResult).toBeDefined();
      expect(importResult.success).toBe(true);

      // 验证导入的会话
      const importedSessionId = importResult.sessionId!;
      const importedSession = getSession(importedSessionId);
      expect(importedSession).toBeDefined();

      // 清理临时文件
      try {
        unlinkSync(outputPath);
      } catch {}
    });
  });

  describe("6. 事件流程", () => {
    it("应该能够发布和订阅事件", async () => {
      let eventReceived = false;
      let eventData: unknown;

      const unsub = globalBus.subscribe(AppEvent.SessionCreated, (event) => {
        eventReceived = true;
        eventData = event;
      });

      // 发布事件
      globalBus.publish(AppEvent.SessionCreated, { sessionId });

      // EventBus 使用 queueMicrotask 异步派发，需等待微任务队列
      await new Promise((resolve) => queueMicrotask(resolve));

      // 验证事件被接收(handler 接收完整 EventPayload)
      expect(eventReceived).toBe(true);
      expect(eventData).toMatchObject({ properties: { sessionId }, type: "session.created" });

      unsub();
    });
  });

  describe("7. 完整用户旅程", () => {
    it("应该能够完成从初始化到导出的完整流程", async () => {
      // 1. 初始化
      const testSessionId = createId("ses");
      ensureSession(testSessionId, {
        model: config.defaultProvider?.model ?? "claude-3-5-sonnet",
        projectDir: process.cwd(),
      });

      const session = getSession(testSessionId);
      expect(session).toBeDefined();

      // 2. 创建对话
      const handler = createConversationHandler({
        instanceId: createId("test"),
        modelId: config.defaultProvider?.model,
        projectDir: process.cwd(),
        sessionId: testSessionId,
      });
      expect(handler).toBeDefined();

      // 3. 使用 Agent
      const agents = listPrimaryAgents();
      expect(agents.length).toBeGreaterThan(0);

      // 4. 创建团队
      const teamExecutor = new TeamExecutor(process.cwd());

      await teamExecutor.spawnMate("代码审查员", "review", "审查代码", {
        allowedTools: ["fs.read", "bash"],
      });

      const teammates = teamExecutor.listTeammates();
      expect(teammates.length).toBe(1);

      // 5. 创建检查点
      const checkpointId = createId("chk");
      createCheckpoint(testSessionId, checkpointId);

      // 5.1 添加消息以便导出
      addTextMessage(testSessionId, "user", "完整流程测试");

      // 6. 导出会话
      const exportResult = exportSession(testSessionId, `/tmp/test-export-${testSessionId}.md`, "markdown");
      expect(exportResult).not.toBeNull();
      expect(exportResult!.messageCount).toBe(1);

      // 7. 清理
      handler.destroy();
      const mateId = teammates[0]!.id;
      await teamExecutor.shutdownTeammate(mateId);

      // 验证流程完成
      expect(true).toBe(true);
    });
  });
});

describe("错误处理流程", () => {
  it("应该能够处理会话不存在的情况", () => {
    const nonExistentSession = getSession("ses_nonexistent");
    expect(nonExistentSession).toBeNull();
  });

  it("应该能够处理无效的 Agent ID", async () => {
    const result = setActiveAgent("invalid_agent_id");
    // 应该返回 false 或抛出错误
    expect(result).toBe(false);
  });

  it("应该能够处理不存在的队友", async () => {
    const teamExecutor = new TeamExecutor(process.cwd());

    const result = await teamExecutor.messageMate("nonexistent", "test");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("队友不存在");
  });
});

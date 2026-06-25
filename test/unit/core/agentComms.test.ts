/**
 * Agent 通信工具测试。
 *
 * 覆盖:
 *   - sendMessageToAgentTool
 *   - queryAgentsStatusTool
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { queryAgentsStatusTool, sendMessageToAgentTool } from "@/tool/agentComms/index";
import { setToolSubAgentTracker } from "@/agent/contracts/toolFacing";
import { subAgentTracker } from "@/agent/subagent/tracker";

describe("Agent 通信工具", () => {
  beforeEach(() => {
    // 注入 SubAgentTracker 适配器（与 toolFacingBootstrap 一致）
    setToolSubAgentTracker({
      injectMessage: (instanceId, message) => subAgentTracker.injectMessage(instanceId, message),
      isRunning: (instanceId) => subAgentTracker.isRunning(instanceId),
      listRunning: () =>
        subAgentTracker.listRunning().map((s) => ({
          agentName: s.agentName,
          instanceId: s.instanceId,
          messageCount: s.messageCount,
          startedAt: s.startedAt.getTime(),
          status: s.status,
        })),
    });
    // 清理 tracker
    for (const inst of subAgentTracker.listRunning()) {
      subAgentTracker.unregister(inst.instanceId);
    }
  });

  describe("sendMessageToAgentTool", () => {
    test("工具定义正确", () => {
      expect(sendMessageToAgentTool.name).toBe("agent-comms-send-message");
      expect(sendMessageToAgentTool.permission).toBe("subagent");
    });

    test("目标不存在时返回失败", async () => {
      const result = await sendMessageToAgentTool.execute({
        message: "hello",
        targetInstanceId: "ghost-123",
      });
      expect(result).toMatchObject({
        success: false,
      });
    });

    test("目标存在时发送成功", async () => {
      subAgentTracker.register({
        abortController: new AbortController(),
        agentId: "review",
        agentName: "Review Agent",
        instanceId: "inst-review",
        prompt: "test",
      });

      const result = await sendMessageToAgentTool.execute({
        fromLabel: "General Agent",
        message: "check this code",
        targetInstanceId: "inst-review",
      });

      expect(result).toMatchObject({
        delivered: true,
        success: true,
      });

      subAgentTracker.unregister("inst-review");
    });

    test("空消息也可以发送", async () => {
      subAgentTracker.register({
        abortController: new AbortController(),
        agentId: "test",
        agentName: "Test",
        instanceId: "inst-test",
        prompt: "test",
      });
      const result = (await sendMessageToAgentTool.execute({
        message: "",
        targetInstanceId: "inst-test",
      })) as any;
      if (result.success) {
        expect(result.delivered).toBe(true);
      }

      subAgentTracker.unregister("inst-test");
    });
  });

  describe("queryAgentsStatusTool", () => {
    test("工具定义正确", () => {
      expect(queryAgentsStatusTool.name).toBe("agent-comms-query-status");
      expect(queryAgentsStatusTool.permission).toBe("subagent");
    });

    test("无运行 Agent 时返回空列表", async () => {
      const result = await queryAgentsStatusTool.execute({});
      expect(result).toMatchObject({
        agents: [],
        success: true,
        totalRunning: 0,
      });
    });

    test("有运行 Agent 时返回列表", async () => {
      subAgentTracker.register({
        abortController: new AbortController(),
        agentId: "general",
        agentName: "General Agent",
        instanceId: "inst-general",
        prompt: "write code",
      });

      const result = await queryAgentsStatusTool.execute({});
      expect(result).toMatchObject({
        success: true,
        totalRunning: 1,
      });

      subAgentTracker.unregister("inst-general");
    });

    test("查询指定不存在的 instanceId", async () => {
      const result = await queryAgentsStatusTool.execute({
        instanceId: "ghost-999",
      });
      expect(result).toMatchObject({
        found: false,
        status: "not_running",
        success: true,
      });
    });

    test("查询指定存在的 instanceId", async () => {
      subAgentTracker.register({
        abortController: new AbortController(),
        agentId: "general",
        agentName: "General Agent",
        instanceId: "inst-general",
        prompt: "test",
      });

      const result = await queryAgentsStatusTool.execute({
        instanceId: "inst-general",
      });
      expect(result).toMatchObject({
        found: true,
        success: true,
      });

      subAgentTracker.unregister("inst-general");
    });
  });
});

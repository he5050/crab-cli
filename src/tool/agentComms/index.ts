/**
 * Agent 间通信工具 — 支持子代理间消息传递和状态查询。
 *
 * 职责:
 *   - 向运行中的 Agent 发送消息
 *   - 查询所有 Agent 状态
 *   - 支持多代理协作通信
 *   - 主代理向子代理注入指令
 *
 * 模块功能:
 *   - sendMessageToAgentTool: 发送消息工具
 *   - queryAgentsStatusTool: 查询状态工具
 *   - 运行时消息路由
 *   - 状态查询
 *
 * 使用场景:
 *   - 子代理间协作通信
 *   - 主代理向子代理发送指令
 *   - Agent 间结果传递
 *   - 查询运行中的 Agent 列表
 *
 * 边界:
 *   1. 权限:subagent
 *   2. 利用 SubAgentTracker 实现消息路由
 *   3. 只能向运行中的 Agent 发送消息
 *   4. 消息在下次处理循环中接收
 *   5. 支持状态查询
 *
 * 流程:
 *   1. 接收消息/查询请求
 *   2. 验证目标 Agent 存在
 *   3. 注入消息到目标队列
 *   4. 或查询 Agent 状态
 *   5. 返回操作结果
 */
import { z } from "zod";
import { type ToolContext, defineTool } from "@/tool/types";
import { injectToolSubAgentMessage, isToolSubAgentRunning, listToolSubAgents } from "@/agent";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:agent-comms");

/**
 * Send_message_to_agent — 向另一个运行中的 Agent 发送消息。
 *
 * 使用场景:
 *   - 子代理间协作通信
 *   - 主代理向子代理注入指令
 *   - Agent 间结果传递
 */
/** sendMessageToAgentTool 工具定义 */
export const sendMessageToAgentTool = defineTool({
  description:
    "向另一个运行中的 Agent 发送消息。用于多代理协作场景，" +
    "允许一个 Agent 向另一个运行中的 Agent 发送文本消息。" +
    "目标 Agent 会在下一次处理循环中收到消息。",
  execute: async ({ targetInstanceId, message, fromLabel }, _context?: ToolContext) => {
    try {
      // 先检查目标是否存在
      if (!isToolSubAgentRunning(targetInstanceId)) {
        return {
          error: `目标 Agent 不存在或已停止: ${targetInstanceId}`,
          hint: "使用 query_agents_status 查看当前运行中的 Agent 列表",
          success: false,
        };
      }

      const fromId = fromLabel ?? "主代理";
      const ok = injectToolSubAgentMessage(targetInstanceId, `[${fromId}] ${message}`);

      if (!ok) {
        return {
          error: `消息投递失败: ${targetInstanceId}`,
          success: false,
        };
      }

      log.info(`消息已发送: ${fromId} → ${targetInstanceId} (${message.length} 字符)`);
      return {
        delivered: true,
        messageLength: message.length,
        success: true,
        targetInstanceId,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`发送消息失败: ${msg}`);
      return { error: msg, success: false };
    }
  },
  name: "agent-comms-send-message",
  parameters: z.object({
    /** 消息来源描述(可选，用于日志) */
    fromLabel: z.string().optional().describe("发送者的标签(可选，便于调试)"),
    /** 消息内容 */
    message: z.string().describe("要发送的消息内容"),
    /** 目标 Agent 实例 ID */
    targetInstanceId: z.string().describe("目标 Agent 的实例 ID"),
  }),
  permission: "subagent",
  builtin: true,
});

/**
 * Query_agents_status — 查询所有运行中 Agent 的状态。
 *
 * 使用场景:
 *   - 查看当前有哪些子代理在运行
 *   - 监控子代理消息队列
 *   - 调试多代理协作
 */
/** queryAgentsStatusTool 工具定义 */
export const queryAgentsStatusTool = defineTool({
  description:
    "查询当前所有运行中 Agent 的状态。返回每个 Agent 的实例 ID、" +
    "类型、显示名称、启动时间和待处理消息数。用于多代理场景下的" +
    "状态监控和协作管理。",
  execute: async ({ instanceId }, _context?: ToolContext) => {
    try {
      if (instanceId) {
        // 查询单个 Agent
        const running = isToolSubAgentRunning(instanceId);
        if (!running) {
          return {
            found: false,
            instanceId,
            status: "not_running",
            success: true,
          };
        }
        const all = listToolSubAgents();
        const agent = all.find((a) => a.instanceId === instanceId);
        return {
          agent: agent ?? { instanceId, status: "unknown" },
          found: true,
          success: true,
        };
      }

      // 列出所有运行中 Agent
      const agents = listToolSubAgents();
      return {
        agents: agents.map((a) => ({
          agentName: a.agentName,
          instanceId: a.instanceId,
          pendingMessages: a.messageCount,
          startedAt: a.startedAt ? new Date(a.startedAt).toISOString() : undefined,
          uptimeMs: typeof a.startedAt === "number" ? Date.now() - a.startedAt : undefined,
        })),
        success: true,
        totalRunning: agents.length,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`查询 Agent 状态失败: ${msg}`);
      return { error: msg, success: false };
    }
  },
  name: "agent-comms-query-status",
  parameters: z.object({
    /** 指定查询某个 Agent 的详细状态(可选) */
    instanceId: z.string().optional().describe("指定查询某个 Agent 实例 ID(可选，不填则列出所有)"),
  }),
  permission: "subagent",
  builtin: true,
});

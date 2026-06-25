/**
 * Goal 工具 — 管理对话中的目标和任务。
 *
 * 职责:
 *   - 创建新目标
 *   - 更新目标进度
 *   - 标记目标完成(achieved/unmet)
 *   - 查看当前目标列表
 *   - 查看目标详情
 *
 * 模块功能:
 *   - goalTool: Goal 工具定义
 *   - create: 创建目标
 *   - update: 更新进度
 *   - complete: 标记完成
 *   - list: 列出目标
 *   - status: 查看详情
 *
 * 使用场景:
 *   - AI 需要管理对话目标
 *   - 跟踪任务进度
 *   - 进入 Ralph Loop 模式自动续接
 *   - 标记目标达成或无法达成
 *
 * 边界:
 *   1. 权限:goal
 *   2. 创建目标后进入 Ralph Loop 模式
 *   3. 标记完成必须提供证据
 *   4. 支持 Token 预算设置
 *   5. 通过 goalManager 管理目标
 *
 * 流程:
 *   1. 接收操作参数
 *   2. 根据 action 执行对应操作
 *   3. 创建/更新/完成目标
 *   4. 返回操作结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { goalManager } from "@/mission";

const log = createLogger("tool:goal");

/** 目标管理工具：创建、跟踪和完成对话目标，支持 Ralph Loop 模式 */
export const goalTool = defineTool({
  description:
    "管理对话中的目标和任务。支持创建、更新进度、标记完成、查看目标。" +
    "创建目标后会进入 Ralph Loop 模式:AI 每轮自动续接，直到目标达成或取消。" +
    "标记完成时必须提供具体证据(检视了哪些文件/输出/测试)。",
  execute: async ({ action, objective, status, explanation, sessionId, tokenBudget }, context) => {
    // 优先使用参数传入的 sessionId，其次使用 ToolContext 的 sessionId
    const sid = sessionId ?? context?.sessionId ?? `session_${Date.now().toString(36)}`;

    try {
      switch (action) {
        case "create": {
          if (!objective) {
            return { error: "创建目标需要提供 objective", success: false };
          }
          const goal = goalManager.createGoal({
            objective,
            sessionId: sid,
            tokenBudget,
          });
          return {
            action: "create",
            goal: {
              id: goal.id,
              objective: goal.objective,
              status: goal.status,
              tokenBudget: goal.tokenBudget,
            },
            message: `目标已创建 (id=${goal.id})，进入 Ralph Loop 模式。`,
            success: true,
          };
        }

        case "complete": {
          if (!status) {
            return { error: "标记完成需要提供 status (achieved/unmet)", success: false };
          }
          const updated = goalManager.modelUpdateGoal(sid, {
            explanation,
            status,
          });
          if (!updated) {
            return { error: "没有活跃目标可更新。请先创建目标。", success: false };
          }
          return {
            action: "complete",
            goal: {
              explanation: updated.lastExplanation,
              id: updated.id,
              runCount: updated.runCount,
              status: updated.status,
              tokensUsed: updated.tokensUsed,
            },
            message: `目标 ${updated.id} 已标记为 ${updated.status}。`,
            success: true,
          };
        }

        case "update": {
          const goal = goalManager.loadGoal(sid);
          if (!goal) {
            return { error: "没有活跃目标。", success: false };
          }
          return {
            action: "update",
            goal: {
              id: goal.id,
              objective: goal.objective,
              runCount: goal.runCount,
              status: goal.status,
              tokenBudget: goal.tokenBudget,
              tokensUsed: goal.tokensUsed,
            },
            success: true,
          };
        }

        case "list": {
          const goals = goalManager.loadAllGoals();
          return {
            action: "list",
            goals: goals.map((g) => ({
              id: g.id,
              objective: g.objective,
              runCount: g.runCount,
              sessionId: g.sessionId,
              status: g.status,
              tokenBudget: g.tokenBudget,
              tokensUsed: g.tokensUsed,
            })),
            success: true,
            total: goals.length,
          };
        }

        case "status": {
          const goal = goalManager.loadGoal(sid);
          if (!goal) {
            return { error: `没有找到会话 ${sid} 的目标。`, success: false };
          }
          return {
            action: "status",
            goal: {
              createdAt: goal.createdAt,
              id: goal.id,
              lastExplanation: goal.lastExplanation,
              objective: goal.objective,
              runCount: goal.runCount,
              status: goal.status,
              tokenBudget: goal.tokenBudget,
              tokensUsed: goal.tokensUsed,
              updatedAt: goal.updatedAt,
            },
            success: true,
            summary: goalManager.formatSummary(goal),
          };
        }

        default: {
          return { error: `未知操作: ${action}`, success: false };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Goal 操作失败: ${action}`, { error: msg });
      return { error: msg, success: false };
    }
  },
  name: "goal",
  parameters: z.object({
    action: z
      .enum(["create", "update", "complete", "list", "status"])
      .describe("操作:create=创建目标, update=更新进度, complete=标记完成, list=查看目标, status=查看详情"),
    explanation: z.string().optional().describe("状态更新的证据说明(complete 时建议填写)"),
    objective: z.string().optional().describe("目标描述(create 时必填)"),
    sessionId: z.string().optional().describe("关联的会话 ID(默认使用当前会话)"),
    status: z
      .enum(["achieved", "unmet"])
      .optional()
      .describe("完成状态(complete 时必填):achieved=已达成, unmet=无法达成"),
    tokenBudget: z.number().optional().describe("Token 预算(create 时可选，默认 2000000)"),
  }),
  permission: "goal",
  builtin: true,
});

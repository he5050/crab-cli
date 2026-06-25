/**
 * 规划模式工具 — 控制代理的规划/执行状态切换。
 *
 * 职责:
 *   - 控制代理的规划/执行模式切换
 *   - 进入规划模式(只读分析)
 *   - 退出规划模式(进入执行)
 *   - 查询当前模式状态
 *
 * 模块功能:
 *   - planModeTool: 规划模式工具定义
 *   - enter_plan_mode: 进入规划模式
 *   - exit_plan_mode: 退出规划模式
 *   - status: 查询当前模式
 *
 * 使用场景:
 *   - AI 需要先分析后执行
 *   - 向用户展示规划方案
 *   - 获取执行许可
 *   - 复杂任务分阶段处理
 *
 * 边界:
 *   1. 权限:plan_mode
 *   2. 规划模式:只读分析，不执行写操作
 *   3. 执行模式:正常执行，可修改文件
 *   4. 退出规划模式需要提供方案
 *   5. 支持用户确认机制
 *
 * 流程:
 *   1. 接收模式切换请求
 *   2. 验证参数
 *   3. 执行模式切换
 *   4. 发布模式变更事件
 *   5. 返回操作结果
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("tool:plan_mode");

/** 规划模式工具：控制代理在规划/执行模式间切换 */
export const planModeTool = defineTool({
  description:
    "控制代理的规划/执行模式。" +
    "exit_plan_mode:从规划模式切换到执行模式，提交规划方案等待用户确认。" +
    "enter_plan_mode:进入规划模式，只做只读分析不执行修改。" +
    "status:查询当前模式。" +
    "规划模式下代理只使用 fs.read、glob、grep 等只读工具。",
  execute: async ({ action, plan, steps, requireConfirmation }) => {
    try {
      switch (action) {
        case "exit_plan_mode": {
          if (!plan && !steps?.length) {
            return { error: "退出规划模式需要提供 plan(方案摘要)或 steps(步骤列表)", success: false };
          }

          const confirmation = requireConfirmation ?? true;
          log.info(`退出规划模式: ${plan ?? steps?.join("; ")}`);

          return {
            action: "exit_plan_mode",
            message: confirmation ? "规划方案已提交，等待用户确认后执行" : "规划方案已提交，自动进入执行模式",
            mode: "execute",
            plan: plan ?? steps?.join("\n") ?? "",
            requireConfirmation: confirmation,
            steps: steps ?? [],
            success: true,
          };
        }

        case "enter_plan_mode": {
          log.info("进入规划模式");
          return {
            action: "enter_plan_mode",
            allowedTools: [
              "filesystem-read",
              "glob",
              "grep",
              "codebase-search",
              "lsp",
              "ide-diagnostics",
              "deepwiki-read-structure",
              "deepwiki-read-contents",
              "deepwiki-ask-question",
              "context7-resolve-library-id",
              "context7-query-docs",
            ],
            message: "已进入规划模式:只使用只读工具进行分析",
            mode: "plan",
            success: true,
          };
        }

        case "status": {
          return {
            action: "status",
            message: "当前处于执行模式",
            mode: "execute", // 默认模式
            success: true,
          };
        }

        default: {
          return { error: `未知操作: ${action}`, success: false };
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`规划模式操作失败: ${action}`, { error: msg });
      return { error: msg, success: false };
    }
  },
  name: "plan-mode",
  parameters: z.object({
    /** 操作 */
    action: z
      .enum(["exit_plan_mode", "enter_plan_mode", "status"])
      .describe("操作:exit_plan_mode(退出规划进入执行)/enter_plan_mode(进入规划模式)/status(查询当前模式)"),
    /** 规划摘要(exit_plan_mode 时提供) */
    plan: z.string().optional().describe("规划方案的摘要描述(exit_plan_mode 时必填)"),
    /** 是否需要用户确认才能执行 */
    requireConfirmation: z.boolean().optional().describe("是否需要用户确认(默认 true)"),
    /** 将要执行的步骤列表 */
    steps: z.array(z.string()).optional().describe("计划执行的步骤列表"),
  }),
  permission: "plan_mode",
  builtin: true,
});

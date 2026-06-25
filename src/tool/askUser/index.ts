/**
 * 用户提问工具 — AI 向用户提问以获取确认或信息。
 *
 * 职责:
 *   - 向用户提问获取确认或信息
 *   - 支持文本输入模式
 *   - 支持单选/多选模式
 *   - 支持默认值设置
 *
 * 模块功能:
 *   - askUserQuestionTool: 用户提问工具定义
 *   - 文本输入提问
 *   - 选项选择提问
 *   - 多选支持
 *
 * 使用场景:
 *   - AI 需要用户确认操作
 *   - 获取用户输入信息
 *   - 提供选项让用户选择
 *   - 需要用户决策时
 *
 * 边界:
 *   1. 权限:ask-user(始终允许)
 *   2. 支持文本输入、单选、多选
 *   3. 通过 EventBus 发布事件
 *   4. TUI 层渲染提问弹窗
 *   5. 暂停执行等待用户响应
 *
 * 流程:
 *   1. 接收提问参数
 *   2. 构建提问事件
 *   3. 发布到 EventBus
 *   4. 等待用户响应
 *   5. 返回答案给 AI
 */
import { z } from "zod";
import { type ToolContext, defineTool } from "@/tool/types";
import { createLogger } from "@/core/logging/logger";
import { globalBus } from "@/bus";
import { AppEvent } from "@/bus";
import { prefixedId } from "@/core/id";

const log = createLogger("tool:ask-user");

const askOptionSchema = z.object({
  description: z.string().optional().describe("选项描述"),
  label: z.string().describe("选项显示文本"),
  value: z.string().describe("选项值"),
});

const askStepSchema = z.object({
  allowFreeInput: z.boolean().optional().describe("当前步骤是否允许用户输入自定义答案"),
  defaultValue: z.string().optional().describe("当前步骤默认回答"),
  id: z.string().optional().describe("步骤 ID，用于结果映射"),
  multiSelect: z.boolean().optional().describe("当前步骤是否允许多选"),
  options: z.array(askOptionSchema).optional().describe("当前步骤的预设选项"),
  placeholder: z.string().optional().describe("当前步骤自由输入提示文案"),
  question: z.string().describe("当前步骤要问用户的问题"),
  title: z.string().describe("步骤标题，会显示为顶部 Tab/阶段名"),
});

/** 向用户提问工具 — 支持文本输入、单选、多选模式 */
export const askUserQuestionTool = defineTool({
  description:
    "向用户提问以获取确认、选择或信息。" +
    "支持文本输入和多选/单选模式。" +
    "在需要用户确认操作(如删除、重命名)或获取额外信息时使用。" +
    "此工具会暂停执行等待用户响应。",
  execute: async (
    { question, options, multiSelect, defaultValue, allowFreeInput, placeholder, steps },
    context?: ToolContext,
  ) => {
    log.info(`向用户提问: ${question}`);

    // 如果有 ToolContext 且有回调，使用回调方式
    if (context?.askUser) {
      try {
        const answer = await context.askUser({
          allowFreeInput,
          defaultValue,
          multiSelect: multiSelect ?? false,
          options,
          placeholder,
          question,
          steps,
        });
        return {
          answer,
          question,
          success: true,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.warn(`用户取消提问: ${msg}`);
        return {
          cancelled: true,
          error: "用户取消了提问",
          question,
          success: false,
        };
      }
    }

    // 通过 EventBus 发布提问事件(TUI 层监听并处理)
    return new Promise((resolve) => {
      const requestId = prefixedId("ask");
      let settled = false;

      const cleanup = () => {
        unsub();
        if (timer) {
          clearTimeout(timer);
        }
      };

      // 监听回答事件
      const unsub = globalBus.subscribe(AppEvent.UserInput, (e) => {
        const props = e.properties as { requestId?: string; cancelled?: boolean; answer?: string | string[] };
        if (props.requestId === requestId && !settled) {
          settled = true;
          cleanup();
          if (props.cancelled) {
            resolve({
              cancelled: true,
              error: "用户取消了提问",
              question,
              success: false,
            });
          } else {
            resolve({
              answer: props.answer,
              question,
              success: true,
            });
          }
        }
      });

      // 发布提问事件
      globalBus.publish(AppEvent.UserInputRequested, {
        allowFreeInput,
        defaultValue,
        multiSelect: multiSelect ?? false,
        options,
        placeholder,
        question,
        requestId,
        steps,
      });

      // 超时处理(5 分钟)
      const timer = setTimeout(
        () => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve({
              error: "提问超时(5 分钟未响应)",
              question,
              success: false,
              timeout: true,
            });
          }
        },
        5 * 60 * 1000,
      );
    });
  },
  name: "askuser-ask-question",
  parameters: z.object({
    /** 是否允许自定义输入 */
    allowFreeInput: z.boolean().optional().describe("是否允许用户输入自定义答案"),
    /** 默认值 */
    defaultValue: z.string().optional().describe("默认回答(用户可以直接确认)"),
    /** 是否允许多选 */
    multiSelect: z.boolean().optional().describe("是否允许多选(默认 false)"),
    /** 选项列表(提供时变为选择模式) */
    options: z.array(askOptionSchema).optional().describe("预设选项列表(提供时变为选择模式)"),
    /** 自定义输入提示 */
    placeholder: z.string().optional().describe("自由输入模式的提示文案"),
    /** 问题内容 */
    question: z.string().describe("要问用户的问题"),
    /** 多阶段提问，用于 Tab/向导式决策 */
    steps: z.array(askStepSchema).optional().describe("多阶段问题列表；提供时 UI 会按 Tab/步骤逐项确认"),
  }),
  permission: "ask-user",
  builtin: true,
});

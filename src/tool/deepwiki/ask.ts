/**
 * DeepWiki ask_question 工具模块
 *
 * 职责:
 *   - 基于仓库文档，用自然语言提问并获得 AI 回答
 *   - 提供智能问答功能
 *   - 返回精准的技术回答
 *
 * 模块功能:
 *   - deepwikiAskQuestionTool: 智能问答工具
 *   - 调用 DeepWiki MCP API 进行问答
 *   - 返回 AI 生成的回答
 *
 * 使用场景:
 *   - 快速了解项目用法
 *   - 查询 API 文档
 *   - 获取配置方法
 *   - 解决技术问题
 *
 * 边界:
 *   1. 仅支持 GitHub 仓库
 *   2. 仓库名格式: owner/repo 或完整 URL
 *   3. 依赖 DeepWiki MCP API
 *   4. 需要网络连接
 *   5. 回答基于仓库文档内容
 *
 * 流程:
 *   1. 接收仓库名和问题参数
 *   2. 调用 askQuestion 获取回答
 *   3. 返回 AI 生成的答案
 *   4. 错误时返回错误信息
 */
import { z } from "zod";
import { defineTool } from "@/tool/types";
import { askQuestion } from "@/tool/deepwiki/client";
import { createLogger } from "@/core/logging/logger";
import type { DeepWikiAskResult } from "@/tool/deepwiki/types";

const log = createLogger("deepwiki:ask");

const AskQuestionSchema = z.object({
  question: z.string().describe("基于仓库文档的自然语言问题(如:如何配置项目的路由？)"),
  repoName: z
    .string()
    .describe('GitHub 仓库全名，格式: "owner/repo-name" 或完整 URL "https://github.com/owner/repo-name"'),
});

/** DeepWiki 智能问答工具 — 基于仓库文档用自然语言提问并获得 AI 回答 */
export const deepwikiAskQuestionTool = defineTool({
  description:
    "基于指定 GitHub 仓库的 DeepWiki 文档，用自然语言提问并获得 AI 生成的精准回答。适用于快速了解项目用法、API 文档、配置方法等。",
  execute: async (args, context): Promise<DeepWikiAskResult> => {
    try {
      context?.metadata?.("正在向 DeepWiki AI 提问...", {
        question: args.question,
        repoName: args.repoName,
      });

      const result = await askQuestion(args.repoName, args.question);

      context?.metadata?.("获得 AI 回答", {
        answerLength: result.answer.length,
        repoName: result.repoName,
      });

      return {
        answer: result.answer,
        question: result.question,
        repoName: result.repoName,
        status: "ok",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("提问失败:", { error: errorMsg });
      return {
        error: errorMsg,
        status: "error",
      };
    }
  },
  name: "deepwiki-ask-question",
  parameters: AskQuestionSchema,
  permission: "web.fetch",
  builtin: true,
});

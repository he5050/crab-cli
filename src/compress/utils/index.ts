/**
 * CompactAgent — 轻量级 AI 调用封装。
 *
 * 职责:
 *   - 使用主配置模型的轻量调用(用于压缩摘要等任务)
 *   - 大文档信息抽取
 *
 * 注意: extractWebPageContent 为遗留方法，计划迁移至独立 web-content 模块。
 * 新代码不应依赖此方法。
 *
 * 模块功能:
 *   - CompactAgent: 紧凑模式 Agent 类
 *   - isAvailable: 检查 Compact Agent 是否可用
 *   - clearCache: 清除缓存状态
 *   - call: 调用 Compact Agent 获取完整响应
 *   - extractWebPageContent: [遗留] 从网页内容中提取关键信息
 *   - CompactAgentOptions: Compact Agent 配置接口
 *
 * 使用场景:
 *   - 压缩摘要等轻量任务
 *   - 大文档信息抽取
 *
 * 边界:
 *   1. 使用主配置模型进行非流式调用
 *   2. 适用于轻量级任务
 *   3. 失败时返回原始内容
 *
 * 流程:
 *   1. 检查配置可用性
 *   2. 构建调用消息
 *   3. 执行 LLM 调用
 *   4. 返回处理结果
 */
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { createLogger } from "@/core/logging/logger";
import { completeLlm } from "@/api";

const log = createLogger("compress:compact-agent");

/** Compact Agent 配置 */
interface CompactAgentOptions {
  /** 系统提示词 */
  systemPrompt?: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 超时(毫秒) */
  timeout?: number;
}

const DEFAULT_OPTIONS: CompactAgentOptions = {
  maxTokens: 4096,
  systemPrompt: "你是一个内容提取助手。请准确提取并总结相关信息。",
  temperature: 0.3,
  timeout: 15_000,
};

/**
 * Compact Agent — 轻量 AI 调用。
 *
 * 使用主配置的模型进行非流式调用，
 * 适用于压缩摘要、内容提取等轻量任务。
 */
export class CompactAgent {
  private initialized = false;

  /**
   * 检查 Compact Agent 是否可用。
   */
  async isAvailable(appConfig: AppConfigSchema): Promise<boolean> {
    try {
      const hasProvider = Boolean(appConfig.defaultProvider?.provider);
      const hasModel = Boolean(appConfig.defaultProvider?.model);
      this.initialized = hasProvider && hasModel;
      return this.initialized;
    } catch {
      return false;
    }
  }

  /**
   * 清除缓存状态。
   */
  clearCache(): void {
    this.initialized = false;
  }

  /**
   * 调用 Compact Agent 获取完整响应。
   *
   * @param messages - 对话消息
   * @param appConfig - 应用配置
   * @param options - 调用选项
   * @returns 完整的文本响应
   */
  async call(messages: ModelMessage[], appConfig: AppConfigSchema, options?: CompactAgentOptions): Promise<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    try {
      const { text: result } = await completeLlm(appConfig, messages, {
        maxTokens: opts.maxTokens,
        system: opts.systemPrompt,
        temperature: opts.temperature,
        timeout: opts.timeout,
      });

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.warn(`Compact Agent 调用失败: ${errMsg}`);
      throw error;
    }
  }

  /**
   * 从网页内容中提取关键信息。
   *
   * @param content - 网页内容
   * @param query - 用户查询
   * @param url - 网页 URL(用于上下文)
   * @param appConfig - 应用配置
   * @returns 提取的关键信息，失败时返回原文
   */
  async extractWebPageContent(
    content: string,
    query: string,
    url: string,
    appConfig: AppConfigSchema,
  ): Promise<string> {
    const available = await this.isAvailable(appConfig);
    if (!available) {
      log.debug("Compact Agent 不可用，返回原始内容");
      return content;
    }

    try {
      const extractionPrompt = `You are a content extraction assistant. Extract and summarize the most relevant information from the web page based on the user's query.

User's Query: ${query}

Web Page URL: ${url}

Web Page Content:
${content}

Instructions:
1. Extract ONLY the information directly relevant to the user's query
2. Preserve important details, facts, code examples, and key points
3. Remove navigation, ads, irrelevant sections, and boilerplate text
4. Organize the information in a clear, structured format
5. Keep technical terms and specific details intact`;

      const messages: ModelMessage[] = [{ content: extractionPrompt, role: "user" }];

      const extracted = await this.call(messages, appConfig, {
        maxTokens: 4096,
        systemPrompt: "You are a content extraction assistant.",
        temperature: 0.2,
        timeout: 20_000,
      });

      if (!extracted || extracted.trim().length === 0) {
        log.warn("Compact Agent 返回空结果，使用原始内容");
        return content;
      }

      return extracted;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.warn(`Compact Agent 提取失败，使用原始内容: ${errMsg}`);
      return content;
    }
  }
}

/** 全局 Compact Agent 实例 */
export const compactAgent = new CompactAgent();

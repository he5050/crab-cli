/**
 * Specialized Agent 基类
 *
 * 职责:
 *   - 提供专用 Agent 的标准实现框架
 *   - 统一 LLM 调用、配置合并、错误处理
 *   - 减少重复代码，提高可维护性
 *
 * 使用场景:
 *   - codebaseIndex、codebaseReview、review 等专用 Agent
 *   - 任何需要调用 LLM 完成特定任务的 Agent
 *
 * 抽象方法:
 *   - getDefaultConfig(): 返回默认配置
 *   - buildMessages(config): 构建 LLM 消息列表
 *   - parseResult(response): 解析 LLM 响应
 *
 * 示例:
 * ```typescript
 * class MyAgent extends SpecializedAgent<MyConfig, MyResult> {
 *   protected getDefaultConfig(): MyConfig {
 *     return { ... };
 *   }
 *
 *   protected buildMessages(config: MyConfig): ModelMessage[] {
 *     return [{ role: "user", content: config.input }];
 *   }
 *
 *   protected parseResult(response: string): MyResult {
 *     return JSON.parse(response);
 *   }
 * }
 * ```
 */

import { createLogger } from "@/core/logging/logger";
import { completeLlm } from "@/api";
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";

/** Agent 调用超时错误 */
export class AgentTimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = "AgentTimeoutError";
  }
}

/** 基础配置接口 */
export interface BaseAgentConfig {
  /** 最大 token 数 */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 超时时间(毫秒) */
  timeoutMs?: number;
}

/** 基础结果接口 */
export interface BaseAgentResult {
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * Specialized Agent 抽象基类
 *
 * @template TConfig - 配置类型，必须继承 BaseAgentConfig
 * @template TResult - 结果类型，必须继承 BaseAgentResult
 */
export abstract class SpecializedAgent<TConfig extends BaseAgentConfig, TResult extends BaseAgentResult> {
  /** Agent 名称 */
  protected abstract readonly agentName: string;

  /** 日志记录器 */
  protected get log() {
    return createLogger(`agent:${this.agentName}`);
  }

  /**
   * 获取默认配置
   * 子类必须实现
   */
  protected abstract getDefaultConfig(): TConfig;

  /**
   * 构建 LLM 消息列表
   * 子类必须实现
   */
  protected abstract buildMessages(config: TConfig): ModelMessage[];

  /**
   * 解析 LLM 响应
   * 子类必须实现
   */
  protected abstract parseResult(response: string): TResult;

  /**
   * 执行 Agent
   *
   * @param config - 部分配置，会与默认配置合并
   * @param appConfig - 应用全局配置
   * @returns 执行结果
   */
  async execute(config: Partial<TConfig>, appConfig?: AppConfigSchema): Promise<TResult> {
    const startTime = Date.now();
    const mergedConfig = this.mergeConfig(config);

    try {
      this.log.info(`开始执行: ${this.agentName}`);

      const messages = this.buildMessages(mergedConfig);
      const response = await this.callLlm(messages, mergedConfig, appConfig);

      const result = this.parseResult(response);
      const duration = Date.now() - startTime;

      this.log.info(`执行完成: ${this.agentName} (${duration}ms, success=${result.success})`);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.log.error(`执行失败: ${this.agentName} (${duration}ms): ${errorMsg}`);

      return this.createErrorResult(errorMsg);
    }
  }

  /**
   * 调用 LLM
   * 子类可以覆盖以自定义 LLM 调用行为
   */
  protected async callLlm(messages: ModelMessage[], config: TConfig, appConfig?: AppConfigSchema): Promise<string> {
    if (!appConfig) {
      throw new Error("appConfig is required for LLM calls");
    }
    const llmPromise = completeLlm(appConfig, messages, {
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    }).then((r) => r.text);
    const timeoutMs = config.timeoutMs;
    if (!timeoutMs || timeoutMs <= 0) {
      return llmPromise;
    }
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new AgentTimeoutError(`LLM 调用超时 (${timeoutMs}ms)`, timeoutMs));
      }, timeoutMs);
    });
    return Promise.race([llmPromise, timeoutPromise]);
  }

  /**
   * 合并配置
   */
  protected mergeConfig(partial: Partial<TConfig>): TConfig {
    return {
      ...this.getDefaultConfig(),
      ...partial,
    };
  }

  /**
   * 创建错误结果
   * 子类可以覆盖以自定义错误结果格式
   */
  protected createErrorResult(error: string): TResult {
    return {
      error,
      success: false,
    } as TResult;
  }
}

/**
 * 创建简单的 Specialized Agent
 *
 * 适用于简单的场景，无需创建类
 *
 * @param name - Agent 名称
 * @param defaultConfig - 默认配置
 * @param buildMessages - 构建消息的函数
 * @param parseResult - 解析结果的函数
 * @returns Agent 执行函数
 */
export function createSpecializedAgent<TConfig extends BaseAgentConfig, TResult extends BaseAgentResult>(
  name: string,
  defaultConfig: TConfig,
  buildMessages: (config: TConfig) => ModelMessage[],
  parseResult: (response: string) => TResult,
): (config: Partial<TConfig>, appConfig?: AppConfigSchema) => Promise<TResult> {
  const log = createLogger(`agent:${name}`);

  return async (config: Partial<TConfig>, appConfig?: AppConfigSchema): Promise<TResult> => {
    const startTime = Date.now();
    const merged = { ...defaultConfig, ...config };

    try {
      log.info(`开始执行: ${name}`);

      const messages = buildMessages(merged);
      if (!appConfig) {
        throw new Error("appConfig is required for LLM calls");
      }
      const { text: response } = await completeLlm(appConfig, messages, {
        maxTokens: merged.maxTokens,
        temperature: merged.temperature,
      });

      const result = parseResult(response);
      const duration = Date.now() - startTime;

      log.info(`执行完成: ${name} (${duration}ms, success=${result.success})`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      log.error(`执行失败: ${name} (${duration}ms): ${errorMsg}`);
      return { error: errorMsg, success: false } as TResult;
    }
  };
}

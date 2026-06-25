/**
 * LLM 配置 — 会话级 LLM 调用参数。
 *
 * 从 ConversationHandler 提取的独立职责:
 *   - 持有 provider/model/temperature/topP/streamFn 配置
 *   - 提供 LlmLoopOptions 所需的参数子集
 *   - 支持序列化/恢复(不含 streamFn)
 *
 * 边界:
 *   1. 不包含 abortSignal、systemPrompt 等非 LLM 参数
 *   2. streamFn 是运行时注入(测试用)，不参与序列化
 */
import { streamLlm } from "@/api";

/** 可持久化的 LLM 配置快照(不含 streamFn) */
export interface LlmConfigSnapshot {
  providerId?: string;
  modelId?: string;
  temperature?: number;
  topP?: number;
}

export class LlmConfigState {
  providerId?: string;
  modelId?: string;
  temperature?: number;
  topP?: number;
  streamFn: typeof streamLlm;

  constructor(options: { streamFn?: typeof streamLlm } = {}) {
    this.streamFn = options.streamFn ?? streamLlm;
  }

  /** 导出可持久化的配置快照 */
  toSnapshot(): LlmConfigSnapshot {
    return {
      modelId: this.modelId,
      providerId: this.providerId,
      temperature: this.temperature,
      topP: this.topP,
    };
  }

  /** 从持久化快照恢复配置 */
  restoreFrom(snapshot: LlmConfigSnapshot): void {
    this.providerId = snapshot.providerId;
    this.modelId = snapshot.modelId;
    this.temperature = snapshot.temperature;
    this.topP = snapshot.topP;
  }

  /** 从 ConversationHandlerOptions 初始化 */
  applyOptions(options: {
    providerId?: string;
    modelId?: string;
    temperature?: number;
    topP?: number;
    streamFn?: typeof streamLlm;
  }): void {
    this.providerId = options.providerId;
    this.modelId = options.modelId;
    this.temperature = options.temperature;
    this.topP = options.topP;
    if (options.streamFn) {
      this.streamFn = options.streamFn;
    }
  }
}

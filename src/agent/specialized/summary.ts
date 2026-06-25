/**
 * 通用总结 Agent
 *
 * 职责:
 *   - 总结对话内容
 *   - 总结代码变更
 *   - 总结文件内容
 *   - 生成简洁的摘要
 *   - 支持多种总结类型
 *
 * 模块功能:
 *   - registerSummaryAgent: 注册总结 Agent
 *   - createSummary: 创建摘要
 *   - summarizeConversation: 总结对话
 *   - summarizeCodeChanges: 总结代码变更
 *   - summarizeDocument: 总结文档
 *   - SummaryConfig: 总结配置接口
 *   - SummaryResult: 总结结果接口
 *   - SummaryType: 总结类型定义
 *
 * 使用场景:
 *   - 长对话后生成总结
 *   - 代码审查后生成变更摘要
 *   - 阅读长文档后生成要点
 *   - 会话压缩和上下文管理
 *   - 错误信息总结
 *
 * 边界:
 *   1. 仅生成内容摘要，不修改原始内容
 *   2. 依赖 LLM 进行内容分析，需要有效的 LLM 配置
 *   3. 支持的最大内容长度受 LLM 上下文限制
 *   4. 摘要长度可通过配置调整
 *
 * 流程:
 *   1. 接收待总结的内容和类型
 *   2. 根据类型选择对应的总结策略
 *   3. 构建总结提示词
 *   4. 调用 LLM 生成摘要
 *   5. 返回结构化的总结结果
 */

import { createLogger } from "@/core/logging/logger";
import { completeLlm } from "@/api";
import type { ModelMessage } from "ai";
import type { AppConfigSchema } from "@/schema/config";
import { registerSummaryAgent } from "./summaryAgent";

const log = createLogger("agent:summary");

export { registerSummaryAgent };

/** 总结类型 */
export type SummaryType =
  | "conversation" // 对话总结
  | "code-change" // 代码变更总结
  | "document" // 文档总结
  | "tool-execution" // 工具执行总结
  | "session" // 会话总结
  | "error"; // 错误总结

/** 总结配置 */
export interface SummaryConfig {
  /** 总结类型 */
  type: SummaryType;
  /** 最大长度(字符数)，默认 500 */
  maxLength: number;
  /** 是否包含要点列表，默认 true */
  includeBulletPoints: boolean;
  /** 是否包含行动建议，默认 false */
  includeActionItems: boolean;
  /** 语言，默认 "zh" */
  language: "zh" | "en";
  /** 温度参数，默认 0.3 */
  temperature: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: Omit<SummaryConfig, "type"> = {
  includeActionItems: false,
  includeBulletPoints: true,
  language: "zh",
  maxLength: 500,
  temperature: 0.3,
};

/** 总结结果 */
export interface SummaryResult {
  /** 是否成功 */
  success: boolean;
  /** 总结类型 */
  type: SummaryType;
  /** 总结内容 */
  content: string;
  /** 要点列表 */
  bulletPoints?: string[];
  /** 行动建议 */
  actionItems?: string[];
  /** 原始内容长度 */
  originalLength: number;
  /** 总结长度 */
  summaryLength: number;
  /** 压缩率 */
  compressionRate: number;
  /** 错误信息 */
  error?: string;
}

/** 对话消息 */
export interface ConversationMessage {
  /** 角色 */
  role: "user" | "assistant" | "system";
  /** 内容 */
  content: string;
  /** 时间戳 */
  timestamp?: number;
}

/** 代码变更 */
export interface CodeChange {
  /** 文件路径 */
  filePath: string;
  /** 变更类型 */
  changeType: "added" | "modified" | "deleted";
  /** 添加的行数 */
  linesAdded: number;
  /** 删除的行数 */
  linesDeleted: number;
  /** 变更摘要 */
  summary?: string;
}

/**
 * 根据类型生成提示词
 */
export function buildSummaryPrompt(type: SummaryType, content: string, config: SummaryConfig): string {
  const lang = config.language === "zh" ? "中文" : "English";
  const { maxLength } = config;

  switch (type) {
    case "conversation": {
      return `请用${lang}总结以下对话内容，要求:
- 总结长度不超过 ${maxLength} 个字符
${config.includeBulletPoints ? "- 包含关键要点列表" : ""}
${config.includeActionItems ? "- 包含后续行动建议" : ""}
- 保持客观准确，不添加未提及的信息

对话内容:
${content}`;
    }

    case "code-change": {
      return `请用${lang}总结以下代码变更，要求:
- 总结长度不超过 ${maxLength} 个字符
${config.includeBulletPoints ? "- 包含关键变更要点" : ""}
- 说明变更的目的和影响
- 保持技术准确性

代码变更:
${content}`;
    }

    case "document": {
      return `请用${lang}总结以下文档内容，要求:
- 总结长度不超过 ${maxLength} 个字符
${config.includeBulletPoints ? "- 包含核心要点列表" : ""}
- 提取主要观点和结论
- 保持原文的核心信息

文档内容:
${content}`;
    }

    case "tool-execution": {
      return `请用${lang}总结以下工具执行结果，要求:
- 总结长度不超过 ${maxLength} 个字符
${config.includeBulletPoints ? "- 包含关键结果要点" : ""}
${config.includeActionItems ? "- 包含后续建议" : ""}
- 突出重要信息和异常

执行结果:
${content}`;
    }

    case "session": {
      return `请用${lang}总结以下会话，要求:
- 总结长度不超过 ${maxLength} 个字符
${config.includeBulletPoints ? "- 包含关键事件要点" : ""}
${config.includeActionItems ? "- 包含未完成的任务" : ""}
- 覆盖会话的主要活动和成果

会话内容:
${content}`;
    }

    case "error": {
      return `请用${lang}总结以下错误信息，要求:
- 总结长度不超过 ${maxLength} 个字符
${config.includeBulletPoints ? "- 包含错误原因要点" : ""}
${config.includeActionItems ? "- 包含解决建议" : ""}
- 清晰说明问题和解决方案

错误信息:
${content}`;
    }

    default: {
      return `请用${lang}总结以下内容，要求:
- 总结长度不超过 ${maxLength} 个字符
${config.includeBulletPoints ? "- 包含要点列表" : ""}
${config.includeActionItems ? "- 包含行动建议" : ""}

内容:
${content}`;
    }
  }
}

/**
 * 解析 AI 总结响应
 */
export function parseSummaryResponse(
  content: string,
  config: SummaryConfig,
): {
  summary: string;
  bulletPoints?: string[];
  actionItems?: string[];
} {
  const result: {
    summary: string;
    bulletPoints?: string[];
    actionItems?: string[];
  } = {
    summary: content.trim(),
  };

  // 尝试提取要点
  if (config.includeBulletPoints) {
    const bulletPatterns = [
      /(?:关键要点|核心要点|要点|主要点|Key Points?|Bullet Points?):?\s*\n([\s\S]*?)(?:\n\n|\n行动|行动建议|Action Items?:|$)/gi,
      /(?:-|\*|•)\s+(.+)/g,
    ];

    for (const pattern of bulletPatterns) {
      const matches = content.matchAll(pattern);
      const points: string[] = [];
      for (const match of matches) {
        const point = typeof match[1] === "string" ? match[1] : match[0].replace(/^[-*•]\s+/, "");
        if (point.trim()) {
          points.push(point.trim());
        }
      }
      if (points.length > 0) {
        result.bulletPoints = points;
        break;
      }
    }
  }

  // 尝试提取行动建议
  if (config.includeActionItems) {
    const actionPatterns = [
      /(?:行动建议|后续行动|建议|Action Items?|Next Steps?):?\s*\n([\s\S]*?)(?:\n\n|$)/gi,
      /(?:^|\n)\s*(?:-|\*|•|☐|☑|✅)\s+(.+)/g,
    ];

    for (const pattern of actionPatterns) {
      const matches = content.matchAll(pattern);
      const actions: string[] = [];
      for (const match of matches) {
        const action = typeof match[1] === "string" ? match[1] : match[0].replace(/^[-*•☐☑✅]\s+/, "");
        if (action.trim() && !action.toLowerCase().includes("无") && !action.toLowerCase().includes("none")) {
          actions.push(action.trim());
        }
      }
      if (actions.length > 0) {
        result.actionItems = actions;
        break;
      }
    }
  }

  return result;
}

export function createFallbackSummary(
  type: SummaryType,
  content: string,
  config: SummaryConfig,
  error?: string,
): SummaryResult {
  const normalized = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const plain = normalized.join(" ");
  const summary = plain.length > config.maxLength ? `${plain.slice(0, Math.max(0, config.maxLength - 3))}...` : plain;
  const bulletPoints = config.includeBulletPoints
    ? normalized.slice(0, 5).map((line) => line.replace(/^[-*•]\s*/, ""))
    : undefined;
  const originalLength = content.length;

  return {
    bulletPoints,
    compressionRate: originalLength > 0 ? summary.length / originalLength : 0,
    content: summary,
    error,
    originalLength,
    success: summary.length > 0,
    summaryLength: summary.length,
    type,
  };
}

/**
 * 统一总结执行管道
 */
async function executeSummaryTask(
  type: SummaryType,
  content: string,
  config: SummaryConfig,
  llmConfig: AppConfigSchema,
): Promise<SummaryResult> {
  const originalLength = content.length;

  try {
    const prompt = buildSummaryPrompt(type, content, config);

    const messages_for_llm: ModelMessage[] = [
      {
        content: prompt,
        role: "user",
      },
    ];

    const { text: result } = await completeLlm(llmConfig, messages_for_llm, {
      maxTokens: Math.min(config.maxLength * 2, 2000),
      modelId: llmConfig.defaultProvider?.model,
      temperature: config.temperature,
    });

    if (!result) {
      return createFallbackSummary(type, content, config, "AI 返回空内容");
    }

    const parsed = parseSummaryResponse(result, config);
    const summaryLength = parsed.summary.length;

    return {
      actionItems: parsed.actionItems,
      bulletPoints: parsed.bulletPoints,
      compressionRate: originalLength > 0 ? summaryLength / originalLength : 0,
      content: parsed.summary,
      originalLength,
      success: true,
      summaryLength,
      type,
    };
  } catch (error) {
    log.error(`总结执行失败 [${type}]`, { error: String(error) });
    return createFallbackSummary(type, content, config, String(error));
  }
}

/**
 * 总结对话
 */
export async function summarizeConversation(
  messages: ConversationMessage[],
  partialConfig?: Partial<Omit<SummaryConfig, "type">>,
  llmConfig?: AppConfigSchema,
): Promise<SummaryResult> {
  const config: SummaryConfig = {
    type: "conversation",
    ...DEFAULT_CONFIG,
    ...partialConfig,
  };

  const loadedConfig = llmConfig ?? (await import("@config").then((m) => m.loadConfig()));
  const actualLlmConfig = loadedConfig!;
  const conversationText = messages
    .map((msg) => {
      const roleLabel = msg.role === "user" ? "用户" : msg.role === "assistant" ? "助手" : "系统";
      return `[${roleLabel}] ${msg.content}`;
    })
    .join("\n\n");

  return executeSummaryTask("conversation", conversationText, config, actualLlmConfig);
}

/**
 * 总结代码变更
 */
export async function summarizeCodeChanges(
  changes: CodeChange[],
  partialConfig?: Partial<Omit<SummaryConfig, "type">>,
  llmConfig?: AppConfigSchema,
): Promise<SummaryResult> {
  const config: SummaryConfig = {
    type: "code-change",
    ...DEFAULT_CONFIG,
    ...partialConfig,
  };

  const loadedConfig = llmConfig ?? (await import("@config").then((m) => m.loadConfig()));
  const actualLlmConfig = loadedConfig!;
  const changesText = changes
    .map((change) => {
      const typeLabel = change.changeType === "added" ? "新增" : change.changeType === "modified" ? "修改" : "删除";
      const stats =
        change.changeType === "deleted"
          ? `删除 ${change.linesDeleted} 行`
          : change.changeType === "added"
            ? `新增 ${change.linesAdded} 行`
            : `+${change.linesAdded} -${change.linesDeleted}`;
      return `- ${typeLabel}: ${change.filePath} (${stats})${change.summary ? `\n  ${change.summary}` : ""}`;
    })
    .join("\n");

  return executeSummaryTask("code-change", changesText, config, actualLlmConfig);
}

/**
 * 总结文档
 */
export async function summarizeDocument(
  content: string,
  partialConfig?: Partial<Omit<SummaryConfig, "type">>,
  llmConfig?: AppConfigSchema,
): Promise<SummaryResult> {
  const config: SummaryConfig = {
    type: "document",
    ...DEFAULT_CONFIG,
    ...partialConfig,
  };

  const loadedConfig = llmConfig ?? (await import("@config").then((m) => m.loadConfig()));
  const actualLlmConfig = loadedConfig!;

  return executeSummaryTask("document", content, config, actualLlmConfig);
}

/**
 * 通用总结函数
 */
export async function createSummary(
  content: string,
  type: SummaryType,
  partialConfig?: Partial<Omit<SummaryConfig, "type">>,
  llmConfig?: AppConfigSchema,
): Promise<SummaryResult> {
  const config: SummaryConfig = {
    type,
    ...DEFAULT_CONFIG,
    ...partialConfig,
  };

  const loadedConfig = llmConfig ?? (await import("@config").then((m) => m.loadConfig()));
  const actualLlmConfig = loadedConfig!;

  return executeSummaryTask(type, content, config, actualLlmConfig);
}

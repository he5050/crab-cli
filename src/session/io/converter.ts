/**
 * 会话转换器 — 支持多种会话格式之间的转换。
 *
 * 职责:
 *   - Cursor 格式转 crab 格式
 *   - VS Code 对话历史导入
 *   - 其他 IDE/工具格式转换
 *   - 格式验证和修复
 *
 * 模块功能:
 *   - convertSession:转换会话格式
 *   - convertMultiple:批量转换会话
 *   - detectConvertFormat:检测转换格式
 *   - validateSessionData:验证会话数据
 *
 * 使用场景:
 *   - 从其他 IDE 导入会话历史
 *   - 迁移外部工具的对话数据
 *   - 格式转换和验证
 *
 * 边界:
 *   1. 支持 Cursor (composer/chat history)
 *   2. 支持 VS Code Copilot Chat
 *   3. 支持 GitHub Copilot
 *   4. 支持 Continue.dev
 *   5. 支持 OpenAI 格式
 *   6. 目标格式默认为 crab
 *
 * 流程:
 *   1. 读取源格式数据
 *   2. 检测或指定源格式
 *   3. 解析源格式消息
 *   4. 转换为 crab 格式
 *   5. 验证转换结果
 */

import { createLogger } from "@/core/logging/logger";
import type { MessagePart } from "../core/message";

const log = createLogger("session:converter");

/** 转换格式 */
export type ConvertFormat = "cursor" | "vscode-copilot" | "continue" | "openai";

/** 转换选项 */
export interface ConvertOptions {
  /** 源格式 */
  from: ConvertFormat;
  /** 目标格式(默认 crab) */
  to?: "crab";
  /** 是否保留元数据 */
  preserveMetadata?: boolean;
  /** 时区偏移(毫秒) */
  timezoneOffset?: number;
}

/** 转换结果 */
export interface ConvertResult {
  success: boolean;
  /** 转换后的 crab 格式消息 */
  messages?: {
    role: "user" | "assistant" | "system" | "tool";
    parts: MessagePart[];
    timestamp?: number;
    metadata?: Record<string, unknown>;
  }[];
  /** 会话标题 */
  title?: string;
  /** 模型信息 */
  model?: string;
  /** 错误信息 */
  error?: string;
  /** 警告信息 */
  warnings?: string[];
}

/** Cursor 消息格式 */
interface CursorMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  model?: string;
}

/** Cursor Composer 状态 */
interface CursorComposerState {
  title?: string;
  messages: CursorMessage[];
  model?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** VS Code Copilot 消息 */
interface VSCodeCopilotMessage {
  role: number; // 1=user, 2=assistant
  content: string;
  timestamp?: number;
}

/** VS Code Copilot 会话 */
interface VSCodeCopilotSession {
  title?: string;
  requests: VSCodeCopilotMessage[];
  model?: string;
}

/** Continue.dev 消息 */
interface ContinueMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
}

/** Continue.dev 会话 */
interface ContinueSession {
  title?: string;
  history: ContinueMessage[];
  model?: string;
}

/**
 * 检测输入数据的格式
 */
export function detectConvertFormat(data: unknown): ConvertFormat | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Cursor Composer 格式
  if ("messages" in obj && Array.isArray(obj.messages)) {
    const msgs = obj.messages as Record<string, unknown>[];
    if (msgs.length > 0 && "role" in msgs[0]! && "content" in msgs[0]!) {
      // 检查是否是 Cursor 格式(有 timestamp 或 model 字段)
      if ("model" in obj || msgs[0]!.timestamp !== undefined) {
        return "cursor";
      }
    }
  }

  // VS Code Copilot 格式
  if ("requests" in obj && Array.isArray(obj.requests)) {
    return "vscode-copilot";
  }

  // Continue.dev 格式
  if ("history" in obj && Array.isArray(obj.history)) {
    return "continue";
  }

  // OpenAI 格式
  if ("messages" in obj && Array.isArray(obj.messages)) {
    const msgs = obj.messages as Record<string, unknown>[];
    if (msgs.length > 0 && "role" in msgs[0]! && ("content" in msgs[0]! || "parts" in msgs[0]!)) {
      return "openai";
    }
  }

  return null;
}

/**
 * 转换会话数据
 */
export function convertSession(data: unknown, options: ConvertOptions): ConvertResult {
  const warnings: string[] = [];

  try {
    // 自动检测格式
    const detectedFormat = detectConvertFormat(data);
    const fromFormat = options.from || detectedFormat;

    if (!fromFormat) {
      return {
        error: "无法识别输入数据格式",
        success: false,
      };
    }

    if (detectedFormat && detectedFormat !== fromFormat) {
      warnings.push(`检测到格式为 ${detectedFormat}，但指定了 ${fromFormat}`);
    }

    switch (fromFormat) {
      case "cursor": {
        return convertCursorToCrab(data, options, warnings);
      }
      case "vscode-copilot": {
        return convertVSCodeCopilotToCrab(data, options, warnings);
      }
      case "continue": {
        return convertContinueToCrab(data, options, warnings);
      }
      case "openai": {
        return convertOpenAIToCrab(data, options, warnings);
      }
      default: {
        return {
          success: false,
          error: `不支持的转换格式: ${fromFormat}`,
        };
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`转换失败: ${error}`);
    return {
      error,
      success: false,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}

// ─── Cursor 格式转换 ───────────────────────────────────────────────────────

function convertCursorToCrab(data: unknown, options: ConvertOptions, warnings: string[]): ConvertResult {
  const cursorState = data as CursorComposerState;
  const messages: ConvertResult["messages"] = [];

  for (const msg of cursorState.messages || []) {
    try {
      const parts: MessagePart[] = [{ content: msg.content, type: "text" }];

      messages.push({
        metadata: options.preserveMetadata ? { model: msg.model, source: "cursor" } : undefined,
        parts,
        role: msg.role,
        timestamp: msg.timestamp,
      });
    } catch (error) {
      warnings.push(`消息转换失败: ${error}`);
    }
  }

  log.info(`Cursor 转换完成: ${messages.length} 条消息`);

  return {
    messages,
    model: cursorState.model,
    success: true,
    title: cursorState.title,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ─── VS Code Copilot 格式转换 ──────────────────────────────────────────────

function convertVSCodeCopilotToCrab(data: unknown, options: ConvertOptions, warnings: string[]): ConvertResult {
  const session = data as VSCodeCopilotSession;
  const messages: ConvertResult["messages"] = [];

  // VS Code Copilot 使用 role: 1=user, 2=assistant
  const roleMap: Record<number, "user" | "assistant"> = {
    1: "user",
    2: "assistant",
  };

  for (const req of session.requests || []) {
    try {
      const role = roleMap[req.role];
      if (!role) {
        warnings.push(`未知的角色类型: ${req.role}`);
        continue;
      }

      const parts: MessagePart[] = [{ content: req.content, type: "text" }];

      messages.push({
        metadata: options.preserveMetadata ? { source: "vscode-copilot" } : undefined,
        parts,
        role,
        timestamp: req.timestamp,
      });
    } catch (error) {
      warnings.push(`消息转换失败: ${error}`);
    }
  }

  log.info(`VS Code Copilot 转换完成: ${messages.length} 条消息`);

  return {
    messages,
    model: session.model,
    success: true,
    title: session.title,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ─── Continue.dev 格式转换 ─────────────────────────────────────────────────

function convertContinueToCrab(data: unknown, options: ConvertOptions, warnings: string[]): ConvertResult {
  const session = data as ContinueSession;
  const messages: ConvertResult["messages"] = [];

  for (const msg of session.history || []) {
    try {
      const parts: MessagePart[] = [{ content: msg.content, type: "text" }];

      messages.push({
        metadata: options.preserveMetadata ? { source: "continue" } : undefined,
        parts,
        role: msg.role,
        timestamp: msg.timestamp,
      });
    } catch (error) {
      warnings.push(`消息转换失败: ${error}`);
    }
  }

  log.info(`Continue.dev 转换完成: ${messages.length} 条消息`);

  return {
    messages,
    model: session.model,
    success: true,
    title: session.title,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ─── OpenAI 格式转换 ───────────────────────────────────────────────────────

function convertOpenAIToCrab(data: unknown, options: ConvertOptions, warnings: string[]): ConvertResult {
  const obj = data as { messages?: Record<string, unknown>[]; title?: string; model?: string };
  const messages: ConvertResult["messages"] = [];

  for (const msg of obj.messages || []) {
    try {
      const role = msg.role as "user" | "assistant" | "system" | "tool";
      let content = "";
      const parts: MessagePart[] = [];

      // 处理不同格式的 content
      if (typeof msg.content === "string") {
        ({ content } = msg);
        parts.push({ content, type: "text" });
      } else if (Array.isArray(msg.content)) {
        // OpenAI 新格式(content as array of parts)
        for (const part of msg.content) {
          if (typeof part === "string") {
            parts.push({ content: part, type: "text" });
          } else if (part && typeof part === "object") {
            if (part.type === "text") {
              parts.push({ content: String(part.text || ""), type: "text" });
            } else if (part.type === "image_url") {
              // 将图片 URL 作为文本保留(crab-cli 暂不支持图片类型)
              parts.push({ content: String((part as any).image_url?.url || ""), type: "text" });
            }
          }
        }
      }

      // 处理 tool_calls
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const toolCall of msg.tool_calls) {
          if (toolCall && typeof toolCall === "object") {
            parts.push({
              content: JSON.stringify(toolCall.arguments || toolCall.function?.arguments || {}),
              tool_name: String(toolCall.name || toolCall.function?.name || "unknown"),
              type: "tool_use",
            } as MessagePart);
          }
        }
      }

      messages.push({
        metadata: options.preserveMetadata ? { source: "openai" } : undefined,
        parts,
        role,
      });
    } catch (error) {
      warnings.push(`消息转换失败: ${error}`);
    }
  }

  log.info(`OpenAI 转换完成: ${messages.length} 条消息`);

  return {
    messages,
    model: obj.model,
    success: true,
    title: obj.title,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ─── 批量转换 ──────────────────────────────────────────────────────────────

/**
 * 批量转换多个会话
 */
export function convertMultiple(items: { data: unknown; options: ConvertOptions }[]): ConvertResult[] {
  return items.map((item) => convertSession(item.data, item.options));
}

// ─── 格式验证 ──────────────────────────────────────────────────────────────

/**
 * 验证输入数据是否为有效的会话格式
 */
export function validateSessionData(data: unknown): {
  valid: boolean;
  format?: ConvertFormat;
  errors?: string[];
} {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null) {
    return { errors: ["数据必须是对象类型"], valid: false };
  }

  const obj = data as Record<string, unknown>;
  const format = detectConvertFormat(data);

  if (!format) {
    return {
      errors: ["无法识别会话格式，支持的格式: Cursor, VS Code Copilot, Continue.dev, OpenAI"],
      valid: false,
    };
  }

  // 格式特定验证
  switch (format) {
    case "cursor": {
      if (!Array.isArray(obj.messages)) {
        errors.push("Cursor 格式需要 messages 数组");
      }
      break;
    }
    case "vscode-copilot": {
      if (!Array.isArray(obj.requests)) {
        errors.push("VS Code Copilot 格式需要 requests 数组");
      }
      break;
    }
    case "continue": {
      if (!Array.isArray(obj.history)) {
        errors.push("Continue.dev 格式需要 history 数组");
      }
      break;
    }
    case "openai": {
      if (!Array.isArray(obj.messages)) {
        errors.push("OpenAI 格式需要 messages 数组");
      }
      break;
    }
  }

  return {
    errors: errors.length > 0 ? errors : undefined,
    format,
    valid: errors.length === 0,
  };
}

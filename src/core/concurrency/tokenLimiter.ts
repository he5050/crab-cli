/**
 * Token 限制器 — 统一的工具返回结果 token 长度拦截器
 *
 * 职责:
 *   - 在所有 MCP 工具返回给 AI 之前验证内容长度
 *   - 超限时自动截断并附加提示信息
 *   - 使用 tiktoken 精确计算(可选)，失败回退字符估算
 *
 * 模块功能:
 *   - getToolResultTokenLimit: 获取工具返回结果 token 限制
 *   - validateTokenLimit: 验证内容的 token 长度
 *   - wrapToolResultWithTokenLimit: 包装工具结果并检查限制
 *   - estimateTokenCount: 估算 token 数量
 *   - truncateToTokenLimit: 截断字符串到指定 token 数量
 *
 * 使用场景:
 *   - 工具返回结果长度控制
 *   - 防止 AI 模型过载
 *   - 大内容自动截断
 *
 * 边界:
 * 1. 优先使用 tiktoken，失败回退字符估算
 * 2. 默认基于 maxContextTokens 的百分比计算限制
 * 3. 自动移除 base64 图片数据后再计算
 *
 * 流程:
 * 1. 获取 token 限制配置
 * 2. 移除 base64 图片数据
 * 3. 使用 tiktoken 或字符估算计算 token 数
 * 4. 检查是否超过限制
 * 5. 超限时截断内容并附加提示
 */

import { createLogger } from "@/core/logging/logger";
import { estimateTokens as _estimateTokens } from "@/session/token/tokenCounterRef";

/** Re-export estimateTokens for downstream consumers */
export const estimateTokens = _estimateTokens;

const log = createLogger("core:token-limiter");

/** 默认的工具返回结果 token 限制百分比(基于 maxContextTokens) */
const DEFAULT_TOOL_RESULT_TOKEN_LIMIT_PERCENT = 30;

/** 最小限制百分比 */
const MIN_PERCENT = 20;

/** 最大限制百分比 */
const MAX_PERCENT = 80;

/** 默认 maxContextTokens */
const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;

export interface ToolResultTokenLimitConfig {
  maxContextTokens?: number;
  toolResultTokenLimitPercent?: number;
}

/**
 * 获取配置的工具返回结果 token 限制。
 * 基于 maxContextTokens 的百分比计算。
 *
 * 兼容旧 tool/tokenLimiter 的配置对象签名，也支持直接传 maxContextTokens。
 */
export function getToolResultTokenLimit(input?: number | ToolResultTokenLimitConfig): number {
  const contextTokens = typeof input === "number" ? input : (input?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS);

  let percentage =
    typeof input === "object" && input !== null
      ? (input.toolResultTokenLimitPercent ?? DEFAULT_TOOL_RESULT_TOKEN_LIMIT_PERCENT)
      : DEFAULT_TOOL_RESULT_TOKEN_LIMIT_PERCENT;

  // 确保百分比在有效范围内
  percentage = Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, percentage));

  return Math.floor((contextTokens * percentage) / 100);
}

export interface TokenLimitResult {
  /** 是否被截断(仅同步截断 validateAndTruncate 返回时有值) */
  truncated?: boolean;
  /** 是否通过验证(async validateTokenLimit 返回时使用) */
  isValid?: boolean;
  tokenCount: number;
  errorMessage?: string;
  /** Token 限制(旧 tool/tokenLimiter 同步接口返回) */
  tokenLimit?: number;
  /** 截断后的内容 */
  content?: string;
  /** 截断提示信息 */
  truncationMessage?: string;
}

export interface SyncTokenLimitResult extends TokenLimitResult {
  isValid: boolean;
  truncated: boolean;
  tokenLimit: number;
  content: string;
}

/**
 * 移除内容中的 base64 图片数据(token 计算前清理)。
 */
function removeBase64Images(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === "string") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => removeBase64Images(item));
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const key in obj as Record<string, unknown>) {
      if ((obj as Record<string, unknown>).hasOwnProperty(key)) {
        const val = (obj as Record<string, unknown>)[key];
        // 跳过 base64 图片字段
        if (key === "data" && typeof val === "string" && (obj as Record<string, unknown>).type === "image") {
          result[key] = "[base64 image data removed for token calculation]";
        } else if (
          key === "source" &&
          typeof val === "object" &&
          val !== null &&
          (val as Record<string, unknown>).type === "base64"
        ) {
          result[key] = {
            ...(val as Record<string, unknown>),
            data: "[base64 image data removed for token calculation]",
          };
        } else {
          result[key] = removeBase64Images(val);
        }
      }
    }
    return result;
  }

  return obj;
}

/** 缓存的 tiktoken encoder 实例（避免每次调用重复创建/销毁） */
let cachedEncoder: { encode(t: string): number[]; free(): void } | null = null;
let encoderModel = "";

/**
 * 获取或创建 tiktoken encoder（懒加载 + 缓存）。
 * 优先尝试 gpt-4o，不可用时回退 gpt-3.5-turbo。
 */
async function getOrCreateEncoder(): Promise<typeof cachedEncoder> {
  if (cachedEncoder && encoderModel) {
    return cachedEncoder;
  }
  try {
    // @ts-expect-error — tiktoken 是可选依赖，类型声明可能不存在
    const tiktoken = await import("tiktoken");
    const { encoding_for_model } = tiktoken;
    for (const model of ["gpt-4o", "gpt-3.5-turbo"]) {
      try {
        cachedEncoder = encoding_for_model(model);
        encoderModel = model;
        log.debug(`tiktoken encoder 已缓存: ${model}`);
        return cachedEncoder;
      } catch {
        continue;
      }
    }
  } catch {
    // tiktoken 不可用
  }
  return null;
}

/**
 * 估算 token 数量。
 * 优先使用缓存的 tiktoken encoder，失败回退到统一的 CJK 感知字符估算。
 */
async function estimateTokenCount(content: string): Promise<number> {
  const encoder = await getOrCreateEncoder();
  if (encoder) {
    try {
      const tokens = encoder.encode(content);
      return tokens.length;
    } catch {
      // encoder 编码失败，回退
      return estimateTokens(content);
    }
  }
  return estimateTokens(content);
}

/**
 * 截断字符串到指定的 token 数量。
 */
async function truncateToTokenLimit(content: string, maxTokens: number): Promise<string> {
  const encoder = await getOrCreateEncoder();
  if (encoder) {
    try {
      const tokens = encoder.encode(content);
      if (tokens.length <= maxTokens) {
        return content;
      }
      const truncatedTokens = tokens.slice(0, maxTokens);
      try {
        // tiktoken 为可选依赖，未安装时回退到字符比例估算
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error tiktoken 为可选依赖，类型声明可能缺失
        const decoderModule = await import("tiktoken");
        const decoder = decoderModule.decode
          ? decoderModule.decode
          : (() => {
              const decoder = new TextDecoder();
              return (ids: number[]) => decoder.decode(new TextEncoder().encode(ids.map(String).join(" ")));
            })();
        return decoder(truncatedTokens);
      } catch {
        const ratio = maxTokens / tokens.length;
        const maxChars = Math.max(1, Math.floor(content.length * ratio));
        return content.slice(0, maxChars);
      }
    } catch {
      // encoder 失败，回退到字符估算
    }
  }
  // Tiktoken 不可用或编码失败:按统一 CJK 感知估算的 token/字符比，推导截断字符上限
  const estimatedTotal = estimateTokens(content);
  if (estimatedTotal <= maxTokens) {
    return content;
  }
  const ratio = maxTokens / estimatedTotal;
  const maxChars = Math.max(1, Math.floor(content.length * ratio));
  return content.slice(0, maxChars);
}

/**
 * 验证内容的 token 长度。
 */
export async function validateTokenLimit(content: unknown, maxTokens?: number): Promise<TokenLimitResult> {
  const limit = maxTokens ?? getToolResultTokenLimit();

  if (content === null || content === undefined) {
    return { isValid: true, tokenCount: 0 };
  }

  // 移除 base64 图片后再计算
  const contentWithoutImages = removeBase64Images(content);

  let contentStr: string;
  if (typeof contentWithoutImages === "string") {
    contentStr = contentWithoutImages;
  } else if (typeof contentWithoutImages === "object") {
    contentStr = JSON.stringify(contentWithoutImages);
  } else {
    contentStr = String(contentWithoutImages);
  }

  const tokenCount = await estimateTokenCount(contentStr);

  if (tokenCount > limit) {
    return {
      errorMessage:
        `内容过大: ${tokenCount} tokens (超过 ${limit} token 限制)。\n` +
        `这是防止 AI 模型过载的安全限制。\n` +
        `建议:将操作拆分为更小的块，或使用过滤器减少数据量。`,
      isValid: false,
      tokenCount,
    };
  }

  return { isValid: true, tokenCount };
}

/**
 * 包装工具结果，在返回前进行 token 限制检查。
 * 如果超限，会截断内容并附加提示信息。
 */
export async function wrapToolResultWithTokenLimit(
  result: unknown,
  toolName: string,
  maxTokens?: number,
): Promise<unknown> {
  const limit = maxTokens ?? getToolResultTokenLimit();
  const validation = await validateTokenLimit(result, limit);

  if (!validation.isValid) {
    // 将结果转换为字符串进行截断
    let contentStr: string;
    if (typeof result === "string") {
      contentStr = result;
    } else if (typeof result === "object") {
      contentStr = JSON.stringify(result, null, 2);
    } else {
      contentStr = String(result);
    }

    // 预留 token 给截断提示信息
    const reservedTokens = 100;
    const truncateLimit = Math.max(limit - reservedTokens, Math.floor(limit * 0.9));
    const truncatedContent = await truncateToTokenLimit(contentStr, truncateLimit);

    const truncationNotice =
      `\n\n[TRUNCATED] 工具 "${toolName}" 的输出因 token 限制被截断。\n` +
      `原始: ~${validation.tokenCount} tokens | 限制: ${limit} tokens\n` +
      `以上内容不完整。请使用更精确的查询或过滤器获取更小的结果。`;

    log.warn(`工具 ${toolName} 输出被截断: ${validation.tokenCount}/${limit} tokens`);

    return truncatedContent + truncationNotice;
  }

  return result;
}

// ── 同步版本的截断接口(兼容 tool/tokenLimiter 的 validateAndTruncate) ──

/**
 * 同步验证并截断工具返回内容。
 *
 * 这是 wrapToolResultWithTokenLimit 的同步简化版，
 * 用于不依赖 async 上下文的快速截断场景。
 * 无 tiktoken 尝试，直接使用 CJK 字符估算。
 */
export function validateAndTruncate(content: string, tokenLimit: number): SyncTokenLimitResult {
  // 快速剥离 base64 图片
  const cleaned = content.replace(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/g, "[base64 image data removed]");

  const tokenCount = estimateTokens(cleaned);

  if (tokenCount <= tokenLimit) {
    return {
      content: cleaned,
      isValid: true,
      tokenCount,
      tokenLimit,
      truncated: false,
    };
  }

  // 按字符比例估算截断位置
  const ratio = tokenLimit / tokenCount;
  const targetChars = Math.max(1, Math.floor(cleaned.length * ratio * 0.9));

  log.debug(`同步截断: ${tokenCount} tokens → ~${tokenLimit} (截断到 ${targetChars} 字符)`);

  return {
    content: `${cleaned.substring(
      0,
      targetChars,
    )}\n\n[... Output truncated: ${tokenCount} tokens total, showing first ~${tokenLimit} tokens ...]`,
    errorMessage: `内容过大: ${tokenCount} tokens (超过 ${tokenLimit} token限制)。`,
    isValid: false,
    tokenCount,
    tokenLimit,
    truncated: true,
    truncationMessage: `Output truncated from ${tokenCount} to ~${tokenLimit} tokens`,
  };
}

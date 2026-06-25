/**
 * LLM 错误处理 — 错误分类和友好提示。
 *
 * 职责:
 *   - 提供错误分类
 *   - 提供友好提示
 *   - 判断错误是否可恢复
 *
 * 模块功能:
 *   - extractErrorDetail: 安全提取 Error 对象中的额外细节
 *   - isRecoverableError: 判断错误是否值得尝试降级
 *   - getFriendlyError: 将 API 错误转换为用户友好的错误信息
 *   - ApiErrorType: 错误类型
 *   - FriendlyError: 友好错误信息接口
 *
 * 使用场景:
 *   - API 调用错误处理
 *   - 降级策略决策
 *   - 用户错误提示
 *
 * 边界:
 *   1. 纯错误处理逻辑，不依赖业务状态
 *   2. 支持多种错误类型(auth、network、model、rate_limit、timeout、unknown)
 *   3. 认证类错误(401/403)不可恢复
 *
 * 流程:
 *   1. 接收错误对象
 *   2. 提取错误详情
 *   3. 判断错误类型
 *   4. 判断是否可以恢复
 *   5. 生成友好错误信息
 */

import {
  AppError,
  createInternalError,
  createNetworkError,
  createSecurityError,
  createUserError,
} from "@/core/errors/appError";

/** 错误类型 */
export type ApiErrorType = "auth" | "network" | "model" | "rate_limit" | "timeout" | "unknown";

/** 支持的语言 */
export type Locale = "zh" | "en";

/**
 * 多语言友好错误信息字典 — 按 status code / 类型 / 关键词索引。
 * 未来新增语言时, 只需扩展此字典, 无需修改 getFriendlyError 逻辑。
 */
const FRIENDLY_ERRORS: Record<
  ApiErrorType | string,
  Record<Locale, { title: string; message: string; suggestion: string }>
> = {
  unknown: {
    en: {
      title: "Unknown Error",
      message: "An unknown error occurred",
      suggestion: "Please check the configuration or retry later",
    },
    zh: { title: "未知错误", message: "发生未知错误", suggestion: "请检查配置或稍后重试" },
  },
  "auth-401": {
    en: {
      title: "Invalid API Key",
      message: "The provided API key failed authentication",
      suggestion: "Check the apiKey in ~/.crab/config.json",
    },
    zh: {
      title: "API Key 无效",
      message: "提供的 API Key 无法通过验证",
      suggestion: "请检查 ~/.crab/config.json 中的 apiKey 配置是否正确",
    },
  },
  "auth-403": {
    en: {
      title: "Access Denied",
      message: "No permission to access this resource",
      suggestion: "Check the API key has sufficient permissions",
    },
    zh: {
      title: "访问被拒绝",
      message: "没有权限访问该资源",
      suggestion: "请检查 API Key 是否有足够的权限，或联系管理员",
    },
  },
  "auth-quota": {
    en: {
      title: "Quota Exceeded",
      message: "API account quota is exhausted",
      suggestion: "Top up at the provider's official site",
    },
    zh: { title: "账户余额不足", message: "API 账户配额已用完", suggestion: "请前往提供商官网充值或升级账户" },
  },
  "model-404": {
    en: {
      title: "Model Not Found",
      message: "The requested model ID is not available",
      suggestion: "Verify the model ID or press M to list available models",
    },
    zh: {
      title: "模型不存在",
      message: "请求的模型 ID 不存在或不可用",
      suggestion: "请检查模型 ID 是否正确，或使用 M 键查看可用模型列表",
    },
  },
  "rate_limit-429": {
    en: {
      title: "Rate Limited",
      message: "API rate limit reached",
      suggestion: "Wait a moment and retry, or upgrade your plan",
    },
    zh: { title: "请求过于频繁", message: "已达到 API 速率限制", suggestion: "请稍等片刻后重试，或考虑升级账户配额" },
  },
  "network-5xx": {
    en: {
      title: "Service Error",
      message: "AI provider temporarily unavailable",
      suggestion: "Service temporarily unavailable, please retry",
    },
    zh: { title: "服务错误", message: "AI 服务提供商暂时不可用", suggestion: "服务暂时不可用，请稍后重试" },
  },
  network: {
    en: {
      title: "Network Failure",
      message: "Cannot connect to the AI provider",
      suggestion: "Check network connection or baseURL configuration",
    },
    zh: {
      title: "网络连接失败",
      message: "无法连接到 AI 服务提供商",
      suggestion: "请检查网络连接，或检查 baseURL 配置是否正确",
    },
  },
  timeout: {
    en: {
      title: "Request Timeout",
      message: "AI response took too long",
      suggestion: "Network may be unstable or service busy, please retry",
    },
    zh: { title: "请求超时", message: "AI 响应时间过长", suggestion: "可能是网络不稳定或服务繁忙，请稍后重试" },
  },
  content_filter: {
    en: {
      title: "Content Filtered",
      message: "AI content safety filter triggered",
      suggestion: "Adjust input to avoid sensitive topics",
    },
    zh: {
      title: "内容被过滤",
      message: "AI 内容安全过滤已触发",
      suggestion: "请调整输入内容，避免生成涉及敏感话题的回复",
    },
  },
  default: {
    en: { title: "Request Failed", message: "Request failed", suggestion: "Check the configuration or retry later" },
    zh: { title: "请求失败", message: "请求失败", suggestion: "请检查配置或稍后重试，如问题持续请查看日志" },
  },
};

function pickLocale(locale: Locale, key: string, fallbackMessage: string) {
  const entry = FRIENDLY_ERRORS[key]?.[locale] ?? FRIENDLY_ERRORS.default![locale];
  return {
    ...entry,
    // 使用调用方提供的原始 message（如果非默认）覆盖翻译
    message: entry.message === "Request failed" || entry.message === "请求失败" ? fallbackMessage : entry.message,
  };
}

function getFriendlyEntry(key: string, locale: Locale) {
  return FRIENDLY_ERRORS[key]?.[locale] ?? FRIENDLY_ERRORS.default![locale];
}

/**
 * 关键词 → 错误类型的映射表。
 * getFriendlyError、isRecoverableError 和 classifyError 共用此配置。
 * 新增匹配规则只需在此处添加一行。
 *
 * recoverable 字段控制 isRecoverableError 的判定：
 *   - true  → 该类错误可尝试降级重试（网络/超时/模型错误）
 *   - false → 该类错误不可恢复（认证/权限/配额）
 */
interface KeywordRule {
  keywords: readonly string[];
  type: ApiErrorType;
  friendlyKey: string;
  recoverable: boolean;
}

const KEYWORD_RULES: readonly KeywordRule[] = [
  {
    keywords: ["econnrefused", "enotfound", "fetch failed", "network"],
    type: "network",
    friendlyKey: "network",
    recoverable: true,
  },
  { keywords: ["timeout", "流式超时"], type: "timeout", friendlyKey: "timeout", recoverable: true },
  {
    keywords: ["unauthorized", "invalid api key", "authentication"],
    type: "auth",
    friendlyKey: "auth-401",
    recoverable: false,
  },
  { keywords: ["insufficient", "quota", "billing"], type: "auth", friendlyKey: "auth-quota", recoverable: false },
  {
    keywords: ["content filter", "safety", "harmful"],
    type: "model",
    friendlyKey: "content_filter",
    recoverable: true,
  },
  // 可恢复的通用关键词（无特定友好消息映射，归类为 default）
  {
    keywords: ["not found", "invalid request", "unsupported", "empty response", "空响应"],
    type: "unknown",
    friendlyKey: "default",
    recoverable: true,
  },
  // 不可恢复的通用关键词
  { keywords: ["forbidden"], type: "auth", friendlyKey: "auth-403", recoverable: false },
] as const;

/** 可恢复错误关键词 — 从 KEYWORD_RULES 单源派生，禁止手动维护 */
export const RECOVERABLE_KEYWORDS: readonly string[] = KEYWORD_RULES.filter((r) => r.recoverable).flatMap((r) => [
  ...r.keywords,
]);

/** 不可恢复错误关键词 — 从 KEYWORD_RULES 单源派生，禁止手动维护 */
export const NON_RECOVERABLE_KEYWORDS: readonly string[] = KEYWORD_RULES.filter((r) => !r.recoverable).flatMap((r) => [
  ...r.keywords,
]);

/** 友好错误信息 */
export interface FriendlyError {
  type: ApiErrorType;
  title: string;
  message: string;
  suggestion: string;
}

export interface ApiErrorContext {
  providerId?: string;
  modelId?: string;
  requestMethod?: string;
  requestId?: string;
  sessionId?: string;
  turnId?: string;
  [key: string]: unknown;
}

/**
 * 安全提取 Error 对象中的额外细节。
 * AI SDK 错误可能携带 errorBody、data、cause 等非标准属性，
 * 使用类型窄化而非 as any 访问。
 */
export function extractErrorDetail(err: Error): string | null {
  const causeMsg = err.cause instanceof Error ? err.cause.message : null;
  if (causeMsg) {
    return causeMsg;
  }
  const anyErr = err as unknown as Record<string, unknown>;
  if ("errorBody" in err && anyErr.errorBody != null) {
    return typeof anyErr.errorBody === "string" ? anyErr.errorBody : JSON.stringify(anyErr.errorBody);
  }
  if ("data" in err && anyErr.data != null) {
    return typeof anyErr.data === "string" ? anyErr.data : JSON.stringify(anyErr.data);
  }
  return null;
}

/**
 * 从错误对象中提取 HTTP status code。
 * 优先读取标准属性(status/statusCode/responseStatus)，
 * 其次从消息文本中解析 "HTTP 404" 或独立三位数字。
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const anyErr = error as unknown as Record<string, unknown>;
  const status = anyErr.status ?? anyErr.statusCode ?? anyErr.responseStatus;
  if (typeof status === "number") {
    return status;
  }
  // 优先匹配 "HTTP 404"、"status: 500"、"statusCode: 403" 等带关键字前缀的模式
  // 回退到独立 3 位数字，排除明显非状态码的上下文（如年份数字 "2024"）
  const statusMatch =
    error.message.match(/\b(?:HTTP|status|statusCode|responseStatus|code)\s*[:=]?\s*(\d{3})\b/i) ??
    error.message.match(/(?:^|[^0-9])(\d{3})(?:[^0-9]|$)/);
  if (statusMatch?.[1]) {
    const code = Number(statusMatch[1]);
    if (code >= 100 && code < 600) {
      return code;
    }
  }
  return undefined;
}

/**
 * 判断错误是否值得尝试降级。
 * 优先依据 HTTP status code：401/403 不可恢复，其余 4xx/5xx 可恢复。
 * 无法提取 status code 时回退到字符串匹配。
 */
export function isRecoverableError(error: unknown): boolean {
  const status = extractHttpStatus(error);
  if (status) {
    if (status === 401 || status === 403) {
      return false;
    }
    return true;
  }

  if (!(error instanceof Error)) {
    return true;
  }

  const msg = error.message.toLowerCase();

  if (NON_RECOVERABLE_KEYWORDS.some((kw) => msg.includes(kw))) {
    return false;
  }

  return RECOVERABLE_KEYWORDS.some((kw) => msg.includes(kw));
}

/**
 * 将 API 错误转换为用户友好的错误信息。
 * 优先依据 HTTP status code 分类，无法分类时回退到字符串匹配。
 */
export function getFriendlyError(error: unknown, locale: Locale = "zh"): FriendlyError {
  if (!(error instanceof Error)) {
    const entry = getFriendlyEntry("unknown", locale);
    return {
      message: String(error),
      suggestion: entry.suggestion,
      title: entry.title,
      type: "unknown",
    };
  }

  const fallbackMessage = error.message;
  const status = extractHttpStatus(error);
  if (status) {
    const key = `${status === 401 ? "auth-401" : status === 403 ? "auth-403" : status === 404 ? "model-404" : status === 429 ? "rate_limit-429" : status >= 500 && status < 600 ? "network-5xx" : "default"}`;
    const entry = pickLocale(locale, key, fallbackMessage);
    return {
      type:
        status === 404
          ? "model"
          : status === 429
            ? "rate_limit"
            : status >= 500 && status < 600
              ? "network"
              : status === 401 || status === 403
                ? "auth"
                : "unknown",
      ...entry,
    };
  }

  const msg = error.message.toLowerCase();

  // 复用 KEYWORD_RULES 统一匹配，避免维护两套关键词
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => msg.includes(kw))) {
      return { type: rule.type, ...getFriendlyEntry(rule.friendlyKey, locale) };
    }
  }

  return { type: "unknown", ...pickLocale(locale, "default", fallbackMessage) };
}

/**
 * 将 LLM/API 错误转换为统一 AppError。
 *
 * 该函数不替代 getFriendlyError 的用户文案合同，而是为日志、事件和
 * 上层错误处理提供稳定 code/domain/severity/context。
 */
export function toApiAppError(error: unknown, context: ApiErrorContext = {}): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const friendly = getFriendlyError(error);
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;
  const appContext = {
    ...context,
    apiErrorType: friendly.type,
    friendlyTitle: friendly.title,
  };

  if (friendly.type === "network") {
    return createNetworkError("CONNECTION_FAILED", message, { cause, context: appContext });
  }
  if (friendly.type === "timeout") {
    return createNetworkError("REQUEST_TIMEOUT", message, { cause, context: appContext });
  }
  if (friendly.type === "rate_limit") {
    return createUserError("QUOTA_EXCEEDED", message, { cause, context: appContext });
  }
  if (friendly.type === "model") {
    return createUserError("RESOURCE_NOT_FOUND", message, { cause, context: appContext });
  }
  if (friendly.type === "auth") {
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes("insufficient") || lowerMsg.includes("quota") || lowerMsg.includes("billing")) {
      return createUserError("QUOTA_EXCEEDED", message, { cause, context: appContext });
    }
    const status = extractHttpStatus(error);
    if (status === 403) {
      return createSecurityError("AUTHZ_FAILED", message, { cause, context: appContext });
    }
    return createSecurityError("AUTH_FAILED", message, { cause, context: appContext });
  }

  return createInternalError("UNKNOWN_ERROR", message, { cause, context: appContext });
}

/**
 * 统一错误分类结果。
 * 整合 HTTP 状态码、错误类型、可恢复性、友好消息和 AppError 映射。
 */
export interface ErrorClassification {
  /** 原始错误 */
  originalError: unknown;
  /** 错误类型 */
  type: ApiErrorType;
  /** HTTP 状态码（如有） */
  httpStatus?: number;
  /** 错误详情（从 errorBody/data/cause 提取） */
  detail: string | null;
  /** 是否可恢复（可尝试降级重试） */
  recoverable: boolean;
  /** 友好错误信息 */
  friendly: FriendlyError;
  /** 对应的 AppError（用于日志和上层处理） */
  appError: AppError;
}

/**
 * 统一错误分类入口。
 * 一次性完成：状态码提取、类型判断、可恢复性分析、友好消息生成、AppError 转换。
 * 替代分散调用 extractHttpStatus / extractErrorDetail / isRecoverableError / getFriendlyError 的模式。
 */
export function classifyError(error: unknown, context: ApiErrorContext = {}): ErrorClassification {
  const httpStatus = extractHttpStatus(error);
  const detail = error instanceof Error ? extractErrorDetail(error) : null;
  const recoverable = isRecoverableError(error);
  const friendly = getFriendlyError(error);
  const appError = toApiAppError(error, context);

  const type = friendly.type;

  return {
    originalError: error,
    type,
    httpStatus,
    detail,
    recoverable,
    friendly,
    appError,
  };
}

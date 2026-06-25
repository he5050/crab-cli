/**
 * Auth Guard — 统一的服务端鉴权守卫。
 *
 * 职责:
 *   - 封装 CRAB_API_TOKEN 鉴权逻辑，消除 sseServer / acpServer / apiRoutes 三处重复
 *   - 提供时序安全的 Token 比较
 *   - 支持 exempt HTTP methods（默认 GET / OPTIONS 豁免）
 *   - 支持 allowLocalWithoutToken 开发逃逸口
 *
 * 使用场景:
 *   - SSE 服务器请求鉴权
 *   - ACP 服务器请求鉴权
 *   - REST API 请求鉴权
 *
 * 边界:
 *   1. 仅做鉴权判定，不参与业务处理
 *   2. 鉴权依赖 CRAB_API_TOKEN 环境变量
 *   3. 失败响应统一为 401 + JSON 错误
 *   4. allowLocalWithoutToken 仅限开发/测试环境
 *
 * 流程:
 *   1. 检查请求方法是否在豁免列表
 *   2. 读取 CRAB_API_TOKEN 环境变量
 *   3. 无 Token 且不允许本地免鉴权 → 拒绝
 *   4. 提取请求 Authorization 头（Bearer 前缀 stripping）
 *   5. 时序安全比较
 *   6. 返回鉴权结果
 */

import { createSecurityError } from "@/core/errors/appError";
import { timingSafeEqual } from "node:crypto";

/** 默认豁免的 HTTP 方法（只读操作无需鉴权） */
export const DEFAULT_EXEMPT_METHODS = new Set(["GET", "OPTIONS", "HEAD"]);

export interface AuthGuardOptions {
  /** 是否允许本地请求（无 Token）通过鉴权 */
  allowLocalWithoutToken?: boolean;
  /** 豁免的 HTTP 方法集合 */
  exemptMethods?: Set<string>;
  /** Token 来源：默认读取 CRAB_API_TOKEN 环境变量，也可传入固定值 */
  token?: string;
}

/** 判断 host 是否为本地绑定地址（127.0.0.1 / localhost / ::1） */
export function isLocalBindHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

/**
 * 从 Request 中提取 Bearer Token（ stripping "Bearer " 前缀）。
 */
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

/**
 * 时序安全的 Token 比较。
 */
export function safeTokenEquals(candidate: string | null | undefined, expected: string): boolean {
  if (typeof candidate !== "string" || expected.length === 0) {
    return false;
  }
  const candidateBuffer = Buffer.from(candidate, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (candidateBuffer.length !== expectedBuffer.length) {
    const maxLength = Math.max(candidateBuffer.length, expectedBuffer.length);
    const paddedCandidate = Buffer.alloc(maxLength);
    const paddedExpected = Buffer.alloc(maxLength);
    candidateBuffer.copy(paddedCandidate);
    expectedBuffer.copy(paddedExpected);
    timingSafeEqual(paddedCandidate, paddedExpected);
    return false;
  }
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

/**
 * 创建鉴权守卫实例。
 */
export function createAuthGuard(options: AuthGuardOptions = {}) {
  const { allowLocalWithoutToken = false, exemptMethods = DEFAULT_EXEMPT_METHODS, token: explicitToken } = options;

  function getToken(): string | undefined {
    return explicitToken ?? process.env.CRAB_API_TOKEN;
  }

  function isExempt(method: string): boolean {
    return exemptMethods.has(method.toUpperCase());
  }

  /**
   * 判断请求是否通过鉴权。
   */
  function isAuthorized(req: Request): boolean {
    if (isExempt(req.method)) {
      return true;
    }
    const expectedToken = getToken();
    if (!expectedToken) {
      return allowLocalWithoutToken;
    }
    const provided = extractBearerToken(req);
    return safeTokenEquals(provided, expectedToken);
  }

  /**
   * 如果未通过鉴权，返回 401 Response；否则返回 null（表示放行）。
   * 调用方可以直接 `return requireAuth(req) ?? handler()`。
   */
  function requireAuth(req: Request): Response | null {
    if (isAuthorized(req)) {
      return null;
    }
    return authResponse();
  }

  /**
   * 要求鉴权，但允许从 URL query parameter 获取 token（SignalR 兼容）。
   */
  function isAuthorizedWithQueryToken(req: Request): boolean {
    if (isAuthorized(req)) {
      return true;
    }
    const expectedToken = getToken();
    if (!expectedToken) {
      return allowLocalWithoutToken;
    }
    const url = new URL(req.url);
    const queryToken = url.searchParams.get("access_token");
    return safeTokenEquals(queryToken, expectedToken);
  }

  return {
    isAuthorized,
    isAuthorizedWithQueryToken,
    requireAuth,
    getToken,
  };
}

/** 401 鉴权失败响应（统一格式） */
export function authResponse(): Response {
  return Response.json({ error: "未授权" }, { status: 401 });
}

/**
 * 对非 localhost 绑定的服务器，强制要求设置 CRAB_API_TOKEN。
 */
export function requireAuthForHost(host: string, allowLocalWithoutToken: boolean): void {
  if (!isLocalBindHost(host) && !allowLocalWithoutToken && !process.env.CRAB_API_TOKEN) {
    throw createSecurityError("AUTH_FAILED", "绑定服务器到非 localhost 地址时必须设置 CRAB_API_TOKEN");
  }
}

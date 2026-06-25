/**
 * SSE 安全模块 — 集中管理 SSE/WebSocket 来源校验、Token 鉴权与跨域策略。
 *
 * 职责:
 *   - 维护允许的来源白名单
 *   - 提供基于 CRAB_API_TOKEN 的鉴权判定
 *   - 提供 SignalR 兼容协议的鉴权逻辑
 *   - 通过 timingSafeEqual 防止时序攻击
 *
 * 模块功能:
 *   - SSE_ALLOWED_ORIGINS: 允许的 Origin 白名单常量
 *   - requireAuthForHost(): 对非本地绑定强制要求鉴权
 *   - isAuthorized(): 判定请求是否通过鉴权
 *   - isSignalRAuthorized(): SignalR 协议下的鉴权判定
 *   - safeTokenEquals(): 时序安全的 Token 比较
 *   - isSseOriginAllowed(): 判定 Origin 是否在白名单
 *   - sseCorsHeadersFor(): 生成 CORS 响应头
 *   - authResponse(): 401 鉴权失败响应
 *   - getSignalRSessionScope(): 解析 SignalR 会话范围
 *
 * 使用场景:
 *   - SSE 服务器对客户端连接的合法性校验
 *   - 协作 WebSocket 升级时的鉴权与 CORS 处理
 *   - 跨进程远程接入时的安全门控
 *
 * 边界:
 *   1. 仅做安全策略判定，不参与业务处理
 *   2. 鉴权依赖 CRAB_API_TOKEN 环境变量
 *   3. 失败响应统一为 401 + JSON 错误
 *   4. 跨域头只在允许的 Origin 下注入
 *
 * 流程:
 *   1. 解析请求的 Authorization 头或 access_token 参数
 *   2. 与 CRAB_API_TOKEN 进行常量时间比较
 *   3. 通过则放行，未通过返回 401
 *   4. CORS 处理根据 Origin 白名单注入响应头
 */

import { createLogger } from "@/core/logging/logger";
import { getServerErrorMessage } from "@/server/errors";
import { safeTokenEquals, requireAuthForHost, authResponse, extractBearerToken } from "@/server/authGuard";

// 从 authGuard 重导出，保持向后兼容
export { safeTokenEquals, requireAuthForHost, authResponse } from "@/server/authGuard";

const log = createLogger("sse-security");

export const SSE_ALLOWED_ORIGINS = new Set([
  // HTTP localhost variants (port-less for backward compatibility)
  "http://127.0.0.1",
  "http://localhost",
  "http://[::1]",
  // HTTPS localhost variants
  "https://127.0.0.1",
  "https://localhost",
  "https://[::1]",
  // Common development ports (http)
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  // Common development ports (https)
  "https://127.0.0.1:3000",
  "https://localhost:3000",
  "https://127.0.0.1:8443",
  "https://localhost:8443",
]);

export function isAuthorized(req: Request, allowLocalWithoutToken: boolean): boolean {
  const token = process.env.CRAB_API_TOKEN;
  if (!token) {
    return allowLocalWithoutToken;
  }
  return safeTokenEquals(extractBearerToken(req), token);
}

export function isSignalRAuthorized(req: Request, allowLocalWithoutToken: boolean): boolean {
  if (isAuthorized(req, allowLocalWithoutToken)) {
    return true;
  }
  const token = process.env.CRAB_API_TOKEN;
  if (!token) {
    return allowLocalWithoutToken;
  }
  const url = new URL(req.url);
  return safeTokenEquals(url.searchParams.get("access_token"), token);
}

export function getSignalRSessionScope(req: Request): string[] {
  const url = new URL(req.url);
  const explicit = url.searchParams.getAll("sessionId");
  const commaSeparated = (url.searchParams.get("sessions") ?? "")
    .split(",")
    .map((sessionId) => sessionId.trim())
    .filter(Boolean);
  return [...new Set([...explicit, ...commaSeparated].map((sessionId) => sessionId.trim()).filter(Boolean))];
}

export function isSseOriginAllowed(requestOrigin: string | null): boolean {
  if (!requestOrigin) {
    return false;
  }
  try {
    const parsed = new URL(requestOrigin);
    if (parsed.origin !== requestOrigin) {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return SSE_ALLOWED_ORIGINS.has(parsed.origin);
  } catch (error) {
    log.debug("SSE origin parse failed", {
      error: getServerErrorMessage(error),
      origin: requestOrigin,
    });
    return false;
  }
}

export function sseCorsHeadersFor(requestOrigin: string | null): Record<string, string> {
  if (requestOrigin && isSseOriginAllowed(requestOrigin)) {
    return { "Access-Control-Allow-Origin": requestOrigin, Vary: "Origin" };
  }
  return {};
}

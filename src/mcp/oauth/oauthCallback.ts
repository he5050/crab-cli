/**
 * MCP OAuth 回调服务器
 *
 * 职责:
 *   - 启动本地 HTTP 服务器接收 OAuth 授权回调
 *   - 解析回调 URL 中的授权码和状态参数
 *   - 管理待处理的授权请求状态
 *   - 处理授权成功、失败和超时场景
 *
 * 模块功能:
 *   - ensureOAuthCallbackServer:启动/复用回调服务器
 *   - waitForOAuthCallback:等待指定 state 的回调
 *   - cancelPendingOAuthCallback:取消指定 MCP 的授权请求
 *   - stopOAuthCallbackServer:停止回调服务器
 *   - parseOAuthRedirectUri:解析重定向 URI 配置
 *
 * 使用场景:
 *   - MCP OAuth 流程中作为 redirect_uri
 *   - 浏览器授权后跳转回本地服务器
 *   - 多 MCP 服务器并发授权管理
 *
 * 边界:
 *   1. 默认监听 127.0.0.1:19876
 *   2. 授权等待超时时间为 5 分钟
 *   3. 仅处理配置的路径，其他返回 404
 *   4. 不支持 HTTPS，仅本地 HTTP
 */

import { createLogger } from "@/core/logging/logger";
import { getMcpErrorMessage } from "../core/errors";
const log = createLogger("mcp:oauth-cb");

import path from "node:path";

export const DEFAULT_OAUTH_CALLBACK_PORT = 19_876;
export const DEFAULT_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";

interface PendingAuth {
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let server: ReturnType<typeof Bun.serve> | null = null;
let currentPort = DEFAULT_OAUTH_CALLBACK_PORT;
let currentPath = DEFAULT_OAUTH_CALLBACK_PATH;
const pendingAuths = new Map<string, PendingAuth>();
const mcpNameToState = new Map<string, string>();

export function parseOAuthRedirectUri(redirectUri?: string): { port: number; path: string; redirectUri: string } {
  if (!redirectUri) {
    return {
      path: DEFAULT_OAUTH_CALLBACK_PATH,
      port: DEFAULT_OAUTH_CALLBACK_PORT,
      redirectUri: `http://127.0.0.1:${DEFAULT_OAUTH_CALLBACK_PORT}${DEFAULT_OAUTH_CALLBACK_PATH}`,
    };
  }

  try {
    const url = new URL(redirectUri);
    return {
      path: url.pathname || DEFAULT_OAUTH_CALLBACK_PATH,
      port: url.port ? Number(url.port) : DEFAULT_OAUTH_CALLBACK_PORT,
      redirectUri: url.toString(),
    };
  } catch (error) {
    log.debug(`解析 redirectUri 失败: ${getMcpErrorMessage(error)}，使用默认值`);
    return {
      path: DEFAULT_OAUTH_CALLBACK_PATH,
      port: DEFAULT_OAUTH_CALLBACK_PORT,
      redirectUri: `http://127.0.0.1:${DEFAULT_OAUTH_CALLBACK_PORT}${DEFAULT_OAUTH_CALLBACK_PATH}`,
    };
  }
}

export async function ensureOAuthCallbackServer(
  redirectUri?: string,
): Promise<{ port: number; path: string; redirectUri: string }> {
  const parsed = parseOAuthRedirectUri(redirectUri);

  if (server && (parsed.port !== currentPort || parsed.path !== currentPath)) {
    await stopOAuthCallbackServer();
  }

  if (!server) {
    log.info(`启动 OAuth 回调服务: 127.0.0.1:${parsed.port}${parsed.path}`);
    currentPort = parsed.port;
    currentPath = parsed.path;
    server = Bun.serve({
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== currentPath) {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        if (!state) {
          return new Response("Missing state", { status: 400 });
        }

        const pending = pendingAuths.get(state);
        if (!pending) {
          return new Response("Invalid state", { status: 400 });
        }

        clearTimeout(pending.timeout);
        pendingAuths.delete(state);
        for (const [name, value] of mcpNameToState.entries()) {
          if (value === state) {
            mcpNameToState.delete(name);
          }
        }

        if (error) {
          queueMicrotask(() => pending.reject(new Error(errorDescription || error)));
          return new Response("Authorization failed", { status: 200 });
        }

        if (!code) {
          queueMicrotask(() => pending.reject(new Error("No authorization code provided")));
          return new Response("Missing code", { status: 400 });
        }

        pending.resolve(code);
        return new Response("Authorization successful", { status: 200 });
      },
      hostname: "127.0.0.1",
      port: currentPort,
    });
  }

  return parsed;
}

export function waitForOAuthCallback(state: string, mcpName?: string): Promise<string> {
  if (mcpName) {
    mcpNameToState.set(mcpName, state);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingAuths.has(state)) {
          pendingAuths.delete(state);
          if (mcpName) {
            mcpNameToState.delete(mcpName);
          }
          reject(new Error("OAuth callback timeout"));
        }
      },
      5 * 60 * 1000,
    );

    pendingAuths.set(state, { reject, resolve, timeout });
  });
}

export function cancelPendingOAuthCallback(mcpName: string): void {
  const state = mcpNameToState.get(mcpName);
  if (!state) {
    return;
  }
  const pending = pendingAuths.get(state);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timeout);
  pendingAuths.delete(state);
  mcpNameToState.delete(mcpName);
  queueMicrotask(() => pending.reject(new Error("Authorization cancelled")));
}

export async function stopOAuthCallbackServer(): Promise<void> {
  log.info("停止 OAuth 回调服务");
  if (server) {
    server.stop(true);
    server = null;
  }

  for (const [state, pending] of pendingAuths.entries()) {
    clearTimeout(pending.timeout);
    queueMicrotask(() => pending.reject(new Error("OAuth callback server stopped")));
    pendingAuths.delete(state);
  }
  mcpNameToState.clear();
}

export function isOAuthCallbackServerRunning(): boolean {
  return server !== null;
}

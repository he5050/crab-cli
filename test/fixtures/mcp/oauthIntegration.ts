/**
 * OAuth 远端 MCP 联调 — 测试 fixture 和集成验证。
 *
 * 职责:
 *   - 提供模拟的 OAuth MCP 远端服务
 *   - 验证 authorizationUrl → callback → token exchange 完整流程
 *   - 记录真实服务约束和异常场景
 *
 * 模块功能:
 *   - startMockOAuthServer:启动模拟 OAuth 服务器，用于本地测试 OAuth 流程
 *   - validateAuthUrl:验证 OAuth 流程的 authorizationUrl 参数
 *
 * 使用场景:
 *   - 本地开发测试 OAuth 流程
 *   - 验证 MCP OAuth 集成正确性
 *   - 模拟 OAuth 服务端点进行单元测试
 *
 * 边界:
 *   1. 仅用于测试环境，不应用于生产
 *   2. 模拟服务器监听 127.0.0.1 本地地址
 *   3. 支持 OIDC Discovery 和 OpenID Discovery
 *   4. 默认端口 19999
 *
 * 流程:
 *   1. 启动模拟 OAuth 服务器
 *   2. 配置 MCP 使用模拟服务器 URL
 *   3. 执行 OAuth 授权流程
 *   4. 验证 authorizationUrl 参数
 *   5. 完成 token 交换
 *
 * 验证标准:
 *   - startMcpRuntimeAuth 返回非空 authorizationUrl
 *   - authorizationUrl 包含 code_challenge 参数(PKCE)
 *   - MCP 管理页 OAuth 入口展示可点击的 URL
 *   - finishMcpRuntimeAuthCode 通过 McpOAuthProvider 持久化 token
 *   - 支持 mcp.json 中 oauth.authorizationUrl 配置覆盖
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("mcp:oauth-integration");

// ─── 模拟 OAuth 服务器 ─────────────────────────────────────

/**
 * 启动模拟 OAuth 服务器，用于本地测试 OAuth 流程。
 * 模拟 OAuth authorization server 的核心端点。
 */
export async function startMockOAuthServer(port = 19_999): Promise<{
  url: string;
  stop: () => void;
  authorizationCode: string;
}> {
  const authCode = `mock_code_${Date.now()}`;
  const tokens: Record<string, string> = {};

  const server = Bun.serve({
    fetch(req) {
      const url = new URL(req.url);

      // OIDC Discovery
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return Response.json({
          authorization_endpoint: `http://127.0.0.1:${port}/oauth/authorize`,
          code_challenge_methods_supported: ["S256"],
          issuer: `http://127.0.0.1:${port}`,
          response_types_supported: ["code"],
          token_endpoint: `http://127.0.0.1:${port}/oauth/token`,
        });
      }

      // OpenID Discovery
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          authorization_endpoint: `http://127.0.0.1:${port}/oauth/authorize`,
          issuer: `http://127.0.0.1:${port}`,
          token_endpoint: `http://127.0.0.1:${port}/oauth/token`,
        });
      }

      // Authorization Endpoint(重定向到 callback)
      if (url.pathname === "/oauth/authorize") {
        const redirectUri = url.searchParams.get("redirect_uri");
        const state = url.searchParams.get("state");
        if (redirectUri && state) {
          const callbackUrl = `${redirectUri}?code=${authCode}&state=${state}`;
          return Response.redirect(callbackUrl, 302);
        }
        return new Response("缺少 redirect_uri 或 state", { status: 400 });
      }

      // Token Endpoint
      if (url.pathname === "/oauth/token" && req.method === "POST") {
        return Response.json({
          access_token: `mock_access_${Date.now()}`,
          expires_in: 3600,
          refresh_token: `mock_refresh_${Date.now()}`,
          scope: "read write",
          token_type: "Bearer",
        });
      }

      return new Response("未找到", { status: 404 });
    },
    hostname: "127.0.0.1",
    port,
  });

  log.info(`模拟 OAuth 服务器已启动: http://127.0.0.1:${port}`);

  return {
    get authorizationCode() {
      return authCode;
    },
    stop: () => {
      server.stop(true);
      log.info("模拟 OAuth 服务器已停止");
    },
    url: `http://127.0.0.1:${port}`,
  };
}

// ─── 验证函数 ──────────────────────────────────────────────

export interface OAuthFlowValidation {
  authorizationUrlNotEmpty: boolean;
  hasCodeChallenge: boolean;
  hasState: boolean;
  hasRedirectUri: boolean;
  pkceMethod: string | null;
}

/**
 * 验证 OAuth 流程的 authorizationUrl 参数。
 */
export function validateAuthUrl(authorizationUrl: string): OAuthFlowValidation {
  const url = new URL(authorizationUrl);
  const params = url.searchParams;

  return {
    authorizationUrlNotEmpty: authorizationUrl.length > 0,
    hasCodeChallenge: params.has("code_challenge"),
    hasRedirectUri: params.has("redirect_uri"),
    hasState: params.has("state"),
    pkceMethod: params.get("code_challenge_method"),
  };
}

/**
 * OAuth PKCE 流程 — 授权码 + PKCE 认证流程实现。
 *
 * 职责:
 *   - 生成 code_verifier + code_challenge
 *   - 启动本地回调服务器（Bun.serve）
 *   - 打开浏览器授权
 *   - 交换 token
 *
 * 模块功能:
 *   - generatePkcePair: 生成 PKCE code_verifier 和 code_challenge
 *   - generateState: 生成随机 state 参数
 *   - startOAuthFlow: 启动完整 OAuth PKCE 流程
 *   - buildAuthorizeUrl: 构建授权 URL
 *   - exchangeCodeForToken: 用授权码交换 token
 *
 * 使用场景:
 *   - GitHub Copilot OAuth 登录
 *   - Azure AD OAuth 登录
 *   - 其他需要 PKCE 流程的 Provider
 *
 * 边界:
 *   1. 本地回调服务器默认监听 127.0.0.1:19877
 *   2. 授权等待超时 5 分钟
 *   3. 仅支持 authorization_code grant type
 *   4. 浏览器打开使用系统默认浏览器
 */
import crypto from "node:crypto";
import { createLogger } from "@/core/logging/logger";
import type { ProviderOAuthConfig, ProviderOAuthToken } from "./oauthStore";

const log = createLogger("auth:oauth-flow");

/** 默认回调端口 */
const DEFAULT_CALLBACK_PORT = 19_877;
/** 默认回调路径 */
const DEFAULT_CALLBACK_PATH = "/auth/callback";
/** 授权等待超时（5 分钟） */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** PKCE 键值对 */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

/** 生成随机字符串 */
function generateRandomString(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 生成 PKCE code_verifier 和 code_challenge。
 *
 * code_verifier: 43-128 字符的随机字符串
 * code_challenge: BASE64URL(SHA256(code_verifier))
 */
export function generatePkcePair(): PkcePair {
  const codeVerifier = generateRandomString(64);
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  // Base64URL 编码
  const codeChallenge = hash.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return {
    codeChallenge,
    codeChallengeMethod: "S256",
    codeVerifier,
  };
}

/** 生成随机 state 参数 */
export function generateState(): string {
  return generateRandomString(32);
}

/**
 * 构建授权 URL。
 *
 * @param config - OAuth 配置
 * @param pkce - PKCE 键值对
 * @param state - 随机 state
 * @param redirectUri - 回调 URI
 * @returns 授权 URL
 */
export function buildAuthorizeUrl(
  config: ProviderOAuthConfig,
  pkce: PkcePair,
  state: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  if (config.scopes.length > 0) {
    params.set("scope", config.scopes.join(" "));
  }

  return `${config.authorizeUrl}?${params.toString()}`;
}

/**
 * 用授权码交换 token。
 *
 * @param config - OAuth 配置
 * @param code - 授权码
 * @param codeVerifier - PKCE code_verifier
 * @param redirectUri - 回调 URI
 * @returns OAuth token
 */
export async function exchangeCodeForToken(
  config: ProviderOAuthConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<ProviderOAuthToken> {
  log.info("交换授权码获取 token");

  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }

  const response = await fetch(config.tokenUrl, {
    body,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`交换 token 失败 (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error) {
    throw new Error(`Token 错误: ${data.error} — ${data.error_description ?? ""}`);
  }

  if (!data.access_token) {
    throw new Error("Token 响应中缺少 access_token");
  }

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    refreshToken: data.refresh_token,
    scope: data.scope,
    tokenType: data.token_type ?? "Bearer",
  };
}

/**
 * 打开系统默认浏览器。
 */
async function openBrowser(url: string): Promise<void> {
  try {
    const process = await import("node:process");
    const platform = process.platform;
    let cmd: string;

    if (platform === "darwin") {
      cmd = `open "${url}"`;
    } else if (platform === "win32") {
      cmd = `start "" "${url}"`;
    } else {
      cmd = `xdg-open "${url}"`;
    }

    const { exec } = await import("node:child_process");
    exec(cmd, (error) => {
      if (error) {
        log.warn(`无法自动打开浏览器: ${error.message}。请手动访问: ${url}`);
      }
    });
  } catch {
    log.warn(`打开浏览器失败，请手动访问: ${url}`);
  }
}

/**
 * 启动完整 OAuth PKCE 流程。
 *
 * 流程:
 *   1. 生成 PKCE pair 和 state
 *   2. 启动本地回调服务器
 *   3. 打开浏览器授权
 *   4. 等待回调获取授权码
 *   5. 交换 token
 *   6. 关闭回调服务器
 *
 * @param config - OAuth 配置
 * @returns OAuth token
 */
export async function startOAuthFlow(config: ProviderOAuthConfig): Promise<ProviderOAuthToken> {
  const pkce = generatePkcePair();
  const state = generateState();
  const port = DEFAULT_CALLBACK_PORT;
  const callbackPath = DEFAULT_CALLBACK_PATH;
  const redirectUri = config.redirectUri ?? `http://127.0.0.1:${port}${callbackPath}`;

  log.info(`启动 OAuth PKCE 流程，回调地址: ${redirectUri}`);

  // 启动本地回调服务器
  let resolveCode: (code: string) => void;
  let rejectCode: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = Bun.serve({
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname !== callbackPath) {
        return new Response("Not found", { status: 404 });
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      if (error) {
        queueMicrotask(() => rejectCode(new Error(errorDescription || error)));
        return new Response(
          `<html><body><h2>授权失败</h2><p>${errorDescription || error}</p><p>可以关闭此窗口。</p></body></html>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }

      if (returnedState !== state) {
        queueMicrotask(() => rejectCode(new Error("State 不匹配，可能存在 CSRF 攻击")));
        return new Response("State mismatch", { status: 400 });
      }

      if (!code) {
        queueMicrotask(() => rejectCode(new Error("回调中缺少授权码")));
        return new Response("Missing code", { status: 400 });
      }

      resolveCode(code);
      return new Response(`<html><body><h2>授权成功</h2><p>可以关闭此窗口返回终端。</p></body></html>`, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
    hostname: "127.0.0.1",
    port,
  });

  // 构建授权 URL 并打开浏览器
  const authorizeUrl = buildAuthorizeUrl(config, pkce, state, redirectUri);
  log.info(`授权 URL: ${authorizeUrl}`);
  console.log(`\n  请在浏览器中完成授权:\n  ${authorizeUrl}\n`);
  await openBrowser(authorizeUrl);

  // 等待回调
  const timeout = setTimeout(() => {
    rejectCode(new Error("OAuth 授权超时（5 分钟）"));
  }, AUTH_TIMEOUT_MS);

  try {
    const code = await codePromise;
    clearTimeout(timeout);

    // 交换 token
    const token = await exchangeCodeForToken(config, code, pkce.codeVerifier, redirectUri);
    log.info("OAuth PKCE 流程完成");
    return token;
  } finally {
    server.stop(true);
  }
}

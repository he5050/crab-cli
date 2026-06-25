/**
 * OAuth Token 持久化存储 — LLM Provider 的 OAuth 凭证管理。
 *
 * 职责:
 *   - 存储到 ~/.crab/auth/${providerId}.json
 *   - 包含 access_token / refresh_token / expires_at
 *   - 自动刷新过期 token
 *   - 提供凭证的增删查改接口
 *
 * 模块功能:
 *   - readProviderAuth: 读取 Provider 的 OAuth 凭证
 *   - writeProviderAuth: 写入 Provider 的 OAuth 凭证
 *   - removeProviderAuth: 删除 Provider 的 OAuth 凭证
 *   - getValidAccessToken: 获取有效的 access token（自动刷新）
 *   - refreshProviderToken: 刷新 token
 *
 * 使用场景:
 *   - OAuth 类型 Provider 的 token 持久化
 *   - GitHub Copilot / Azure AD 等 OAuth 流程
 *   - Token 过期自动刷新
 *
 * 边界:
 *   1. 存储位置:~/.crab/auth/${providerId}.json
 *   2. 文件权限 0600（仅属主可读写）
 *   3. Token 过期前 60 秒自动触发刷新
 */
import path from "node:path";
import { getAuthDir } from "@/config";
import { readJsonFile, writeJsonFile } from "@/core/utilities/fileUtils";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("auth:oauth-store");

/** Provider OAuth 凭证 */
export interface ProviderOAuthToken {
  /** Access token */
  accessToken: string;
  /** Refresh token */
  refreshToken?: string;
  /** 过期时间（Unix 毫秒时间戳） */
  expiresAt?: number;
  /** Token 类型，通常为 "Bearer" */
  tokenType?: string;
  /** 授权范围 */
  scope?: string;
}

/** Provider OAuth 配置 */
export interface ProviderOAuthConfig {
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri?: string;
}

/** 获取 Provider 认证文件路径 */
function getProviderAuthPath(providerId: string): string {
  return path.join(getAuthDir(), `${providerId}.json`);
}

/** 读取 Provider 的 OAuth 凭证 */
export async function readProviderAuth(providerId: string): Promise<ProviderOAuthToken | null> {
  const authPath = getProviderAuthPath(providerId);
  return (await readJsonFile<ProviderOAuthToken>(authPath)) ?? null;
}

/** 写入 Provider 的 OAuth 凭证 */
export async function writeProviderAuth(providerId: string, token: ProviderOAuthToken): Promise<boolean> {
  const authPath = getProviderAuthPath(providerId);
  log.debug(`保存 OAuth 凭证: ${providerId}`);
  return writeJsonFile(authPath, token);
}

/** 删除 Provider 的 OAuth 凭证 */
export async function removeProviderAuth(providerId: string): Promise<void> {
  const authPath = getProviderAuthPath(providerId);
  try {
    const fs = await import("node:fs/promises");
    await fs.unlink(authPath);
    log.info(`已删除 OAuth 凭证: ${providerId}`);
  } catch {
    // 文件不存在时忽略
  }
}

/**
 * 检查 token 是否已过期。
 *
 * @param token - OAuth 凭证
 * @param leewayMs - 提前量（毫秒），默认 60 秒
 * @returns 是否已过期
 */
export function isTokenExpired(token: ProviderOAuthToken, leewayMs = 60_000): boolean {
  if (!token.expiresAt) {
    return false;
  }
  return Date.now() + leewayMs >= token.expiresAt;
}

/**
 * 刷新 Provider 的 OAuth token。
 *
 * @param providerId - Provider ID
 * @param oauthConfig - OAuth 配置
 * @param currentToken - 当前 token（包含 refreshToken）
 * @returns 新的 token
 */
export async function refreshProviderToken(
  providerId: string,
  oauthConfig: ProviderOAuthConfig,
  currentToken: ProviderOAuthToken,
): Promise<ProviderOAuthToken> {
  if (!currentToken.refreshToken) {
    throw new Error(`Provider ${providerId} 没有 refresh_token，无法刷新`);
  }

  log.info(`刷新 OAuth token: ${providerId}`);

  const body = new URLSearchParams({
    client_id: oauthConfig.clientId,
    grant_type: "refresh_token",
    refresh_token: currentToken.refreshToken,
  });

  if (oauthConfig.clientSecret) {
    body.set("client_secret", oauthConfig.clientSecret);
  }

  const response = await fetch(oauthConfig.tokenUrl, {
    body,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`刷新 token 失败 (${response.status}): ${errorText}`);
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
    throw new Error(`刷新 token 错误: ${data.error} — ${data.error_description ?? ""}`);
  }

  if (!data.access_token) {
    throw new Error(`刷新 token 响应中缺少 access_token`);
  }

  const newToken: ProviderOAuthToken = {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    refreshToken: data.refresh_token ?? currentToken.refreshToken,
    scope: data.scope ?? currentToken.scope,
    tokenType: data.token_type ?? currentToken.tokenType,
  };

  await writeProviderAuth(providerId, newToken);
  log.info(`OAuth token 刷新成功: ${providerId}`);

  return newToken;
}

/**
 * 获取有效的 access token，自动刷新过期 token。
 *
 * @param providerId - Provider ID
 * @param oauthConfig - OAuth 配置（刷新时需要）
 * @returns 有效的 access token，或 null（未认证）
 */
export async function getValidAccessToken(
  providerId: string,
  oauthConfig?: ProviderOAuthConfig,
): Promise<string | null> {
  const token = await readProviderAuth(providerId);
  if (!token) {
    return null;
  }

  // 未过期，直接返回
  if (!isTokenExpired(token)) {
    return token.accessToken;
  }

  // 已过期，尝试刷新
  if (oauthConfig && token.refreshToken) {
    try {
      const newToken = await refreshProviderToken(providerId, oauthConfig, token);
      return newToken.accessToken;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`自动刷新 token 失败: ${providerId} — ${msg}`);
      return null;
    }
  }

  log.warn(`Token 已过期且无法刷新: ${providerId}`);
  return null;
}

/**
 * MCP OAuth 客户端提供者
 *
 * 职责:
 *   - 实现 MCP SDK 的 OAuthClientProvider 接口
 *   - 管理 OAuth 客户端元数据和凭证信息
 *   - 处理 OAuth Token 的存储和刷新
 *   - 支持 PKCE 授权流程(state、codeVerifier)
 *
 * 模块功能:
 *   - McpOAuthProvider 类:完整的 OAuth 客户端提供者实现
 *   - clientMetadata:提供客户端注册元数据
 *   - clientInformation:获取/保存客户端凭证
 *   - tokens:获取/保存访问令牌
 *   - redirectToAuthorization:处理授权重定向
 *   - invalidateCredentials:清除指定类型的凭证
 *
 * 使用场景:
 *   - MCP 客户端初始化时配置 OAuth 提供者
 *   - OAuth 认证流程中的凭证管理
 *   - Token 过期后的自动刷新
 *
 * 边界:
 *   1. 依赖 oauthStore 进行凭证持久化
 *   2. 支持 authorization_code 和 refresh_token 授权类型
 *   3. 客户端密钥可选，支持 public client 模式
 */

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { createLogger } from "@/core/logging/logger";
const log = createLogger("mcp:oauth");

import {
  clearOAuthClientInfo,
  clearOAuthSession,
  clearOAuthTokens,
  getOAuthEntry,
  updateOAuthClientInfo,
  updateOAuthSession,
  updateOAuthTokens,
} from "./oauthStore";
import { createInternalError } from "@/core/errors/appError";

export interface McpOAuthProviderConfig {
  mcpName: string;
  serverUrl: string;
  redirectUri: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  onRedirect?: (url: URL) => void | Promise<void>;
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(private readonly config: McpOAuthProviderConfig) {}

  private createRandomHex(bytes = 32): string {
    return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  get redirectUrl(): string {
    return this.config.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Crab CLI",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [this.redirectUrl],
      response_types: ["code"],
      scope: this.config.scope,
      token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    if (this.config.clientId) {
      return {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      };
    }

    const entry = await getOAuthEntry(this.config.mcpName);
    if (!entry?.clientInfo) {
      return undefined;
    }
    if (entry.serverUrl && entry.serverUrl !== this.config.serverUrl) {
      return undefined;
    }
    return {
      client_id: entry.clientInfo.clientId,
      client_secret: entry.clientInfo.clientSecret,
    };
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    log.debug(`保存客户端信息: ${this.config.mcpName}`);
    await updateOAuthClientInfo(
      this.config.mcpName,
      {
        clientId: info.client_id,
        clientIdIssuedAt: info.client_id_issued_at,
        clientSecret: info.client_secret,
        clientSecretExpiresAt: info.client_secret_expires_at,
      },
      this.config.serverUrl,
    );
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const entry = await getOAuthEntry(this.config.mcpName);
    if (!entry?.tokens) {
      return undefined;
    }
    if (entry.serverUrl && entry.serverUrl !== this.config.serverUrl) {
      return undefined;
    }
    return {
      access_token: entry.tokens.accessToken,
      expires_in: entry.tokens.expiresAt
        ? Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000))
        : undefined,
      refresh_token: entry.tokens.refreshToken,
      scope: entry.tokens.scope,
      token_type: "Bearer",
    };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    log.info(`保存 OAuth token: ${this.config.mcpName}`);
    await updateOAuthTokens(
      this.config.mcpName,
      {
        accessToken: tokens.access_token,
        expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope,
      },
      this.config.serverUrl,
    );
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    log.info(`OAuth 重定向: ${authorizationUrl.toString()}`);
    await this.config.onRedirect?.(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    log.debug(`保存 codeVerifier: ${this.config.mcpName}`);
    const entry = await getOAuthEntry(this.config.mcpName);
    await updateOAuthSession(this.config.mcpName, {
      codeVerifier,
      oauthState: entry?.oauthState,
      serverUrl: this.config.serverUrl,
    });
  }

  async codeVerifier(): Promise<string> {
    const entry = await getOAuthEntry(this.config.mcpName);
    if (!entry?.codeVerifier) {
      throw createInternalError("INTERNAL_ERROR", `No code verifier saved for ${this.config.mcpName}`);
    }
    return entry.codeVerifier;
  }

  async saveState(state: string): Promise<void> {
    const entry = await getOAuthEntry(this.config.mcpName);
    await updateOAuthSession(this.config.mcpName, {
      codeVerifier: entry?.codeVerifier,
      oauthState: state,
      serverUrl: this.config.serverUrl,
    });
  }

  async state(): Promise<string> {
    const entry = await getOAuthEntry(this.config.mcpName);
    if (!entry?.oauthState) {
      const state = this.createRandomHex();
      await updateOAuthSession(this.config.mcpName, {
        codeVerifier: entry?.codeVerifier,
        oauthState: state,
        serverUrl: this.config.serverUrl,
      });
      return state;
    }
    return entry.oauthState;
  }

  async invalidateCredentials(type: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    log.info(`清除凭证: ${this.config.mcpName} (${type})`);
    const entry = (await getOAuthEntry(this.config.mcpName)) ?? {};
    switch (type) {
      case "all": {
        await clearOAuthSession(this.config.mcpName);
        await clearOAuthClientInfo(this.config.mcpName);
        await clearOAuthTokens(this.config.mcpName);
        return;
      }
      case "client": {
        await clearOAuthClientInfo(this.config.mcpName);
        return;
      }
      case "tokens": {
        await clearOAuthTokens(this.config.mcpName);
        return;
      }
      case "verifier": {
        await clearOAuthSession(this.config.mcpName);
        return;
      }
      case "discovery": {
        return;
      }
    }
  }
}

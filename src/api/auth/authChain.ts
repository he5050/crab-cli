/**
 * 认证链 — 统一的认证信息获取机制。
 *
 * 职责:
 *   - 定义 AuthInfo 认证信息接口
 *   - 定义 AuthProvider 认证提供者接口
 *   - 通过 AuthChain 链式查找认证信息
 *   - 支持 API Key / OAuth / AWS 等多种认证方式
 *
 * 模块功能:
 *   - AuthInfo: 认证信息类型
 *   - AuthProvider: 认证提供者接口
 *   - AuthChain: 认证链，按优先级查找
 *   - resolveAuthHeaders: 将 AuthInfo 转换为 HTTP 请求头
 *
 * 使用场景:
 *   - LLM 调用前获取认证信息
 *   - Provider 根据 authType 选择认证方式
 *   - OAuth 类型自动获取/刷新 token
 *
 * 边界:
 *   1. 仅负责认证信息获取，不负责实际 HTTP 请求
 *   2. 认证链按注册顺序查找，第一个返回非 null 的结果即采用
 *   3. 支持 token 自动刷新
 */
import { createLogger } from "@/core/logging/logger";

const log = createLogger("auth:chain");

/** 认证信息 */
export interface AuthInfo {
  /** 认证类型 */
  type: "api-key" | "oauth" | "aws";
  /** API Key（type=api-key 时使用） */
  apiKey?: string;
  /** OAuth access token（type=oauth 时使用） */
  accessToken?: string;
  /** OAuth refresh token */
  refreshToken?: string;
  /** Token 过期时间（Unix 毫秒时间戳） */
  expiresAt?: number;
  /** AWS 凭证（type=aws 时使用） */
  aws?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** 自定义请求头 */
  headers?: Record<string, string>;
}

/** 认证提供者接口 */
export interface AuthProvider {
  /** 提供者唯一标识 */
  id: string;
  /** 获取指定 provider 的认证信息 */
  getAuth(providerId: string): Promise<AuthInfo | null>;
  /** 刷新认证信息（可选） */
  refresh?(authInfo: AuthInfo): Promise<AuthInfo>;
}

/**
 * 认证链 — 按注册顺序查找认证信息。
 *
 * 注册多个 AuthProvider，getAuth 时按顺序调用，
 * 第一个返回非 null 的结果即采用。
 */
export class AuthChain {
  private providers: AuthProvider[] = [];

  /** 注册认证提供者 */
  register(provider: AuthProvider): void {
    this.providers.push(provider);
    log.debug(`注册认证提供者: ${provider.id}`);
  }

  /** 获取认证信息 */
  async getAuth(providerId: string): Promise<AuthInfo | null> {
    for (const p of this.providers) {
      try {
        const auth = await p.getAuth(providerId);
        if (auth) {
          log.debug(`认证信息来源: ${p.id} (provider=${providerId})`);
          return auth;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.warn(`认证提供者 ${p.id} 获取认证信息失败: ${msg}`);
      }
    }
    return null;
  }

  /** 刷新认证信息 */
  async refresh(authInfo: AuthInfo): Promise<AuthInfo> {
    for (const p of this.providers) {
      if (p.refresh) {
        try {
          return await p.refresh(authInfo);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          log.warn(`认证提供者 ${p.id} 刷新失败: ${msg}`);
        }
      }
    }
    return authInfo;
  }
}

/** 全局认证链单例 */
let globalAuthChain: AuthChain | null = null;

/** 获取全局认证链 */
export function getGlobalAuthChain(): AuthChain {
  if (!globalAuthChain) {
    globalAuthChain = new AuthChain();
  }
  return globalAuthChain;
}

/** 重置全局认证链（测试用） */
export function resetGlobalAuthChain(): void {
  globalAuthChain = null;
}

/**
 * 将 AuthInfo 转换为 HTTP 请求头。
 *
 * @param auth - 认证信息
 * @returns HTTP 请求头键值对
 */
export function resolveAuthHeaders(auth: AuthInfo): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (auth.type) {
    case "api-key": {
      if (auth.apiKey) {
        headers["Authorization"] = `Bearer ${auth.apiKey}`;
      }
      break;
    }
    case "oauth": {
      if (auth.accessToken) {
        headers["Authorization"] = `Bearer ${auth.accessToken}`;
      }
      break;
    }
    case "aws": {
      // AWS SigV4 签名在 bedrock provider 中单独处理
      // 这里仅传递凭证信息
      break;
    }
  }

  // 合并自定义请求头
  if (auth.headers) {
    Object.assign(headers, auth.headers);
  }

  return headers;
}

/**
 * 检查认证信息是否已过期。
 *
 * @param auth - 认证信息
 * @param leewayMs - 提前量（毫秒），默认 60 秒
 * @returns 是否已过期
 */
export function isAuthExpired(auth: AuthInfo, leewayMs = 60_000): boolean {
  if (!auth.expiresAt) {
    return false;
  }
  return Date.now() + leewayMs >= auth.expiresAt;
}

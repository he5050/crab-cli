/**
 * MCP OAuth 凭证存储模块
 *
 * 职责:
 *   - 持久化存储 MCP OAuth 凭证(Token、客户端信息、会话状态)
 *   - 提供凭证的增删改查接口
 *   - 计算和返回认证状态
 *   - 管理凭证与服务器 URL 的关联
 *
 * 模块功能:
 *   - readOAuthStore/getOAuthEntry:读取存储的凭证
 *   - setOAuthEntry/removeOAuthEntry:写入/删除凭证
 *   - updateOAuthTokens:更新访问令牌
 *   - updateOAuthClientInfo:更新客户端注册信息
 *   - updateOAuthSession:更新 OAuth 会话状态(state、codeVerifier)
 *   - deriveMcpAuthStatus:派生认证状态
 *   - supportsMcpOAuth:检查服务器是否支持 OAuth
 *
 * 使用场景:
 *   - OAuth 流程中临时存储 state 和 codeVerifier
 *   - Token 获取后持久化保存
 *   - 应用启动时检查认证状态
 *   - 用户登出时清除凭证
 *
 * 边界:
 *   1. 存储位置:~/.crab/mcp-auth.json
 *   2. 自动创建父目录
 *   3. 认证状态:unsupported | not_authenticated | authenticated | expired
 *   4. 服务器 URL 变更时可能使凭证失效
 */

import path from "node:path";
import fs from "node:fs/promises";

import type { McpServerConfig } from "@/schema/config";
import { getAuthDir } from "@/config";
import { readJsonFile, writeJsonFile } from "@/core/utilities/fileUtils";
import { createLogger } from "@/core/logging/logger";
const log = createLogger("mcp:oauth-store");

export interface McpOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

export interface McpOAuthClientInfo {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
}

export interface McpOAuthEntry {
  tokens?: McpOAuthTokens;
  clientInfo?: McpOAuthClientInfo;
  codeVerifier?: string;
  oauthState?: string;
  serverUrl?: string;
}

export type McpOAuthStore = Record<string, McpOAuthEntry>;
export type McpAuthStatus = "unsupported" | "not_authenticated" | "authenticated" | "expired";

function getOAuthStorePath(): string {
  return path.join(getAuthDir(), "mcp-auth.json");
}

async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(path.dirname(getOAuthStorePath()), { recursive: true });
}

export async function readOAuthStore(): Promise<McpOAuthStore> {
  return (await readJsonFile<McpOAuthStore>(getOAuthStorePath())) ?? {};
}

export async function getOAuthEntry(name: string): Promise<McpOAuthEntry | undefined> {
  const store = await readOAuthStore();
  return store[name];
}

/** 串行化所有存储写入，防止并发 read-modify-write 竞态导致数据丢失 */
let storeWriteChain: Promise<boolean> = Promise.resolve(true);

/**
 * 串行化 read-modify-write 操作，确保并发写入不会互相覆盖。
 * 所有写入操作按提交顺序依次执行。
 */
async function atomicStoreUpdate(updater: (store: McpOAuthStore) => McpOAuthStore): Promise<boolean> {
  storeWriteChain = storeWriteChain.then(
    async () => {
      const store = await readOAuthStore();
      const updated = updater(store);
      await ensureStoreDir();
      return writeJsonFile(getOAuthStorePath(), updated);
    },
    async () => {
      // 前一次写入失败时仍继续执行
      const store = await readOAuthStore();
      const updated = updater(store);
      await ensureStoreDir();
      return writeJsonFile(getOAuthStorePath(), updated);
    },
  );
  return storeWriteChain;
}

export async function setOAuthEntry(name: string, entry: McpOAuthEntry): Promise<boolean> {
  return atomicStoreUpdate((store) => ({ ...store, [name]: entry }));
}

export async function removeOAuthEntry(name: string): Promise<boolean> {
  return atomicStoreUpdate((store) => {
    delete store[name];
    return { ...store };
  });
}

export async function updateOAuthTokens(name: string, tokens: McpOAuthTokens, serverUrl?: string): Promise<boolean> {
  log.debug(`更新 OAuth token: ${name}`);
  return atomicStoreUpdate((store) => {
    const entry = store[name] ?? {};
    return {
      ...store,
      [name]: { ...entry, serverUrl: serverUrl ?? entry.serverUrl, tokens },
    };
  });
}

export async function updateOAuthClientInfo(
  name: string,
  clientInfo: McpOAuthClientInfo,
  serverUrl?: string,
): Promise<boolean> {
  return atomicStoreUpdate((store) => {
    const entry = store[name] ?? {};
    return {
      ...store,
      [name]: { ...entry, clientInfo, serverUrl: serverUrl ?? entry.serverUrl },
    };
  });
}

export async function updateOAuthSession(
  name: string,
  session: { oauthState?: string; codeVerifier?: string; serverUrl?: string },
): Promise<boolean> {
  log.debug(`更新 OAuth session: ${name}`);
  return atomicStoreUpdate((store) => {
    const entry = store[name] ?? {};
    return {
      ...store,
      [name]: {
        ...entry,
        codeVerifier: session.codeVerifier,
        oauthState: session.oauthState,
        serverUrl: session.serverUrl ?? entry.serverUrl,
      },
    };
  });
}

export async function clearOAuthSession(name: string): Promise<boolean> {
  log.debug(`清除 OAuth session: ${name}`);
  return atomicStoreUpdate((store) => {
    const entry = store[name] ?? {};
    return {
      ...store,
      [name]: { ...entry, codeVerifier: undefined, oauthState: undefined },
    };
  });
}

export async function clearOAuthTokens(name: string): Promise<boolean> {
  return atomicStoreUpdate((store) => {
    const entry = store[name] ?? {};
    return {
      ...store,
      [name]: { ...entry, tokens: undefined },
    };
  });
}

export async function clearOAuthClientInfo(name: string): Promise<boolean> {
  return atomicStoreUpdate((store) => {
    const entry = store[name] ?? {};
    return {
      ...store,
      [name]: { ...entry, clientInfo: undefined },
    };
  });
}

export function deriveMcpAuthStatus(
  config: Pick<McpServerConfig, "url" | "oauth"> | undefined,
  entry?: McpOAuthEntry,
): McpAuthStatus {
  if (!config?.url || config.oauth === false) {
    return "unsupported";
  }
  if (!entry?.tokens?.accessToken) {
    return "not_authenticated";
  }
  if (entry.tokens.expiresAt && entry.tokens.expiresAt > 0 && entry.tokens.expiresAt < Date.now() / 1000) {
    return "expired";
  }
  return "authenticated";
}

export function supportsMcpOAuth(config: Pick<McpServerConfig, "url" | "oauth"> | undefined): boolean {
  return Boolean(config?.url) && config?.oauth !== false;
}

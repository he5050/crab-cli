/**
 * MCP 运行时管理模块
 *
 * 职责:
 *   - 管理 MCP 服务器的生命周期(启动、停止、重启)
 *   - 提供运行时状态快照和查询接口
 *   - 处理 MCP OAuth 认证流程
 *   - 管理内置工具组和外部 MCP 客户端
 *
 * 模块功能:
 *   - ensureMcpRuntimeStarted:确保 MCP 运行时已启动
 *   - refreshMcpRuntime:刷新 MCP 运行时配置
 *   - restartMcpRuntimeServer:重启指定 MCP 服务器
 *   - startMcpRuntimeAuth:启动 MCP OAuth 认证流程
 *   - finishMcpRuntimeAuthCode:完成 OAuth 授权码交换
 *   - setMcpRuntimeServerEnabled:启用/禁用 MCP 服务器
 *   - setMcpRuntimeToolDisabled:启用/禁用 MCP 工具
 *   - getMcpRuntimePrompts/Resources:获取 prompts 和 resources
 *
 * 使用场景:
 *   - 应用启动时初始化 MCP 运行时
 *   - 用户通过 UI 管理 MCP 服务器状态
 *   - OAuth 认证流程的完整生命周期管理
 *
 * 边界:
 *   1. 单例模式:全局只有一个 McpManager 实例
 *   2. OAuth 回调超时时间为 5 分钟
 *   3. 连接超时 60 秒，调用超时 300 秒
 */

import { globalBus, type EventBus } from "@/bus";
import { AppEvent, registerCleanup } from "@/bus";
import {
  getProjectMcpConfigPath,
  readMergedMcpConfigRecord,
  readMergedMcpConfigSources,
  setGlobalMcpServerEnabled,
  setGlobalMcpToolDisabled,
} from "./mcpConfig";
import { McpManager } from "./mcpManager";
import {
  type McpAuthStatus,
  type McpOAuthClientInfo,
  type McpOAuthTokens,
  clearOAuthSession,
  deriveMcpAuthStatus,
  getOAuthEntry,
  supportsMcpOAuth,
  updateOAuthClientInfo,
  updateOAuthSession,
  updateOAuthTokens,
} from "../oauth/oauthStore";
import { cancelPendingOAuthCallback, ensureOAuthCallbackServer, waitForOAuthCallback } from "../oauth/oauthCallback";
import { McpServerConfig } from "@/schema/config";
import { McpClient } from "../client/mcpClient";
import { getBuiltinToolGroups } from "@/tool/registry/toolRegistry";
import { createLogger } from "@/core/logging/logger";
import { getGlobalMcpConfigPath } from "@/config";
import { createInternalError } from "@/core/errors/appError";
import { createMcpError, toMcpLogPayload } from "../core/errors";

const log = createLogger("mcp:runtime");

const pendingOAuthClients = new Map<string, McpClient>();

export interface McpRuntimeServerSnapshot {
  name: string;
  state: "connected" | "connecting" | "disconnected" | "error" | "disabled";
  toolCount: number;
  type: "stdio" | "sse" | "http";
  enabled: boolean;
  source: "global" | "project";
  configPath: string;
  error?: string;
  disabledTools: string[];
  toolNames: string[];
  supportsOAuth: boolean;
  authStatus: McpAuthStatus;
  tag: "builtin" | "external";
  connectDurationMs?: number;
}

let runtimeManager: McpManager | null = null;
let runtimeStarted = false;
let runtimeStartPromise: Promise<void> | null = null;
let cleanupRegistered = false;
let lastSnapshot: McpRuntimeServerSnapshot[] = [];
let lastBuiltinSnapshot: McpRuntimeServerSnapshot[] = [];

async function toRuntimeSnapshot(manager: McpManager): Promise<McpRuntimeServerSnapshot[]> {
  const results: McpRuntimeServerSnapshot[] = [];
  const sourceMap = await readMergedMcpConfigSources();
  for (const item of manager.snapshot) {
    const config = manager.getServerConfig(item.name);
    const entry = await getOAuthEntry(item.name);
    results.push({
      ...item,
      ...getConfigSource(item.name, sourceMap),
      authStatus: deriveMcpAuthStatus(config, entry),
      connectDurationMs: item.connectDurationMs,
      disabledTools: config?.disabledTools ?? [],
      supportsOAuth: supportsMcpOAuth(config),
      tag: "external",
      toolNames: (manager.connectedClients.find((client) => client.name === item.name)?.tools ?? []).map((tool) =>
        tool.name.startsWith(`${item.name}_`) ? tool.name.slice(item.name.length + 1) : tool.name,
      ),
    });
  }

  return results;
}

function getBuiltinRuntimeSnapshot(): McpRuntimeServerSnapshot[] {
  const results: McpRuntimeServerSnapshot[] = [];
  for (const group of getBuiltinToolGroups()) {
    results.push({
      authStatus: "not_authenticated" as const,
      configPath: "(内置)",
      connectDurationMs: 0,
      disabledTools: [],
      enabled: true,
      name: group.name,
      source: "global" as const,
      state: "connected" as const,
      supportsOAuth: false,
      tag: "builtin",
      toolCount: group.tools.length,
      toolNames: group.tools,
      type: "http" as const,
    });
  }
  return results;
}

function publishSnapshot(servers: McpRuntimeServerSnapshot[], eventBus: EventBus = globalBus) {
  lastSnapshot = servers;
  lastBuiltinSnapshot = getBuiltinRuntimeSnapshot();
  eventBus.publish(AppEvent.McpStatusUpdated, {
    builtinGroups: lastBuiltinSnapshot,
    servers,
  });
}

function getConfigSource(
  name: string,
  sourceMap: Record<string, { source: "global" | "project"; configPath: string }>,
): { source: "global" | "project"; configPath: string } {
  const resolved = sourceMap[name];
  if (resolved) {
    return resolved;
  }

  const projectPath = getProjectMcpConfigPath(process.cwd());
  if (projectPath) {
    return { configPath: projectPath, source: "project" };
  }
  return { configPath: getGlobalMcpConfigPath(), source: "global" };
}

function createManager() {
  return new McpManager({
    callTimeout: 300_000,
    connectTimeout: 60_000,
    onStatusChange: async () => {
      if (!runtimeManager) return;
      publishSnapshot(await toRuntimeSnapshot(runtimeManager));
    },
  });
}

export async function ensureMcpRuntimeStarted(): Promise<McpManager> {
  if (!runtimeManager) {
    runtimeManager = createManager();
  }

  if (!runtimeStarted && !runtimeStartPromise) {
    log.info("MCP Runtime 首次启动中...");
    runtimeStarted = true;
    runtimeStartPromise = (async () => {
      try {
        await runtimeManager!.startAll();
        log.info(`MCP Runtime startAll 完成, servers count: ${runtimeManager!.snapshot.length}`);
      } catch (err) {
        const error = createMcpError(err, { operation: "startAll" }, "runtime");
        log.error(`MCP Runtime startAll 失败: ${error.message}`, toMcpLogPayload(error));
      }
      publishSnapshot(await toRuntimeSnapshot(runtimeManager!));
    })().finally(() => {
      runtimeStartPromise = null;
    });
  }

  if (runtimeStartPromise) {
    await runtimeStartPromise;
  }

  if (!cleanupRegistered) {
    cleanupRegistered = true;
    registerCleanup(async () => {
      if (runtimeManager) {
        await runtimeManager.stopAll();
      }
      runtimeStarted = false;
      runtimeStartPromise = null;
      runtimeManager = null;
      lastSnapshot = [];
      lastBuiltinSnapshot = [];
    });
  }

  return runtimeManager;
}

export async function refreshMcpRuntime(): Promise<void> {
  log.info("刷新 MCP Runtime 配置");
  const manager = await ensureMcpRuntimeStarted();
  await manager.refreshConfigs();
  publishSnapshot(await toRuntimeSnapshot(manager));
}

export async function restartMcpRuntimeServer(name: string): Promise<void> {
  log.info(`重启 MCP 服务: ${name}`);
  const manager = await ensureMcpRuntimeStarted();
  await manager.restartServer(name);
  publishSnapshot(await toRuntimeSnapshot(manager));
}

export function getMcpRuntimeSnapshot(): McpRuntimeServerSnapshot[] {
  return [...lastSnapshot];
}

export function getMcpRuntimeBuiltinSnapshot(): McpRuntimeServerSnapshot[] {
  return [...lastBuiltinSnapshot];
}

export function getMcpRuntimeDisplaySnapshot(): McpRuntimeServerSnapshot[] {
  return [...lastSnapshot, ...lastBuiltinSnapshot];
}

export async function getMcpRuntimeAuthStatus(name: string): Promise<McpAuthStatus> {
  const manager = await ensureMcpRuntimeStarted();
  const config = manager.getServerConfig(name);
  const entry = await getOAuthEntry(name);
  return deriveMcpAuthStatus(config, entry);
}

export async function getMcpRuntimeAuthCapabilities(): Promise<
  { name: string; supported: boolean; status: McpAuthStatus }[]
> {
  const manager = await ensureMcpRuntimeStarted();
  const results: { name: string; supported: boolean; status: McpAuthStatus }[] = [];
  for (const item of manager.snapshot) {
    const config = manager.getServerConfig(item.name);
    const supported = supportsMcpOAuth(config);
    const entry = await getOAuthEntry(item.name);
    results.push({
      name: item.name,
      status: deriveMcpAuthStatus(config, entry),
      supported,
    });
  }
  return results;
}

function createRandomHex(bytes = 32): string {
  // 复用 crypto.getRandomValues 生成安全随机 hex 字符串（PKCE state / codeVerifier）
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function resolveAuthConfig(name: string): Promise<McpServerConfig | undefined> {
  const merged = await readMergedMcpConfigRecord();
  const entry = merged[name];
  if (!entry) {
    return undefined;
  }
  return McpServerConfig.parse({
    args: entry.args ?? [],
    command: entry.command,
    cwd: entry.cwd,
    disabledTools: entry.disabledTools,
    enabled: entry.enabled,
    env: entry.env,
    headers: entry.headers,
    name,
    oauth: entry.oauth,
    timeout: entry.timeout,
    type: entry.type ?? (entry.url ? "http" : "stdio"),
    url: entry.url,
  });
}

async function discoverAuthorizationUrl(serverUrl: string, name: string): Promise<string | null> {
  if (!serverUrl) {
    return null;
  }

  // 1. OIDC Discovery: /.well-known/oauth-authorization-server
  try {
    const discoveryUrl = new URL("/.well-known/oauth-authorization-server", serverUrl);
    const resp = await fetch(discoveryUrl.toString(), { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const metadata = (await resp.json()) as Record<string, string>;
      if (metadata.authorization_endpoint) {
        log.info(`OAuth: OIDC Discovery 获取 authorizationUrl: ${metadata.authorization_endpoint}`);
        return metadata.authorization_endpoint;
      }
    }
  } catch (err) {
    const error = createMcpError(
      err,
      { operation: "oauthAuthorizationServerDiscovery", serverName: name, url: serverUrl },
      "network",
    );
    log.warn(`OAuth: OIDC Discovery 失败: ${error.message}`, toMcpLogPayload(error));
  }

  // 2. Fallback: OpenID Connect discovery: /.well-known/openid-configuration
  try {
    const oidcUrl = new URL("/.well-known/openid-configuration", serverUrl);
    const resp = await fetch(oidcUrl.toString(), { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const metadata = (await resp.json()) as Record<string, string>;
      if (metadata.authorization_endpoint) {
        log.info(`OAuth: OpenID Discovery 获取 authorizationUrl: ${metadata.authorization_endpoint}`);
        return metadata.authorization_endpoint;
      }
    }
  } catch (err) {
    const error = createMcpError(
      err,
      { operation: "openidConfigurationDiscovery", serverName: name, url: serverUrl },
      "network",
    );
    log.warn(`OAuth: OpenID Discovery 失败: ${error.message}`, toMcpLogPayload(error));
  }

  return null;
}

async function buildAuthorizationUrl(
  config: McpServerConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): Promise<string> {
  const oauthConfig = config.oauth;
  const configuredAuthUrl = typeof oauthConfig === "object" ? oauthConfig.authorizationUrl : undefined;

  let authorizationUrl = "";

  if (configuredAuthUrl) {
    authorizationUrl = configuredAuthUrl;
    log.info(`OAuth: 使用配置的 authorizationUrl: ${authorizationUrl}`);
  } else {
    const discovered = await discoverAuthorizationUrl(config.url!, config.name);
    if (discovered) {
      authorizationUrl = discovered;
    }
  }

  if (!authorizationUrl) {
    throw createInternalError(
      "INTERNAL_ERROR",
      `无法获取 OAuth authorizationUrl。请在 mcp.json 中对 "${config.name}" 配置 oauth.authorizationUrl`,
    );
  }

  const authUrl = new URL(authorizationUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("redirect_uri", redirectUri);

  if (typeof oauthConfig === "object") {
    if (oauthConfig.clientId) {
      authUrl.searchParams.set("client_id", oauthConfig.clientId);
    }
    if (oauthConfig.scope) {
      authUrl.searchParams.set("scope", oauthConfig.scope);
    }
  }

  log.info(`OAuth: 完整 authorizationUrl 已生成 (${authUrl.toString().length} chars)`);
  return authUrl.toString();
}

export async function startMcpRuntimeAuth(
  name: string,
): Promise<{ redirectUri: string; state: string; codeVerifier: string; authorizationUrl: string }> {
  const resolvedConfig = await resolveAuthConfig(name);
  if (!resolvedConfig) {
    throw createMcpError(
      `MCP server "${name}" not found`,
      {
        operation: "startAuth",
        serverName: name,
      },
      "not_found",
    );
  }
  if (!supportsMcpOAuth(resolvedConfig)) {
    throw createMcpError(
      `MCP server "${name}" does not support OAuth`,
      {
        operation: "startAuth",
        serverName: name,
      },
      "unsupported",
    );
  }
  const config = resolvedConfig;

  const oauthConfig = config?.oauth;
  const redirect = await ensureOAuthCallbackServer(
    oauthConfig && typeof oauthConfig === "object" ? oauthConfig.redirectUri : undefined,
  );
  const state = createRandomHex();
  const codeVerifier = createRandomHex();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);

  const authorizationUrl = await buildAuthorizationUrl(config, redirect.redirectUri, state, codeChallenge);

  const ok = await updateOAuthSession(name, {
    codeVerifier,
    oauthState: state,
    serverUrl: config?.url,
  });
  if (!ok) {
    throw createInternalError("INTERNAL_ERROR", `Failed to persist OAuth session for ${name}`);
  }

  const client = new McpClient({
    callTimeout: config.timeout ?? 60_000,
    config,
    connectTimeout: 60_000,
  });

  pendingOAuthClients.set(name, client);

  return {
    authorizationUrl,
    codeVerifier,
    redirectUri: redirect.redirectUri,
    state,
  };
}

/**
 * 从 codeVerifier 派生 PKCE code_challenge (S256)。
 * SHA256(codeVerifier) → base64url 编码。
 */
async function deriveCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  // Base64url 编码(RFC 7636)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function waitForMcpRuntimeAuthCode(name: string): Promise<string> {
  const entry = await getOAuthEntry(name);
  if (!entry?.oauthState) {
    throw createInternalError("INTERNAL_ERROR", `No OAuth state for MCP server "${name}"`);
  }
  return waitForOAuthCallback(entry.oauthState, name);
}

export async function finishMcpRuntimeAuth(
  name: string,
  tokens: McpOAuthTokens,
  clientInfo?: McpOAuthClientInfo,
): Promise<boolean> {
  const config = await resolveAuthConfig(name);
  const tokenOk = await updateOAuthTokens(name, tokens, config?.url);
  if (!tokenOk) {
    return false;
  }
  if (clientInfo) {
    const clientOk = await updateOAuthClientInfo(name, clientInfo, config?.url);
    if (!clientOk) {
      return false;
    }
  }
  return clearOAuthSession(name);
}

export async function finishMcpRuntimeAuthCode(
  name: string,
  authorizationCode: string,
  eventBus: EventBus = globalBus,
): Promise<boolean> {
  if (!authorizationCode?.trim()) {
    throw createInternalError("INTERNAL_ERROR", `authorizationCode is required for MCP server "${name}"`);
  }
  const client = pendingOAuthClients.get(name);
  if (!client) {
    throw createInternalError("INTERNAL_ERROR", `No pending OAuth client for ${name}`);
  }
  await client.finishAuth(authorizationCode);
  pendingOAuthClients.delete(name);
  await clearOAuthSession(name);
  await refreshMcpRuntime();
  eventBus.publish(AppEvent.Toast, {
    message: `MCP OAuth 已完成: ${name}`,
    variant: "success",
  });
  return true;
}

export async function cancelMcpRuntimeAuth(name: string): Promise<boolean> {
  pendingOAuthClients.delete(name);
  cancelPendingOAuthCallback(name);
  return clearOAuthSession(name);
}

export async function getMcpRuntimePrompts(): Promise<{ server: string; name: string; description?: string }[]> {
  const manager = await ensureMcpRuntimeStarted();
  const clients = manager.connectedClients;
  const results = await Promise.allSettled(
    clients.map((client) =>
      client.listPrompts().then((prompts) => prompts.map((prompt) => ({ ...prompt, server: client.name }))),
    ),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export async function getMcpRuntimeResources(): Promise<
  { server: string; name: string; uri: string; description?: string; mimeType?: string }[]
> {
  const manager = await ensureMcpRuntimeStarted();
  const clients = manager.connectedClients;
  const results = await Promise.allSettled(
    clients.map((client) =>
      client.listResources().then((resources) => resources.map((resource) => ({ ...resource, server: client.name }))),
    ),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export async function getMcpRuntimePrompt(
  server: string,
  name: string,
  args?: Record<string, string>,
): Promise<unknown> {
  const manager = await ensureMcpRuntimeStarted();
  const client = manager.connectedClients.find((entry) => entry.name === server);
  if (!client) {
    throw createInternalError("INTERNAL_ERROR", `MCP server "${server}" is not connected`);
  }
  return client.getPrompt(name, args);
}

export async function readMcpRuntimeResource(server: string, uri: string): Promise<unknown> {
  const manager = await ensureMcpRuntimeStarted();
  const client = manager.connectedClients.find((entry) => entry.name === server);
  if (!client) {
    throw createInternalError("INTERNAL_ERROR", `MCP server "${server}" is not connected`);
  }
  return client.readResource(uri);
}

export async function setMcpRuntimeServerEnabled(
  name: string,
  enabled: boolean,
  eventBus: EventBus = globalBus,
): Promise<boolean> {
  const ok = await setGlobalMcpServerEnabled(name, enabled);
  if (!ok) {
    return false;
  }
  await refreshMcpRuntime();
  eventBus.publish(AppEvent.Toast, {
    message: `MCP 服务 ${name} 已${enabled ? "启用" : "禁用"}`,
    variant: enabled ? "success" : "warning",
  });
  return true;
}

export async function setMcpRuntimeToolDisabled(
  name: string,
  toolName: string,
  disabled: boolean,
  eventBus: EventBus = globalBus,
): Promise<boolean> {
  const ok = await setGlobalMcpToolDisabled(name, toolName, disabled);
  if (!ok) {
    return false;
  }
  await refreshMcpRuntime();
  eventBus.publish(AppEvent.Toast, {
    message: `MCP 工具 ${name}/${toolName} 已${disabled ? "禁用" : "启用"}`,
    variant: disabled ? "warning" : "success",
  });
  return true;
}

/** 重置模块状态(仅用于测试隔离) */
export function _resetMcpRuntimeForTesting(): void {
  pendingOAuthClients.clear();
  runtimeManager = null;
  runtimeStarted = false;
  runtimeStartPromise = null;
  cleanupRegistered = false;
  lastSnapshot = [];
  lastBuiltinSnapshot = [];
}

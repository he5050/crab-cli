/**
 * MCP 传输层管理 — 创建和管理各种传输类型。
 *
 * 职责:
 *   - 封装 STDIO/SSE/HTTP 传输的创建逻辑
 *   - 提供传输层错误判断和回退策略
 *   - 支持 OAuth 认证提供者配置
 *
 * 模块功能:
 *   - createTransport:创建传输层实例(STDIO/SSE/HTTP)
 *   - isConnectionError:判断错误是否为连接级错误(可重试)
 *   - shouldFallbackToSSE:判断是否应该从 HTTP 回退到 SSE
 *
 * 使用场景:
 *   - MCP Client 建立连接前创建传输层
 *   - 需要根据配置选择不同传输类型时
 *   - 处理连接错误和传输回退时
 *
 * 边界:
 *   1. 仅负责传输层创建，不管理连接生命周期
 *   2. STDIO 传输需要 command 字段
 *   3. SSE/HTTP 传输需要 url 字段
 *   4. 支持从环境变量注入 Auth 头
 *
 * 流程:
 *   1. 根据 config.type 确定传输类型
 *   2. 创建对应的传输层实例
 *   3. 配置 OAuth 认证提供者(如需要)
 *   4. 返回传输层实例给 McpClient 使用
 */

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "@/schema/config";
import { resolveStdioCommand } from "../cmd/commandResolution";
import { McpOAuthProvider } from "../oauth/oauthProvider";
import { createLogger } from "@/core/logging/logger";
import { createInternalError } from "@/core/errors/appError";
import { getMcpErrorMessage } from "../core/errors";

const log = createLogger("mcp:transport");

/** 传输类型 */
export type TransportType = "stdio" | "sse" | "http";

/** MCP 传输层实例类型 */
export type McpTransport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

/**
 * 创建传输层实例。
 *
 * @param config - MCP 服务器配置
 * @param type - 传输类型
 * @returns 传输层实例
 */
export function createTransport(config: McpServerConfig, type: TransportType): McpTransport {
  const authProvider = createAuthProvider(config);

  switch (type) {
    case "stdio": {
      if (!config.command) {
        throw createInternalError("INTERNAL_ERROR", `${config.name}: STDIO transport requires "command" field`);
      }
      log.debug(`[${config.name}] 创建 STDIO 传输: command=${config.command}, args=${JSON.stringify(config.args)}`);
      const resolved = resolveStdioCommand({
        args: config.args,
        command: config.command,
        env: config.env as Record<string, string> | undefined,
      });
      log.debug(`[${config.name}] STDIO 命令解析结果:`, {
        args: resolved.args,
        command: resolved.command,
        envKeys: Object.keys(resolved.env).slice(0, 10),
        path: resolved.env.PATH?.slice(0, 200),
      });
      return new StdioClientTransport({
        args: resolved.args,
        command: resolved.command,
        cwd: config.cwd,
        env: resolved.env,
        stderr: "pipe",
      });
    }

    case "sse": {
      if (!config.url) {
        throw createInternalError("INTERNAL_ERROR", `${config.name}: SSE transport requires "url" field`);
      }
      return new SSEClientTransport(new URL(config.url), {
        authProvider,
        requestInit: buildRequestInit(config),
      });
    }

    case "http":
    default: {
      if (!config.url) {
        throw createInternalError("INTERNAL_ERROR", `${config.name}: HTTP transport requires "url" field`);
      }
      return new StreamableHTTPClientTransport(new URL(config.url), {
        authProvider,
        requestInit: buildRequestInit(config),
      });
    }
  }
}

/**
 * 创建 OAuth 认证提供者。
 */
function createAuthProvider(config: McpServerConfig): McpOAuthProvider | undefined {
  if (!config.url || config.oauth === false) {
    return undefined;
  }
  const oauth = config.oauth && typeof config.oauth === "object" ? config.oauth : {};
  return new McpOAuthProvider({
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    mcpName: config.name,
    onRedirect: async () => {
      // OAuth 重定向由调用方处理
    },
    redirectUri: oauth.redirectUri ?? `http://127.0.0.1:19876/mcp/oauth/callback`,
    scope: oauth.scope,
    serverUrl: config.url,
  });
}

/**
 * 构建 HTTP 请求的 headers(Auth 等)。
 */
function buildRequestInit(config: McpServerConfig): RequestInit | undefined {
  const headers: Record<string, string> = {
    ...config.headers,
  };

  // 从环境变量注入 Auth 头
  const mcpApiKey = process.env.MCP_API_KEY;
  const mcpAuthHeader = process.env.MCP_AUTH_HEADER;
  if (mcpAuthHeader) {
    // 自定义 Auth 头格式，如 "X-Api-Key: xxx"
    const [key, ...valueParts] = mcpAuthHeader.split(":");
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join(":").trim();
    }
  } else if (mcpApiKey) {
    headers["Authorization"] = `Bearer ${mcpApiKey}`;
  }

  if (Object.keys(headers).length === 0) {
    return undefined;
  }
  return { headers };
}

/** 连接错误关键词 — 用于判断是否可安全重试 */
const CONNECTION_ERROR_KEYWORDS = [
  "stream",
  "destroyed",
  "closed",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "network",
  "fetch failed",
  "abort",
  "cancel",
  "timeout",
];

/**
 * 判断错误是否为连接级错误(可重试)。
 */
export function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const msg = err.message.toLowerCase();
  return CONNECTION_ERROR_KEYWORDS.some((kw) => msg.includes(kw));
}

/**
 * 判断是否应该从 HTTP 回退到 SSE。
 */
export function shouldFallbackToSSE(error: unknown): boolean {
  const errorCode = (error as { code?: unknown })?.code;
  if (typeof errorCode === "number") {
    return [404, 405, 406, 415, 501].includes(errorCode);
  }

  const message = getMcpErrorMessage(error).toLowerCase();
  return (
    message.includes("error posting to endpoint (http 404)") ||
    message.includes("error posting to endpoint (http 405)") ||
    message.includes("error posting to endpoint (http 406)") ||
    message.includes("error posting to endpoint (http 415)") ||
    message.includes("error posting to endpoint (http 501)") ||
    message.includes("method not allowed") ||
    message.includes("unexpected content type")
  );
}

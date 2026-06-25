/**
 * Context7 MCP API 客户端 — 官方 MCP SDK 连接 Streamable HTTP 服务端点
 *
 * 职责:
 *   - 管理 MCP 客户端连接生命周期
 *   - 实现 resolve-library-id API 调用
 *   - 实现 query-docs API 调用
 *   - 解析和转换 MCP 工具响应
 *
 * 模块功能:
 *   - getClient:获取或创建 MCP 客户端单例
 *   - parseToolResponse:解析 MCP 工具响应的文本内容
 *   - resolveLibraryId:将通用库名称解析为 Context7 兼容的库 ID
 *   - queryLibraryDocs:使用库 ID 获取库的文档片段
 *   - closeClient:关闭 MCP 客户端连接
 *
 * 使用场景:
 *   - 查询开源库的官方文档(如 npm:react, github:facebook/react)
 *   - 获取库的版本信息和元数据
 *   - 基于最新官方文档回答技术问题
 *
 * 边界:
 * 1. 使用官方 @modelcontextprotocol/sdk 客户端
 * 2. 服务端点固定为 https://mcp.context7.com/mcp
 * 3. 客户端采用单例模式，避免重复连接
 * 4. 响应解析支持 JSON 和纯文本两种格式
 *
 * 流程:
 * 1. 获取或创建 MCP 客户端连接
 * 2. 调用对应工具(resolve-library-id 或 query-docs)
 * 3. 解析工具响应(JSON 解析或纯文本处理)
 * 4. 返回结构化的文档或库信息
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLogger } from "@/core/logging/logger";
import type { Context7DocFragment, Context7Library } from "@/tool/context7/types";
import { createInternalError } from "@/core/errors/appError";
import { createNetworkError } from "@/core/errors/appError";

const log = createLogger("context7:client");

const MCP_BASE_URL = "https://mcp.context7.com/mcp";

// 超时策略：连接超时 10 秒，工具调用超时 30 秒
const CONNECT_TIMEOUT = 10_000;
const CALL_TOOL_TIMEOUT = 30_000;

// 缓存客户端实例
let client: Client | null = null;
let transport: StreamableHTTPClientTransport | null = null;
// 本地连接状态标记，MCP SDK Client 无 connected 属性，手动追踪
let isConnected = false;

/**
 * 安全关闭旧客户端，释放 transport 资源
 */
async function cleanupClient(): Promise<void> {
  try {
    if (client) {
      await client.close();
    }
  } catch {
    // 忽略关闭时的错误，确保资源释放
  } finally {
    client = null;
    transport = null;
    isConnected = false;
  }
}

/**
 * 获取或创建 MCP 客户端
 * - 如果已有客户端且连接正常，直接复用
 * - 如果客户端已断开，先关闭旧客户端再重建连接
 * - 连接过程附带 10 秒超时，超时后清理 transport 资源
 */
async function getClient(): Promise<Client> {
  // 已有客户端且连接正常则复用
  if (client && isConnected) {
    return client;
  }

  // 客户端存在但已断开，先清理旧资源再重建
  if (client) {
    log.debug("Context7 MCP 客户端已断开，正在重建连接...");
    await cleanupClient();
  }

  transport = new StreamableHTTPClientTransport(new URL(MCP_BASE_URL));

  client = new Client({ name: "crab-cli-context7", version: "0.5.0" }, { capabilities: {} });

  // 监听 transport 关闭事件，及时更新连接状态
  transport.onclose = () => {
    isConnected = false;
    log.debug("Context7 MCP transport 已关闭");
  };

  // 使用 AbortController + Promise.race 实现 10 秒连接超时
  const connectAbort = new AbortController();
  const timeoutId = setTimeout(() => connectAbort.abort(), CONNECT_TIMEOUT);

  // 超时守卫：AbortController.signal 不影响 connect，仅用于触发 race 退出
  const timeoutPromise = new Promise<never>((_, reject) => {
    connectAbort.signal.addEventListener("abort", () => {
      reject(createNetworkError("CONNECTION_TIMEOUT", `Context7 MCP 连接超时（${CONNECT_TIMEOUT / 1000}秒）`));
    });
  });

  try {
    await Promise.race([client.connect(transport), timeoutPromise]);
    isConnected = true;
    log.debug("Context7 MCP 客户端已连接");
  } catch (error) {
    // 连接失败时清理 transport 资源，避免泄漏
    await cleanupClient();
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  return client;
}

/**
 * 解析 MCP 工具响应
 */
function parseToolResponse(result: { content: { type: string; text?: string }[] }): string {
  const { content } = result;
  const textItem = content.find((c) => c.type === "text");

  if (!textItem || !textItem.text) {
    throw createInternalError("INTERNAL_ERROR", "MCP 响应中没有文本内容");
  }

  return textItem.text;
}

/**
 * 调用 Context7 MCP API - resolve-library-id
 * 将通用库名称解析为 Context7 兼容的库 ID
 */
export async function resolveLibraryId(
  libraryName: string,
  query?: string,
  version?: string,
): Promise<{ libraryId: string; libraries?: Context7Library[] }> {
  log.debug(`解析库 ID: ${libraryName}`);

  const mcpClient = await getClient();

  // 使用 30 秒超时保护 callTool 调用
  const callAbort = new AbortController();
  const timeoutId = setTimeout(() => callAbort.abort(), CALL_TOOL_TIMEOUT);

  try {
    const result = await Promise.race([
      mcpClient.callTool({
        arguments: {
          libraryName,
          query: query || libraryName,
          ...(version && { version }),
        },
        name: "resolve-library-id",
      }),
      new Promise<never>((_, reject) => {
        callAbort.signal.addEventListener("abort", () => {
          reject(createNetworkError("REQUEST_TIMEOUT", `resolve-library-id 调用超时（${CALL_TOOL_TIMEOUT / 1000}秒）`));
        });
      }),
    ]);

    const text = parseToolResponse(result as { content: { type: string; text?: string }[] });

    try {
      const data = JSON.parse(text) as {
        libraryId: string;
        libraries?: Context7Library[];
      };
      log.debug(`解析成功: ${data.libraryId}`);
      return {
        libraries: data.libraries,
        libraryId: data.libraryId,
      };
    } catch (error) {
      // 如果不是 JSON，可能是直接的 libraryId
      log.debug(`响应为纯文本: ${error instanceof Error ? error.message : String(error)}，作为 libraryId: ${text}`);
      return { libraryId: text.trim() };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 调用 Context7 MCP API - query-docs
 * 使用与 Context7 兼容的库 ID 获取库的文档
 */
export async function queryLibraryDocs(
  libraryId: string,
  query: string,
  version?: string,
): Promise<{
  fragments: Context7DocFragment[];
  libraryId: string;
  query: string;
}> {
  log.debug(`查询文档: ${libraryId} - ${query}`);

  const mcpClient = await getClient();

  // 使用 30 秒超时保护 callTool 调用
  const callAbort = new AbortController();
  const timeoutId = setTimeout(() => callAbort.abort(), CALL_TOOL_TIMEOUT);

  try {
    const result = await Promise.race([
      mcpClient.callTool({
        arguments: {
          libraryId,
          query,
          ...(version && { version }),
        },
        name: "query-docs",
      }),
      new Promise<never>((_, reject) => {
        callAbort.signal.addEventListener("abort", () => {
          reject(createNetworkError("REQUEST_TIMEOUT", `query-docs 调用超时（${CALL_TOOL_TIMEOUT / 1000}秒）`));
        });
      }),
    ]);

    const text = parseToolResponse(result as { content: { type: string; text?: string }[] });

    try {
      const data = JSON.parse(text) as {
        fragments: Context7DocFragment[];
        libraryId: string;
        query: string;
      };
      log.debug(`获取到 ${data.fragments?.length || 0} 个文档片段`);
      return {
        fragments: data.fragments || [],
        libraryId: data.libraryId || libraryId,
        query: data.query || query,
      };
    } catch (error) {
      // 如果不是 JSON，返回单个片段
      log.debug(
        `响应不是 JSON 格式: ${error instanceof Error ? error.message : String(error)}，返回文本内容作为单个片段`,
      );
      return {
        fragments: [
          {
            content: text,
            title: "Documentation",
          },
        ],
        libraryId,
        query,
      };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 关闭 MCP 客户端连接
 */
export async function closeClient(): Promise<void> {
  await cleanupClient();
  log.debug("Context7 MCP 客户端已关闭");
}

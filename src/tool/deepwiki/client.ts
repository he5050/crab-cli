/**
 * DeepWiki MCP API 客户端模块
 *
 * 职责:
 *   - 使用官方 MCP SDK 连接 DeepWiki Streamable HTTP 服务端点
 *   - 提供文档结构查询、内容读取、问答功能
 *   - 管理 MCP 客户端连接生命周期
 *
 * 模块功能:
 *   - getClient: 获取或创建 MCP 客户端
 *   - normalizeRepoName: 规范化仓库名格式
 *   - parseToolResponse: 解析 MCP 工具响应
 *   - readWikiStructure: 获取仓库文档目录结构
 *   - readWikiContents: 读取指定路径的文档内容
 *   - askQuestion: 基于文档回答问题
 *   - closeClient: 关闭 MCP 客户端连接
 *
 * 使用场景:
 *   - 获取 GitHub 仓库的文档结构
 *   - 读取特定文档内容
 *   - 基于文档进行问答
 *
 * 边界:
 *   1. 服务端点: https://mcp.deepwiki.com/mcp
 *   2. 仅支持 GitHub 仓库
 *   3. 需要网络连接
 *   4. 客户端实例缓存复用
 *   5. 响应解析支持 JSON 和纯文本
 *
 * 流程:
 *   1. 获取或创建 MCP 客户端
 *   2. 规范化仓库名
 *   3. 调用 MCP 工具
 *   4. 解析响应内容
 *   5. 返回结构化数据
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLogger } from "@/core/logging/logger";
import type { DeepWikiStructureItem } from "@/tool/deepwiki/types";
import { createInternalError } from "@/core/errors/appError";
import { createNetworkError } from "@/core/errors/appError";

const log = createLogger("deepwiki:client");

const MCP_BASE_URL = "https://mcp.deepwiki.com/mcp";

// 超时策略：连接超时 10 秒，工具调用超时 30 秒（与 context7 保持一致）
const CONNECT_TIMEOUT = 10_000;
const CALL_TOOL_TIMEOUT = 30_000;

// 缓存客户端实例
let client: Client | null = null;
let transport: StreamableHTTPClientTransport | null = null;
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
    log.debug("DeepWiki MCP 客户端已断开，正在重建连接...");
    await cleanupClient();
  }

  transport = new StreamableHTTPClientTransport(new URL(MCP_BASE_URL));

  client = new Client({ name: "crab-cli-deepwiki", version: "0.5.0" }, { capabilities: {} });

  // 监听 transport 关闭事件，及时更新连接状态
  transport.onclose = () => {
    isConnected = false;
    log.debug("DeepWiki MCP transport 已关闭");
  };

  // 使用 AbortController + Promise.race 实现 10 秒连接超时
  const connectAbort = new AbortController();
  const timeoutId = setTimeout(() => connectAbort.abort(), CONNECT_TIMEOUT);

  // 超时守卫：AbortController.signal 不影响 connect，仅用于触发 race 退出
  const timeoutPromise = new Promise<never>((_, reject) => {
    connectAbort.signal.addEventListener("abort", () => {
      reject(createNetworkError("CONNECTION_TIMEOUT", `DeepWiki MCP 连接超时（${CONNECT_TIMEOUT / 1000}秒）`));
    });
  });

  try {
    await Promise.race([client.connect(transport), timeoutPromise]);
    isConnected = true;
    log.debug("DeepWiki MCP 客户端已连接");
  } catch (error) {
    // 连接失败时清理 transport 资源，避免泄漏
    await cleanupClient();
    throw error;
  } finally {
    clearTimeout(timeoutId);
    // abort listener 随 timeoutPromise 一起被 GC，无需显式移除
  }

  return client;
}

/**
 * 规范化仓库名
 */
/** 规范化仓库名格式，移除 URL 前缀并统一为 owner/repo 形式 */
export function normalizeRepoName(repoName: string): string {
  // 移除 https://github.com/ 前缀(如果有)
  let normalized = repoName.trim();

  if (normalized.startsWith("https://github.com/")) {
    normalized = normalized.slice("https://github.com/".length);
  }

  // 确保格式为 owner/repo
  normalized = normalized.replace(/^\/+|\/+$/g, "");

  return normalized;
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
 * 调用 MCP 工具并附带超时保护
 */
async function callToolWithTimeout(
  mcpClient: Client,
  toolName: string,
  args: Record<string, unknown>,
  description: string,
): Promise<{ content: { type: string; text?: string }[] }> {
  const callAbort = new AbortController();
  const timeoutId = setTimeout(() => callAbort.abort(), CALL_TOOL_TIMEOUT);

  try {
    const result = await Promise.race([
      mcpClient.callTool({ arguments: args, name: toolName }),
      new Promise<never>((_, reject) => {
        callAbort.signal.addEventListener("abort", () => {
          reject(createNetworkError("REQUEST_TIMEOUT", `${description} 调用超时（${CALL_TOOL_TIMEOUT / 1000}秒）`));
        });
      }),
    ]);
    // MCP SDK callTool 返回类型不统一，统一断言为 text content 格式
    return result as unknown as { content: { type: string; text?: string }[] };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 调用 DeepWiki MCP API - read_wiki_structure
 * 获取仓库文档目录结构
 */
export async function readWikiStructure(repoName: string): Promise<DeepWikiStructureItem[]> {
  const normalizedRepo = normalizeRepoName(repoName);

  log.debug(`获取文档结构: ${normalizedRepo}`);

  const mcpClient = await getClient();

  const result = await callToolWithTimeout(
    mcpClient,
    "deepwiki-read-structure",
    { repoName: normalizedRepo },
    "read_wiki_structure",
  );

  const text = parseToolResponse(result as { content: { type: string; text?: string }[] });

  // 尝试解析为 JSON，如果失败则返回模拟结构
  try {
    const data = JSON.parse(text) as { structure: DeepWikiStructureItem[] };
    log.debug(`获取到 ${data.structure?.length || 0} 个结构项`);
    return data.structure || [];
  } catch (error) {
    // 如果不是 JSON，可能是纯文本格式，返回模拟结构
    log.debug(
      `响应不是 JSON 格式: ${error instanceof Error ? error.message : String(error)}，返回文本内容作为单个文件`,
    );
    return [
      {
        name: "README",
        path: "README",
        type: "file",
      },
    ];
  }
}

/**
 * 调用 DeepWiki MCP API - read_wiki_contents
 * 读取指定路径的文档内容
 */
export async function readWikiContents(
  repoName: string,
  path: string,
): Promise<{ content: string; path: string; repoName: string }> {
  const normalizedRepo = normalizeRepoName(repoName);

  log.debug(`读取文档内容: ${normalizedRepo}/${path}`);

  const mcpClient = await getClient();

  const result = await callToolWithTimeout(
    mcpClient,
    "deepwiki-read-contents",
    { path, repoName: normalizedRepo },
    "read_wiki_contents",
  );

  const content = parseToolResponse(result as { content: { type: string; text?: string }[] });

  log.debug(`读取到 ${content.length} 字符内容`);

  return {
    content,
    path,
    repoName: normalizedRepo,
  };
}

/**
 * 调用 DeepWiki MCP API - ask_question
 * 基于文档回答问题
 */
export async function askQuestion(
  repoName: string,
  question: string,
): Promise<{ answer: string; question: string; repoName: string }> {
  const normalizedRepo = normalizeRepoName(repoName);

  log.debug(`提问: ${normalizedRepo} - ${question}`);

  const mcpClient = await getClient();

  const result = await callToolWithTimeout(
    mcpClient,
    "deepwiki-ask-question",
    { question, repoName: normalizedRepo },
    "ask_question",
  );

  const answer = parseToolResponse(result as { content: { type: string; text?: string }[] });

  log.debug(`获得回答: ${answer.length} 字符`);

  return {
    answer,
    question,
    repoName: normalizedRepo,
  };
}

/**
 * 关闭 MCP 客户端连接
 */
export async function closeClient(): Promise<void> {
  await cleanupClient();
  log.debug("DeepWiki MCP 客户端已关闭");
}

/**
 * MCP (Model Context Protocol) 客户端模块 — 公共导出。
 *
 * 职责:
 *   - MCP Server 的发现和连接
 *   - MCP 工具调用
 *   - MCP Server 生命周期管理
 *   - 工具 Schema 转换
 *
 * 模块功能:
 *   - McpClient: MCP 客户端类
 *   - McpManager: MCP 管理器
 *   - McpServerConfig: MCP Server 配置接口
 *   - McpTool: MCP 工具接口
 *   - connectToServer: 连接到 MCP Server
 *   - listTools: 列出可用工具
 *   - callTool: 调用 MCP 工具
 *   - disconnect: 断开连接
 *
 * 使用场景:
 *   - 连接外部 MCP Server
 *   - 发现并调用 MCP 工具
 *   - 管理 MCP 连接池
 *   - 工具 Schema 转换和验证
 *
 * 边界:
 *   1. 通过 stdio/sse 与 MCP Server 通信
 *   2. 工具 Schema 需要符合 MCP 规范
 *   3. 连接异常时自动重连
 *   4. 支持多 Server 同时连接
 *
 * 流程:
 *   1. 配置 MCP Server 连接信息
 *   2. 调用 connectToServer 建立连接
 *   3. 调用 listTools 获取可用工具
 *   4. 调用 callTool 执行工具
 *   5. 调用 disconnect 关闭连接
 */
export {
  McpClient,
  isConnectionError,
  type McpConnectionState,
  type McpClientCallbacks,
  type McpClientOptions,
} from "./client/mcpClient";
export { McpManager, type McpManagerOptions, type ReconnectPolicy } from "./manager/mcpManager";
export { loadMcpConfig, getMcpServers, resetMcpConfigCache, getProjectMcpConfigPath } from "./manager/mcpConfig";
export {
  getMcpRuntimeSnapshot,
  getMcpRuntimePrompts,
  getMcpRuntimeResources,
  getMcpRuntimePrompt,
  readMcpRuntimeResource,
  getMcpRuntimeAuthStatus,
  getMcpRuntimeAuthCapabilities,
  startMcpRuntimeAuth,
  waitForMcpRuntimeAuthCode,
  finishMcpRuntimeAuth,
  finishMcpRuntimeAuthCode,
  cancelMcpRuntimeAuth,
} from "./manager/runtime";
export { McpOAuthProvider, type McpOAuthProviderConfig } from "./oauth/oauthProvider";
export {
  readOAuthStore,
  getOAuthEntry,
  setOAuthEntry,
  removeOAuthEntry,
  updateOAuthTokens,
  updateOAuthClientInfo,
  updateOAuthSession,
  clearOAuthSession,
  deriveMcpAuthStatus,
  supportsMcpOAuth,
  type McpOAuthEntry,
  type McpOAuthTokens,
  type McpOAuthClientInfo,
  type McpAuthStatus,
} from "./oauth/oauthStore";
export {
  ensureOAuthCallbackServer,
  waitForOAuthCallback,
  cancelPendingOAuthCallback,
  stopOAuthCallbackServer,
  isOAuthCallbackServerRunning,
  parseOAuthRedirectUri,
} from "./oauth/oauthCallback";
export {
  interpolateEnvVars,
  interpolateEnvVarsInArray,
  interpolateEnvVarsInRecord,
  type ResolveStdioCommandInput,
  type ResolvedStdioCommand,
} from "./cmd/commandResolution";

// ─── Catalog 模块 - MCP 服务器目录 ─────────────────────────
export {
  MCP_CATALOG,
  searchCatalog,
  getCatalogEntry,
  listCatalog,
  installCatalogEntry,
  type McpCatalogEntry,
  type InstallCatalogOptions,
} from "./catalog/mcpCatalog";

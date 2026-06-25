/**
 * Schema 模块统一入口
 *
 * 职责:
 *   - 统一导出所有 Zod Schema 定义及推断类型
 *   - 作为 schema 模块的唯一公共 API，外部模块应通过此入口导入
 *
 * 模块功能:
 *   - 导出配置相关 Schema（AppConfig、MCP Server、Proxy 等）
 *   - 导出工具相关 Schema（ToolParameter、ToolDefinition 等）
 *   - 导出 ID 相关 Schema（SessionID、MessageID 等）
 *   - 导出权限相关 Schema（PermissionAction、PermissionRule 等）
 *   - 导出会话相关 Schema（Message、Session 等）
 *   - 导出 API 相关 Schema（ApiProvider，其余已废弃）
 *   - 导出 Agent 相关 Schema（AgentMode、AgentModel、AgentDefinition）
 *
 * 使用场景:
 *   - 验证配置数据
 *   - 定义工具参数和返回值
 *   - 权限规则验证
 *   - 会话/消息结构验证
 *   - Agent 配置验证
 *
 * 边界:
 *   1. 仅包含 Schema 定义，不包含业务逻辑
 *   2. 使用 Zod 进行类型验证
 *   3. Schema 变更需要同步更新类型定义
 *   4. 不处理具体的数据存储
 *
 * 命名规范:
 *   - Schema value（Zod 对象）: 直接导出原名，如 AppConfigSchema
 *   - 推断类型: 统一使用 Type 后缀，如 AppConfigType
 */

// ─── Config ──────────────────────────────────────────────────

export {
  AppConfigSchema,
  McpServerConfig,
  McpConfigFileSchema,
  ProxyConfig,
  RequestMethod,
  SingleProviderConfig,
  /** 内部配置中间类型，供 config loader 使用 */
  McpOAuthConfig,
  ThinkingConfig,
  RequestThinkingConfig,
  PromptCachingConfig,
} from "./config";

export type {
  AppConfigSchema as AppConfigType,
  McpServerConfig as McpServerConfigType,
  McpConfigFileSchema as McpConfigFileType,
  ProxyConfig as ProxyConfigType,
  RequestMethod as RequestMethodType,
  SingleProviderConfig as SingleProviderConfigType,
  McpOAuthConfig as McpOAuthConfigType,
  McpServerEntry as McpServerEntryType,
  ThinkingConfig as ThinkingConfigType,
  RequestThinkingConfig as RequestThinkingConfigType,
  PromptCachingConfig as PromptCachingConfigType,
  ConfigAgentEntry as ConfigAgentEntryType,
} from "./config";

// ─── Tool ──────────────────────────────────────────────────

export { ToolParameter, ToolDefinition, ToolCallInput, ToolResult } from "./tool";

export type {
  ToolParameter as ToolParameterType,
  ToolDefinition as ToolDefinitionType,
  ToolCallInput as ToolCallInputType,
  ToolResult as ToolResultType,
} from "./tool";

// ─── Ids ──────────────────────────────────────────────────

export { SessionID, MessageID, PartID, ToolCallID, BrandedId } from "./ids";

// ─── Permission ──────────────────────────────────────────

export { PermissionAction, PermissionRule, PermissionRuleset, PermissionDecision } from "./permission";

export type {
  PermissionAction as PermissionActionType,
  PermissionRule as PermissionRuleType,
  PermissionRuleset as PermissionRulesetType,
  PermissionDecision as PermissionDecisionType,
} from "./permission";

// ─── Session ──────────────────────────────────────────

export { MessageRole, PartType, MessagePart, Message, SessionStatus, Session, SessionListItem } from "./session";

export type {
  MessageRole as MessageRoleType,
  PartType as PartTypeType,
  MessagePart as MessagePartType,
  Message as MessageType,
  SessionStatus as SessionStatusType,
  Session as SessionType,
  SessionListItem as SessionListItemType,
} from "./session";

// ─── API ──────────────────────────────────────────────────
// 仅保留 ApiProvider 枚举。
// 其余 API 类型（ApiConfig/AiMessage/ApiRequest/ApiResponse）已移除，
// 项目全面使用 Vercel AI SDK (@ai-sdk/*, ai) 的原生类型。

export { ApiProvider } from "./api";

export type { ApiProvider as ApiProviderType } from "./api";

// ─── Agent ──────────────────────────────────────────

export { AgentMode, AgentName, AgentModel, AgentDefinition } from "./agent";

export type {
  AgentMode as AgentModeType,
  AgentModel as AgentModelType,
  AgentDefinition as AgentDefinitionType,
} from "./agent";

// ─── Chat ───────────────────────────────────────────
// 跨模块共享的对话域类型（UI / Session / Agent 三方共用）

export type {
  ThinkingPart,
  TextPart,
  ToolPart,
  ToolStatus,
  ChatMessagePart,
  ChatMessage,
  ChatRuntimeOverrides,
  ChatContextValue,
  ChatProviderProps,
} from "./chat";

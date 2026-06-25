/**
 * @config 统一类型出入口。
 *
 * 集中导出 @config 模块的所有公开类型，供外部模块通过 `@config/type` 或
 * `@config`（通过 index.ts 重导出）导入。
 */

// ─── 加载层类型 ──────────────────────────────────────────
export type { ConfigLoader } from "./loader/config";
export type { ConfigVersion, AtomicUpdateOptions } from "./loader/atomicConfig";
export type { ConfigSource, ConfigSourceInfo } from "./loader/configSources";

// ─── 路径类型 ────────────────────────────────────────────
export type { SSHConfig, WorkingDirectory, WorkingDirConfig } from "./paths/workingDir";

// ─── 设置类型 ────────────────────────────────────────────
export type { UnifiedSettings, PersistentSettingsScope, SettingsScope } from "./settings/unifiedSettings";
export type { ProjectSettings } from "./settings/projectSettings";
export type { ProfileInfo } from "./settings/profileManager";

// ─── Agent 类型 ──────────────────────────────────────────
export type { SubAgent, SubAgentsConfig } from "./agents/subAgentConfig";
export type { AgentConfig } from "./agents/agentLoader";

// ─── 主题类型 ────────────────────────────────────────────
export type {
  ThemeMode,
  ThemeColors,
  DiffColors,
  MarkdownColors,
  BackgroundColors,
  BorderColors,
  ExtendedThemeColors,
  ThemeExtendedOverrides,
} from "./types/themeTypes";

// ─── 特性类型 ────────────────────────────────────────────
export type { ProxyInfo } from "./features/proxyConfig";
export type { MCPConfigScope } from "./features/disabledMcpTools";
export type { ProviderMeta } from "./features/apiConfig";
export type {
  HookActionType,
  HookAction,
  HookRule,
  HookConfig,
  OnUserMessageContext,
  BeforeToolCallContext,
  AfterToolCallContext,
  ToolConfirmationContext,
  OnSubAgentCompleteContext,
  BeforeCompressContext,
  OnSessionStartContext,
  OnStopContext,
  ConfigHookKey,
  HookScope,
} from "./features/hooksConfig";

// ─── Schema 类型 ─────────────────────────────────────────
export type { ConfigValueType, ValidationRule, FieldSchema, ConfigSchema, ValidationResult } from "./types/schema";

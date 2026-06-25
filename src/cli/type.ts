/**
 * CLI 类型 — 模块类型统一出入口。
 *
 * 所有外部模块应通过 `@cli/type` 引入 CLI 模块的类型定义。
 * 值导出请使用 `@cli`（index.ts）。
 */
import type { EventBus } from "@/bus";
import type { SseReadiness } from "@/server/sseModes";

export type CliMode =
  | "setup"
  | "config-test"
  | "config-export"
  | "config-import"
  | "mcp-search"
  | "mcp-install"
  | "agent-generate"
  | "tui"
  | "headless"
  | "sse"
  | "sse-daemon"
  | "sse-stop"
  | "sse-status"
  | "acp"
  | "task"
  | "task-worker"
  | "task-list"
  | "task-status"
  | "check-update"
  | "update"
  | "schedule"
  | "help"
  | "version";

export interface ParsedCliArgs {
  mode: CliMode;
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
  ssePort?: number;
  sseAll: boolean;
}

// ─── 依赖注入接口拆分（遵循接口隔离原则）──────────────

/**
 * 数据库相关依赖
 */
export interface DbDeps {
  initDb: () => void;
  closeDb: () => void;
}

/**
 * CLI 渲染器最小接口（解耦 @opentui/core 具体类型）
 */
export interface ICliRenderer {
  waitForThemeMode(timeout: number): Promise<string | undefined>;
  setTerminalTitle(title: string): void;
  once(event: string, callback: () => void): void;
  destroy(): void;
}

/**
 * 应用配置接口（解耦 @/schema/config 具体类型）
 * CLI 模块仅依赖此处的最小形状，不直接导入 schema。
 */
export interface CliAppConfig {
  theme?: string;
  defaultProvider: { provider: string; model: string };
  telemetry?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * UI 渲染相关依赖
 */
export interface UiDeps {
  createTuiApp: (renderer: ICliRenderer, mode: string, config: CliAppConfig) => Promise<void>;
  createCliRenderer: (options: Record<string, unknown>) => Promise<ICliRenderer>;
}

/**
 * 进程管理相关依赖
 */
export interface ProcessDeps {
  spawnProcess: typeof Bun.spawn;
  instanceLock: {
    lock: (id: string) => boolean;
    cleanupStaleLocks: () => void;
    unlock: (id: string) => void;
  };
  createInstanceId: () => string;
}

/**
 * 配置加载相关依赖
 */
export interface ConfigDeps {
  loadConfig: () => Promise<CliAppConfig>;
  setupGoalToolVisibility: () => void;
}

/**
 * 任务运行时相关依赖
 */
export interface TaskDeps {
  initTaskRuntime: (
    projectDir: string,
    managers?: Record<string, unknown>,
    options?: { skipTaskLoad?: boolean; config?: CliAppConfig },
  ) => void;
}

/**
 * 监控相关依赖
 */
export interface MonitorDeps {
  startResourceMonitor: (intervalMs: number) => () => void;
}

/**
 * MCP 运行时相关依赖
 */
export interface McpDeps {
  ensureMcpRuntimeStarted: () => Promise<unknown>;
}

/**
 * 清理相关依赖
 */
export interface CleanupDeps {
  registerCleanup: (fn: () => void) => void;
  runCleanup: (timeoutMs?: number) => Promise<boolean>;
}

/**
 * SSE 相关依赖
 */
export interface SseDeps {
  waitForSseServerReady: (pid: number, port?: number) => Promise<SseReadiness>;
}

/**
 * 事件总线相关依赖
 */
export interface EventBusDeps {
  eventBus: EventBus;
  installGlobalProcessHandlers: (bus: EventBus) => void;
}

/**
 * 组合接口 - 保持向后兼容
 * 所有子接口的并集
 */
export interface CliOrchestratorDeps
  extends DbDeps, UiDeps, ProcessDeps, ConfigDeps, TaskDeps, MonitorDeps, McpDeps, CleanupDeps, SseDeps, EventBusDeps {}

// ─── 错误处理类型 ──────────────────────────────────────
export type { CliErrorKind, CliErrorOptions } from "./errors";

// ─── 核心编排类型 ──────────────────────────────────────
export type { TuiRunOptions } from "./core/tuiRunner";

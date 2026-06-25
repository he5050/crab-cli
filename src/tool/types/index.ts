/**
 * Tool 模块类型统一出口（唯一定义文件）
 *
 * 所有对外公开的类型/接口/值均在此文件定义或 re-export。
 * 内部子模块统一从此文件 import。
 * 外部消费者通过 @/tool/types 或 @/tool 导入。
 *
 * 使用方式:
 *   import type { ToolDefinition, ToolContext } from "@/tool/types"
 *   import { defineTool, ToolTimeoutError } from "@/tool/types"
 */

import type { z } from "zod";

// ─── 核心接口定义 ───────────────────────────────────────

/**
 * 工具执行上下文。
 *
 * 在工具执行时注入运行时信息，提供与系统交互的能力。
 * Phase 05 新增:为工具提供 session/message 关联、中止信号、元数据上报和权限询问。
 * Phase 10 新增:askUser、spawnSubagent、spawnTeammate 等协作回调。
 */
/** ToolContext */
export interface ToolContext {
  /** 当前会话 ID */
  sessionId: string;
  /** 当前消息 ID */
  messageId: string;
  /** 外部中止信号(用户取消、超时等) */
  abortSignal?: AbortSignal;
  /** 上报工具执行的元数据(标题、进度等)，供 TUI 展示 */
  metadata?: (title: string, meta?: Record<string, unknown>) => void;
  /** 在工具内部请求额外权限(交互式工具可用) */
  ask?: (permission: string, patterns: string[]) => Promise<void>;

  // ── Phase 10: 交互与协作回调 ──────────────────────────────────

  /** 向用户提问并等待回答(ask-user 工具) */
  askUser?: (params: {
    question: string;
    options?: { label: string; value: string; description?: string }[];
    multiSelect?: boolean;
    defaultValue?: string;
    allowFreeInput?: boolean;
    placeholder?: string;
    steps?: {
      id?: string;
      title: string;
      question: string;
      options?: { label: string; value: string; description?: string }[];
      multiSelect?: boolean;
      defaultValue?: string;
      allowFreeInput?: boolean;
      placeholder?: string;
    }[];
  }) => Promise<string | string[]>;

  /** 创建子代理(subagent 工具) */
  spawnSubagent?: (params: {
    agentId: string;
    agentName?: string;
    name: string;
    prompt: string;
    model?: string;
    allowedTools: string[];
    maxTurns: number;
  }) => void;

  /** 查询子代理状态(subagent 工具) */
  getSubagentStatus?: (agentId: string) => Record<string, unknown> | null;

  /** 停止子代理(subagent 工具) */
  stopSubagent?: (agentId: string) => void;

  /** 列出所有子代理(subagent 工具) */
  listSubagents?: () => Record<string, unknown>[];

  /** 创建队友代理(team 工具) */
  spawnTeammate?: (params: {
    teammateId: string;
    name: string;
    role: string;
    allowedTools: string[];
    model?: string;
  }) => void;

  /** 列出所有队友(team 工具) */
  listTeammates?: () => Record<string, unknown>[];
}

/**
 * 权限检查所需的工具信息子集。
 * 仅包含权限决策所需的字段，避免下游对完整 ToolDefinition 的耦合。
 */
/** ToolPermissionInfo */
export interface ToolPermissionInfo {
  name: string;
  permission: string;
}

/**
 * 工具搜索/匹配所需的工具信息子集。
 * 仅包含描述/检索所需的字段。
 */
/** ToolSearchInfo */
export interface ToolSearchInfo {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny;
  permission?: string;
}

/**
 * 工具定义接口。
 *
 * 所有工具(内置工具和 MCP 工具)都遵循此接口。
 * 泛型 T 约束为 ZodRawShape，确保 parameters 是 Zod 对象 schema。
 */
/** ToolDefinition */
export interface ToolDefinition<T extends z.ZodRawShape = z.ZodRawShape> {
  /** 工具唯一标识名 */
  name: string;
  /** 工具描述(发送给 AI 模型) */
  description: string;
  /** 参数 Schema */
  parameters: z.ZodObject<T>;
  /** 权限标识(如 "fs.read"、"bash")，用于权限规则匹配 */
  permission: string;
  /**
   * 是否为内置工具。
   *
   * 内置工具在注册时自动提取名称前缀到 BUILTIN_TOOL_PREFIXES，
   * 用于 toolNameMatcher 判断工具是内置还是外部(MCP)。
   * MCP/插件工具不设置此字段（默认 undefined），由运行时注册。
   */
  builtin?: true;
  /**
   * 工具执行函数。
   *
   * 接收经过 Zod 验证的参数和运行时上下文。
   * 旧工具不使用 context 参数也能正常工作(向后兼容)。
   */
  execute: (args: z.infer<z.ZodObject<T>>, context?: ToolContext) => Promise<unknown>;
  /**
   * 可选:工具执行超时(毫秒)。
   *
   * 语义:工具 `execute` 允许运行的最大 wall-clock 时长。
   * - 正整数:超过该值后将拒绝 `execute` 返回的 Promise，并抛出 `ToolTimeoutError`。
   * - 未定义 / `<= 0`:不施加 per-tool 超时(`ToolContext.abortSignal` 仍生效)。
   *
   * 默认值:未设置时由 `ToolExecutor` 的全局超时(`defaultTimeout`)兜底。
   */
  timeoutMs?: number;
}

/**
 * 工具超时错误。
 *
 * 当工具声明的 `timeoutMs` 用尽时，由 `ToolExecutor` 抛出。
 * 携带 `code: "TOOL_TIMEOUT"` 便于调用方通过 `err.code` 做结构化判断。
 */
/** ToolTimeoutError */
export class ToolTimeoutError extends Error {
  public readonly code = "TOOL_TIMEOUT";
  public readonly toolName: string;
  public readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number, message?: string) {
    super(message ?? `Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * 定义工具的工厂函数。
 * 类型安全的工具定义包装器，直接返回传入的定义对象。
 *
 * @example
 * const readTool = defineTool({
 *   name: "fs_read",
 *   description: "读取文件内容",
 *   parameters: z.object({ path: z.string() }),
 *   permission: "fs.read",
 *   execute: async (args, ctx) => {
 *     ctx?.metadata?.("读取文件", { path: args.path });
 *     return await Bun.file(args.path).text();
 *   },
 * });
 */
/** defineTool 的实现 */
export function defineTool<T extends z.ZodRawShape>(tool: ToolDefinition<T>): ToolDefinition<T> {
  return tool;
}

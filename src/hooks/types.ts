/**
 * Hooks 类型定义 — 13 种 Hook 事件和核心接口。
 *
 * 职责:
 *   - 定义 Hook 事件类型
 *   - 定义 Hook 类型和上下文
 *   - 定义 Hook 决策类型
 *   - 定义 Hook 定义和执行结果接口
 *
 * 模块功能:
 *   - HookEvent: Hook 事件类型(13 种)
 *   - HookType: Hook 类型(shell/builtin/prompt)
 *   - HookContext: Hook 执行上下文
 *   - HookDecision: Hook 决策类型
 *   - HookDefinition: Hook 定义接口
 *   - HookResult: Hook 执行结果接口
 *
 * 使用场景:
 *   - 定义 Hook 配置
 *   - 执行 Hook 时传递上下文
 *   - 处理 Hook 执行结果
 *   - 注册和管理 Hook
 *
 * 边界:
 *   1. 仅类型定义，不包含实现
 *   2. 支持 13 种 Hook 事件
 *   3. 支持 shell 和 builtin 两种类型
 *   4. 决策支持 pass/block/replace/inject
 *
 * 流程:
 *   1. 定义 Hook 事件枚举
 *   2. 定义 Hook 上下文结构
 *   3. 定义 Hook 决策类型
 *   4. 定义 Hook 定义接口
 *   5. 定义 Hook 执行结果
 */

/** Hook 事件类型 */
export type HookEvent =
  | "PreToolUse" // 工具调用前(可阻止)
  | "PostToolUse" // 工具调用后(可修改结果)
  | "UserMessage" // 用户发送消息时
  | "ToolConfirmation" // 工具权限确认时
  | "Compress" // 上下文压缩前后
  | "Notification" // 通知事件
  | "Stop" // 对话停止
  | "SubAgentStart" // 子代理启动
  | "SubAgentStop" // 子代理停止
  | "SessionStart" // 会话开始
  | "SessionEnd" // 会话结束
  | "SkillExecute" // Skill 执行前后
  | "OnError"; // 错误发生时(工具执行错误、API 错误等)

/** Hook 类型 */
export type HookType = "shell" | "builtin" | "prompt";

/** Hook 执行上下文 */
export interface HookContext {
  /** 触发的事件 */
  event: HookEvent;
  /** 工具名(PreToolUse/PostToolUse 时有值) */
  toolName?: string;
  /** 工具参数 */
  toolArgs?: unknown;
  /** 工具结果(PostToolUse 时有值) */
  toolResult?: unknown;
  /** 工具调用 ID */
  toolCallId?: string;
  /** 是否是错误结果 */
  isError?: boolean;
  /** 会话 ID */
  sessionId?: string;
  /** 子代理 ID */
  agentId?: string;
  /** 子代理名称 */
  agentName?: string;
  /** 附加数据 */
  [key: string]: unknown;
}

/** Hook 决策 */
export type HookDecision =
  | { action: "pass" } // 放行
  | { action: "block"; reason?: string } // 阻止执行
  | { action: "replace"; output: unknown } // 替换结果
  | { action: "inject"; message: string; shouldContinueConversation?: boolean }; // 注入消息(子代理用)

/** Hook 定义 */
export interface HookDefinition {
  /** 唯一 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 绑定的事件 */
  event: HookEvent;
  /** Hook 类型 */
  type: HookType;
  /** Shell 命令(type=shell 时) */
  command?: string;
  /** 内置 Hook 处理函数(type=builtin 时) */
  handler?: (ctx: HookContext) => Promise<HookDecision>;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级(数字越小越先执行，默认 100) */
  priority: number;
  /** 条件过滤 */
  condition?: {
    /** 仅匹配特定工具 */
    toolName?: string | string[];
    /** 仅匹配特定退出码(PostToolUse) */
    exitCode?: number;
  };
  /** 超时时间(毫秒，默认 30000) */
  timeout?: number;
  /** 描述 */
  description?: string;
}

/** Hook 执行结果（完整，带 decision） */
export interface HookResult {
  /** Hook ID */
  hookId: string;
  /** Hook 名称 */
  hookName: string;
  /** 触发事件 */
  event: HookEvent;
  /** 执行决策 */
  decision: HookDecision;
  /** 是否成功执行 */
  success: boolean;
  /** Stdout/stderr 输出 */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 执行时长(毫秒) */
  duration: number;
}

/** Command Hook 执行结果（轻量，来自 UnifiedHooksExecutor） */
export interface CommandHookResult {
  type: "command";
  success: boolean;
  command: string;
  exitCode: number;
  output?: string;
  error?: string;
}

/** Prompt Hook 执行结果（轻量，来自 UnifiedHooksExecutor） */
export interface PromptHookResult {
  type: "prompt";
  success: boolean;
  response?: PromptHookResponse;
  error?: string;
}

/** Prompt Hook 响应格式 */
export interface PromptHookResponse {
  ask: "user" | "ai";
  message: string;
  continue: boolean;
}

/** 单个 Action 执行结果（轻量，Command 或 Prompt） */
export type HookActionResult = CommandHookResult | PromptHookResult;

/**
 * 统一 Hook 结果类型 — 同时支持完整 HookResult 和轻量 HookActionResult。
 * interpretHookResult 和 HookStrategy 使用此联合类型。
 */
export type AnyHookResult = HookResult | HookActionResult;

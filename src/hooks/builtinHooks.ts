/**
 * [内置 Hook]
 *
 * 职责:
 *   - 提供常用 Hook 的内置实现
 *   - 安全检查(敏感操作拦截)
 *   - 日志记录(工具调用记录)
 *   - 会话事件记录(开始/结束)
 *
 * 模块功能:
 *   - logHook: 工具调用日志 Hook
 *   - securityHook: 安全检查 Hook(阻止危险操作)
 *   - sessionStartHook: 会话开始日志 Hook
 *   - sessionEndHook: 会话结束日志 Hook
 *   - builtinHooks: 所有内置 Hook 数组
 *   - registerBuiltinHooks: 注册所有内置 Hook
 *
 * 使用场景:
 *   - 需要开箱即用的 Hook 功能
 *   - 安全检查防止危险操作
 *   - 记录工具调用和会话事件
 *   - 作为自定义 Hook 的参考实现
 *
 * 边界:
 *   1. 仅提供基础功能，复杂需求需自定义
 *   2. 安全检查基于正则表达式匹配
 *   3. 日志 Hook 默认禁用，需手动启用
 *   4. 会话 Hook 默认启用
 *
 * 流程:
 *   1. 定义内置 Hook 对象(id, name, event, handler 等)
 *   2. 导出 builtinHooks 数组
 *   3. 调用 registerBuiltinHooks 注册到 HookRegistry
 *   4. 根据配置启用/禁用特定 Hook
 */
import type { HookContext, HookDecision, HookDefinition } from "@/hooks/types";
import { createLogger } from "@/core/logging/logger";

const log = createLogger("hooks:builtin");

/**
 * 内置 Hook:日志记录。
 * 记录所有工具调用到日志。
 */
const logHook: HookDefinition = {
  description: "记录所有工具调用到日志",
  enabled: false,
  event: "PostToolUse",
  handler: async (ctx: HookContext): Promise<HookDecision> => {
    const toolName = ctx.toolName ?? "unknown";
    const isError = ctx.isError ? " [ERROR]" : "";
    log.info(`[Hook:日志] ${ctx.event}: ${toolName}${isError}`);
    return { action: "pass" };
  },
  id: "builtin.log-tool-calls",
  name: "工具调用日志",
  priority: 200,
  type: "builtin",
};

/**
 * 内置 Hook:安全检查。
 * 阻止对危险路径的写操作。
 */
const securityHook: HookDefinition = {
  condition: {
    toolName: ["filesystem-write", "filesystem-edit", "terminal-execute"],
  },
  description: "阻止对危险路径的写操作",
  enabled: false,
  event: "PreToolUse",
  handler: async (ctx: HookContext): Promise<HookDecision> => {
    const args = ctx.toolArgs as Record<string, unknown> | undefined;
    if (!args) {
      return { action: "pass" };
    }

    // 检查危险路径模式
    const dangerousPatterns = [/\/etc\/passwd/, /\/etc\/shadow/, /\/\.ssh\//, /\/\.gnupg\//, /\.env$/, /rm\s+-rf\s+\//];

    const path = (args.path ?? args.filePath ?? "") as string;
    const command = (args.command ?? "") as string;
    const checkTarget = `${path} ${command}`.trim();

    for (const pattern of dangerousPatterns) {
      if (pattern.test(checkTarget)) {
        log.warn(`[Hook:安全] 阻止危险操作: ${checkTarget}`);
        return { action: "block", reason: `安全检查:检测到危险操作模式` };
      }
    }

    return { action: "pass" };
  },
  id: "builtin.security-check",
  name: "安全检查",
  priority: 10,
  type: "builtin",
};

/**
 * 内置 Hook:会话开始日志。
 */
const sessionStartHook: HookDefinition = {
  description: "记录会话开始事件",
  enabled: true,
  event: "SessionStart",
  handler: async (ctx: HookContext): Promise<HookDecision> => {
    log.info(`[Hook:会话] 会话开始: ${ctx.sessionId ?? "unknown"}`);
    return { action: "pass" };
  },
  id: "builtin.session-start-log",
  name: "会话开始日志",
  priority: 100,
  type: "builtin",
};

/**
 * 内置 Hook:会话结束日志。
 */
const sessionEndHook: HookDefinition = {
  description: "记录会话结束事件",
  enabled: true,
  event: "SessionEnd",
  handler: async (ctx: HookContext): Promise<HookDecision> => {
    log.info(`[Hook:会话] 会话结束: ${ctx.sessionId ?? "unknown"}`);

    // 自动提取记忆
    try {
      const { extractAndSaveMemory } = await import("@/session/memory");
      const { getSessionMessages, extractPlainText } = await import("@/session");
      if (ctx.sessionId) {
        const messages = getSessionMessages(ctx.sessionId);
        const texts = messages.map((msg) => extractPlainText(msg.parts));
        if (texts.length > 0) {
          const extracted = extractAndSaveMemory(texts, ctx.sessionId);
          if (extracted.length > 0) {
            log.info(`[Hook:记忆] 自动提取了 ${extracted.length} 条记忆`);
          }
        }
      }
    } catch (error) {
      log.warn(`[Hook:记忆] 自动记忆提取失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { action: "pass" };
  },
  id: "builtin.session-end-log",
  name: "会话结束日志",
  priority: 100,
  type: "builtin",
};

/** 所有内置 Hook 定义 */
export const builtinHooks: HookDefinition[] = [logHook, securityHook, sessionStartHook, sessionEndHook];

/**
 * 注册所有内置 Hook 到注册表。
 */
export async function registerBuiltinHooks(): Promise<void> {
  const { hookRegistry } = await import("./hookRegistry");
  for (const hook of builtinHooks) {
    hookRegistry.register(hook);
  }
  log.info(`注册 ${builtinHooks.length} 个内置 Hook`);
}

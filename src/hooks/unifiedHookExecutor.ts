/**
 * [统一 Hook 执行器]
 *
 * 职责:
 *   - 按 Action 顺序依次执行 Shell/Prompt Hook
 *   - 支持项目级和全局级 Hook 配置
 *   - 提供统一的 Hook 执行接口
 *
 * 模块功能:
 *   - UnifiedHooksExecutor: 统一 Hook 执行器类
 *   - executeHooks: 执行指定事件的所有 Hooks
 *   - executeCommand: 执行 Command 类型的 Action
 *   - executePrompt: 执行 Prompt 类型的 Action(调用 AI 模型)
 *   - PromptHookResponse: Prompt Hook 响应格式
 *   - UnifiedHookExecutionResult: 统一执行结果接口
 *
 * 使用场景:
 *   - 需要执行配置文件中定义的 Hooks
 *   - 支持 Command Hook(Shell 命令)
 *   - 支持 Prompt Hook(AI 模型判断)
 *   - 按优先级和匹配条件执行 Hooks
 *
 * 边界:
 *   1. 项目级 hooks 优先，无则回退全局级
 *   2. 支持 command 和 prompt 两种 Action 类型
 *   3. 严格按配置顺序执行
 *   4. matcher 支持通配符 * 和逗号分隔
 *   5. exitCode >= 2 时停止后续 Action
 *   6. 支持占位符替换($TOOLSRESULT$, $STOPSESSION$, $SUBAGENTRESULT$)
 *
 * 流程:
 *   1. 加载项目级或全局级 Hook 配置
 *   2. 匹配规则(matcher)过滤 Hooks
 *   3. 依次执行每个 Action(Command 或 Prompt)
 *   4. 替换占位符为实际上下文数据
 *   5. 根据执行结果决定是否继续后续 Action
 *   6. 返回整体执行结果
 */

import { HOOK_EVENT_TO_CONFIG_KEY, type HookAction, type HookRule, loadHookConfigByEvent } from "@/config";
import type {
  CommandHookResult,
  HookActionResult,
  HookContext,
  HookEvent,
  PromptHookResponse,
  PromptHookResult,
} from "@/hooks/types";
// 日志由各调用方统一管理，unifiedHookExecutor 本身不直接记录

// ─── Prompt Hook 结果 ─────────────────────────────────────

// CommandHookResult、PromptHookResult、PromptHookResponse、HookActionResult
// 统一定义在 types.ts，此处通过 import 使用（P0-1: 消除重复定义）

/** 整体执行结果 */
export interface UnifiedHookExecutionResult {
  success: boolean;
  results: HookActionResult[];
  executedActions: number;
  skippedActions: number;
}

// ─── 统一 Hook 执行器 ─────────────────────────────────────

export class UnifiedHooksExecutor {
  private maxOutputLength: number;
  private defaultTimeout: number;

  constructor(maxOutputLength = 10_000, defaultTimeout = 5000) {
    this.maxOutputLength = maxOutputLength;
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * 执行指定 HookEvent 的所有 hooks。
   * 先查项目级配置，无则回退全局级。
   */
  async executeHooks(event: HookEvent, context?: HookContext): Promise<UnifiedHookExecutionResult> {
    const configKey = HOOK_EVENT_TO_CONFIG_KEY[event];
    if (!configKey) {
      return { executedActions: 0, results: [], skippedActions: 0, success: true };
    }

    // 项目级优先
    let rules = loadHookConfigByEvent(event, "project");
    if (rules.length === 0) {
      rules = loadHookConfigByEvent(event, "global");
    }

    if (rules.length === 0) {
      return { executedActions: 0, results: [], skippedActions: 0, success: true };
    }

    let totalExecuted = 0;
    let totalSkipped = 0;
    const allResults: HookActionResult[] = [];
    let hasError = false;

    for (const rule of rules) {
      if (!this.matchRule(rule, context)) {
        totalSkipped += rule.hooks.length;
        continue;
      }

      for (const action of rule.hooks) {
        if (action.enabled === false) {
          totalSkipped++;
          continue;
        }

        let result: HookActionResult | null = null;

        if (action.type === "command" && action.command) {
          result = await this.executeCommand(action, context);
        } else if (action.type === "prompt" && action.prompt) {
          result = await this.executePrompt(action, context);
        } else {
          totalSkipped++;
          continue;
        }

        totalExecuted++;
        allResults.push(result);

        if (!result.success) {
          hasError = true;
          // Command exitCode >= 2 时停止后续 Action
          if (result.type === "command" && result.exitCode >= 2) {
            break;
          }
        }
      }
    }

    return {
      executedActions: totalExecuted,
      results: allResults,
      skippedActions: totalSkipped,
      success: !hasError,
    };
  }

  // ─── Matcher ──────────────────────────────────────────

  private matchRule(rule: HookRule, context?: Record<string, unknown>): boolean {
    if (!rule.matcher || !context) {
      return true;
    }

    const matchers = rule.matcher.split(",").map((m) => m.trim());
    return matchers.some((m) => this.checkMatcher(m, context));
  }

  private checkMatcher(matcher: string, context: Record<string, unknown>): boolean {
    if (matcher.includes(":")) {
      const [key, pattern] = matcher.split(":", 2);
      const value = context[key!];
      if (value === undefined) {
        return false;
      }
      return this.matchPattern(pattern!, String(value));
    }

    if (context["toolName"] !== undefined) {
      return this.matchPattern(matcher, String(context["toolName"]));
    }

    return JSON.stringify(context).includes(matcher);
  }

  private matchPattern(pattern: string, value: string): boolean {
    const regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`).replace(/\*/g, ".*");
    return new RegExp(`^${regexStr}$`, "i").test(value);
  }

  // ─── 占位符替换 ────────────────────────────────────────

  private replacePlaceholders(text: string, context?: Record<string, unknown>): string {
    if (!context) {
      return text;
    }

    let result = text;

    // $TOOLSRESULT$ — 工具数据
    if (context["toolName"] !== undefined || context["toolArgs"] !== undefined) {
      const toolsData: Record<string, unknown> = {
        args: context["toolArgs"] ?? context["args"],
        toolName: context["toolName"],
      };
      if (context["toolResult"] !== undefined) {
        toolsData.result = context["toolResult"];
      }
      if (context["error"] !== undefined) {
        toolsData.error = context["error"];
      }

      result = result.replace(/\$TOOLSRESULT\$/g, JSON.stringify(toolsData));
    }

    // $STOPSESSION$ — 会话消息
    if (context["messages"] !== undefined) {
      result = result.replace(/\$STOPSESSION\$/g, JSON.stringify(context["messages"]));
    }

    // $SUBAGENTRESULT$ — 子代理数据
    if (context["agentId"] !== undefined || context["agentName"] !== undefined) {
      const subAgentData = {
        agentId: context["agentId"],
        agentName: context["agentName"],
        content: context["content"],
        success: context["success"],
        usage: context["usage"],
      };
      result = result.replace(/\$SUBAGENTRESULT\$/g, JSON.stringify(subAgentData));
    }

    return result;
  }

  // ─── Command 执行 ──────────────────────────────────────

  private async executeCommand(action: HookAction, context?: Record<string, unknown>): Promise<CommandHookResult> {
    const command = this.replacePlaceholders(action.command!, context);
    const timeout = action.timeout || this.defaultTimeout;
    const stdinData = context ? JSON.stringify(context) : "";

    try {
      const args = command.split(/\s+/);
      const proc = Bun.spawn(args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...(process.platform === "win32"
            ? { PYTHONIOENCODING: "utf8" }
            : { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" }),
        },
        stderr: "pipe",
        stdin: stdinData ? "pipe" : undefined,
        stdout: "pipe",
      });

      // 写入 stdin(Bun.spawn stdin: "pipe" 返回 FileSink)
      if (stdinData && proc.stdin) {
        proc.stdin.write(stdinData);
        proc.stdin.end();
      }

      // 等待完成(带超时)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => {
          proc.kill();
          reject(new Error(`ETIMEDOUT`));
        }, timeout),
      );

      const exitCode = await Promise.race([proc.exited, timeoutPromise]);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      return {
        command,
        error: stderr ? this.truncateOutput(stderr) : undefined,
        exitCode,
        output: this.truncateOutput(stdout),
        success: exitCode === 0,
        type: "command",
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);

      if (errMsg.includes("ETIMEDOUT")) {
        return {
          command,
          error: `命令超时 (${timeout}ms): ${command}`,
          exitCode: -1,
          success: false,
          type: "command",
        };
      }

      return {
        command,
        error: this.truncateOutput(errMsg),
        exitCode: 2,
        success: false,
        type: "command",
      };
    }
  }

  private truncateOutput(output: string): string {
    if (output.length <= this.maxOutputLength) {
      return output;
    }
    const half = Math.floor(this.maxOutputLength / 2);
    return `${output.slice(0, half)}\n...(输出已截断)...\n${output.slice(-half)}`;
  }

  // ─── Prompt 执行 ───────────────────────────────────────

  private async executePrompt(action: HookAction, context?: Record<string, unknown>): Promise<PromptHookResult> {
    try {
      // 延迟导入避免循环依赖
      const { config } = await import("@config");
      const { chat } = await import("@api");

      const appConfig = await config();
      const model = appConfig.smallModel || appConfig.defaultProvider.model;

      if (!model) {
        return {
          error: "未配置模型，无法执行 Prompt Hook",
          success: false,
          type: "prompt",
        };
      }

      const prompt = this.replacePlaceholders(action.prompt!, context);

      const systemPrompt = `You MUST respond with ONLY a valid JSON object. No markdown, no explanations, no additional text.

Required JSON format:
{
  "ask": "user",
  "message": "your message here",
  "continue": false
}

OR

{
  "ask": "ai",
  "message": "your message here",
  "continue": true
}

Rules:
- ask: "user" means show message to user and END conversation (continue must be false)
- ask: "ai" means send message to AI and CONTINUE conversation (continue must be true)
- Output ONLY the JSON object
- Do NOT use markdown code blocks
- Do NOT add any explanations`;

      let userMessage = prompt;
      if (context && Object.keys(context).length > 0) {
        userMessage += `\n\nContext:\n${JSON.stringify(context, null, 2)}`;
      }

      let completeContent = "";
      const stream = chat(
        appConfig,
        [
          {
            content: `${systemPrompt}\n\n${userMessage}\n\nRemember: Respond with ONLY JSON, no markdown, no explanations.`,
            role: "user",
          },
        ],
        { maxTokens: 500 },
      );

      for await (const chunk of stream) {
        if (chunk.type === "error") {
          const errMsg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
          return { error: errMsg, success: false, type: "prompt" };
        }
        if (chunk.type === "text-delta" && chunk.text) {
          completeContent += chunk.text;
        }
      }

      if (!completeContent.trim()) {
        return { error: "模型返回空响应", success: false, type: "prompt" };
      }

      const parsed = this.parseJsonResponse(completeContent);
      if (!parsed) {
        return {
          error: `JSON 解析失败: ${completeContent.slice(0, 200)}`,
          success: false,
          type: "prompt",
        };
      }

      // 验证格式
      if (!parsed.ask || !parsed.message || parsed.continue === undefined) {
        return {
          error: "响应缺少必要字段 (ask, message, continue)",
          success: false,
          type: "prompt",
        };
      }

      if ((parsed.ask === "ai" && !parsed.continue) || (parsed.ask === "user" && parsed.continue)) {
        return {
          error: `逻辑不一致: ask="${parsed.ask}" 但 continue=${parsed.continue}`,
          success: false,
          type: "prompt",
        };
      }

      return { response: parsed, success: true, type: "prompt" };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return { error: errMsg, success: false, type: "prompt" };
    }
  }

  private parseJsonResponse(response: string): PromptHookResponse | null {
    try {
      let cleaned = response.trim();

      // 移除 markdown 代码块
      const codeBlockMatch = cleaned.match(/```(?:json)?[\s\n]*([\s\S]*?)```/);
      if (codeBlockMatch) {
        cleaned = codeBlockMatch[1]!.trim();
      }

      return JSON.parse(cleaned) as PromptHookResponse;
    } catch {
      return null;
    }
  }
}

/** 默认单例 */
export const unifiedHooksExecutor = new UnifiedHooksExecutor();

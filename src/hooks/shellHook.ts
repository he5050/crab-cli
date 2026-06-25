/**
 * [Shell Hook 执行器]
 *
 * 职责:
 *   - 将 HookContext 序列化为环境变量
 *   - 执行 Shell 命令并收集输出
 *   - 解析 Hook 决策(pass/block/replace)
 *   - 支持超时控制
 *
 * 模块功能:
 *   - executeShellHook: 执行 Shell 命令 Hook
 *   - parseShellOutput: 解析 Shell 输出为 HookDecision
 *   - ShellHookOutput: Shell Hook 输出格式接口
 *
 * 使用场景:
 *   - 需要执行外部 Shell 脚本作为 Hook
 *   - 通过环境变量传递上下文信息
 *   - 通过 stdin 传递工具参数和结果
 *   - 通过 stdout JSON 返回决策
 *
 * 边界:
 *   1. 仅支持 Shell 类型的 Hook
 *   2. 通过环境变量传递上下文(CRAB_HOOK_EVENT, CRAB_TOOL_NAME 等)
 *   3. 通过 stdin 传递 JSON 格式的上下文
 *   4. 通过 stdout 返回 JSON 格式的决策
 *   5. 支持超时控制，超时后自动终止进程
 *
 * 流程:
 *   1. 构建环境变量(CRAB_* 系列)
 *   2. 将上下文序列化为 stdin JSON
 *   3. 使用 Bun.spawn 执行 Shell 命令
 *   4. 等待进程完成或超时
 *   5. 解析 stdout 为 HookDecision
 *   6. 返回决策和输出
 */
import { createLogger } from "@/core/logging/logger";
import type { HookContext, HookDecision, HookDefinition } from "@/hooks/types";

const log = createLogger("hooks:shell");

/** Shell Hook 输出决策格式 */
interface ShellHookOutput {
  /** 决策:pass / block / replace */
  decision?: "pass" | "block" | "replace";
  /** 阻止原因 */
  reason?: string;
  /** 替换输出 */
  output?: unknown;
}

/**
 * 执行 Shell 命令 Hook。
 *
 * Hook 脚本通过以下方式与 crab-cli 通信:
 *   1. 环境变量:CRAB_HOOK_EVENT, CRAB_TOOL_NAME, CRAB_SESSION_ID 等
 *   2. stdout JSON:输出决策
 *      - {"decision":"pass"} — 放行
 *      - {"decision":"block","reason":"..."} — 阻止
 *      - {"decision":"replace","output":{...}} — 替换结果
 *   3. 退出码:0=成功，非0=失败
 */
export async function executeShellHook(
  hook: HookDefinition,
  context: HookContext,
  timeout?: number,
): Promise<{ decision: HookDecision; output: string; error?: string }> {
  const timeoutMs = timeout ?? hook.timeout ?? 30_000;

  // 构建环境变量
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CRAB_HOOK_EVENT: context.event,
    CRAB_HOOK_NAME: hook.name,
  };

  if (context.toolName) {
    env.CRAB_TOOL_NAME = context.toolName;
  }
  if (context.sessionId) {
    env.CRAB_SESSION_ID = context.sessionId;
  }
  if (context.toolCallId) {
    env.CRAB_TOOL_CALL_ID = context.toolCallId;
  }
  if (context.agentId) {
    env.CRAB_AGENT_ID = context.agentId;
  }
  if (context.agentName) {
    env.CRAB_AGENT_NAME = context.agentName;
  }
  if (context.isError !== undefined) {
    env.CRAB_IS_ERROR = String(context.isError);
  }

  // 工具参数通过 stdin JSON 传递
  const stdinData = JSON.stringify({
    event: context.event,
    sessionId: context.sessionId,
    toolArgs: context.toolArgs,
    toolName: context.toolName,
    toolResult: context.toolResult,
  });

  const startTime = Date.now();

  try {
    const proc = Bun.spawn(hook.command!.split(/\s+/), {
      env,
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });

    // 写入 stdin(Bun.spawn stdin: "pipe" 返回 WritableStream)
    if (proc.stdin) {
      proc.stdin.write(new TextEncoder().encode(stdinData));
      proc.stdin.end();
    }

    // 超时控制
    const timeoutPromise = new Promise<{ decision: HookDecision; output: string; error: string }>((resolve) => {
      setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({
          decision: { action: "pass" },
          error: `Hook 执行超时 (${timeoutMs}ms)`,
          output: "",
        });
      }, timeoutMs);
    });

    // 等待执行完成
    const exitCode = await Promise.race([proc.exited, timeoutPromise]);

    if (typeof exitCode === "object") {
      // 超时了
      return exitCode;
    }

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const duration = Date.now() - startTime;

    if (exitCode !== 0) {
      log.warn(`Shell Hook 失败: ${hook.name} (exit=${exitCode}, ${duration}ms)`, { stderr: stderr.slice(0, 200) });
      return {
        decision: { action: "pass" },
        error: stderr || `Hook 退出码 ${exitCode}`,
        output: stdout,
      };
    }

    // 解析决策
    const decision = parseShellOutput(stdout);
    log.debug(`Shell Hook 完成: ${hook.name} (${duration}ms) → ${decision.action}`);

    return { decision, output: stdout };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`Shell Hook 异常: ${hook.name}: ${msg}`);
    return {
      decision: { action: "pass" },
      error: msg,
      output: "",
    };
  }
}

/**
 * 解析 Shell Hook 的 stdout 输出为 HookDecision。
 */
function parseShellOutput(stdout: string): HookDecision {
  if (!stdout.trim()) {
    return { action: "pass" };
  }

  try {
    const parsed: ShellHookOutput = JSON.parse(stdout.trim());

    switch (parsed.decision) {
      case "block": {
        return { action: "block", reason: parsed.reason };
      }
      case "replace": {
        return { action: "replace", output: parsed.output };
      }
      case "pass":
      default: {
        return { action: "pass" };
      }
    }
  } catch {
    // 非 JSON 输出，默认放行
    return { action: "pass" };
  }
}

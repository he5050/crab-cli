/**
 * Headless 模块
 *
 * 职责:
 *   - 接收用户 prompt 输入
 *   - 创建 ConversationHandler 处理对话
 *   - 流式输出 AI 响应到 stdout
 *   - 支持后台任务模式运行
 *
 * 模块功能:
 *   - HeadlessRunner: 无头模式运行器类
 *   - HeadlessOptions: 无头模式选项类型
 *   - run(): 执行无头对话
 *   - YOLO 模式支持(自动执行不确认)
 *   - 后台任务集成
 *
 * 使用场景:
 *   - 命令行非交互式执行
 *   - CI/CD 自动化任务
 *   - 后台异步任务处理
 *   - 脚本集成调用
 *
 * 边界:
 *   1. 不创建 OpenTUI 渲染器，直接输出到 stdout
 *   2. 不支持交互式用户输入
 *   3. 依赖全局事件总线进行流式输出
 *   4. 需要预先加载配置和启动 MCP Runtime
 *
 * 流程:
 *   1. 加载配置并初始化任务运行时
 *   2. 启动 MCP Runtime
 *   3. 创建 ConversationHandler 实例
 *   4. 订阅对话事件(token、toolCall、toolResult)
 *   5. 发送消息并等待响应
 *   6. 清理资源并退出
 */
import { createLogger } from "@/core/logging/logger";
import { createAgentError } from "@/core/errors/appError";
import { loadConfig } from "@/config";
import { ConversationHandler } from "@/conversation";
import { ensureMcpRuntimeStarted } from "@/mcp/manager/runtime";
import { initTaskRuntime } from "@/mission";
import { completeTask } from "@/server/taskRunner";
import { submitExternalPermissionRequest } from "@/permission";
import { cleanIncompleteToolCalls, ensureSession, getSessionMessages, messageRecordsToModelMessages } from "@/session";
import { getActiveAgent } from "@/agent";
import { buildChatRuntimeOverrides } from "@/agent/prompt/runtimeOverrides";
import { closeDb, initDb } from "@/db";
import { VERSION } from "@/config/version";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent, runCleanup } from "@/bus";
import type { ApprovalAction, PermissionAskInput } from "@/permission";
import { createServerError, toServerLogPayload } from "@/server/errors";
const log = createLogger("headless");

type HeadlessErrorReason = "non_interactive_permission" | "policy_denied" | "user_rejected";

interface HeadlessErrorHint {
  reason: HeadlessErrorReason;
  suggestion: string;
}

type HeadlessConversationHandler = InstanceType<typeof ConversationHandler>;
type HeadlessConversationHandlerCtor = new (
  config: Awaited<ReturnType<typeof loadConfig>>,
  options: ConstructorParameters<typeof ConversationHandler>[1],
) => HeadlessConversationHandler;

const headlessDeps = {
  ConversationHandler: ConversationHandler as HeadlessConversationHandlerCtor,
  cleanIncompleteToolCalls,
  completeTask,
  ensureMcpRuntimeStarted,
  ensureSession,
  getSessionMessages,
  initTaskRuntime,
  loadConfig,
  submitExternalPermissionRequest,
  writeStderr: (text: string) => process.stderr.write(text),
  writeStdout: (text: string) => process.stdout.write(text),
};

export function __setHeadlessDepsForTesting(overrides: Partial<typeof headlessDeps>): void {
  Object.assign(headlessDeps, overrides);
}

export function __resetHeadlessDepsForTesting(): void {
  headlessDeps.loadConfig = loadConfig;
  headlessDeps.ensureMcpRuntimeStarted = ensureMcpRuntimeStarted;
  headlessDeps.ConversationHandler = ConversationHandler as HeadlessConversationHandlerCtor;
  headlessDeps.initTaskRuntime = initTaskRuntime;
  headlessDeps.completeTask = completeTask;
  headlessDeps.ensureSession = ensureSession;
  headlessDeps.getSessionMessages = getSessionMessages;
  headlessDeps.cleanIncompleteToolCalls = cleanIncompleteToolCalls;
  headlessDeps.submitExternalPermissionRequest = submitExternalPermissionRequest;
  headlessDeps.writeStdout = (text: string) => process.stdout.write(text);
  headlessDeps.writeStderr = (text: string) => process.stderr.write(text);
}

export interface HeadlessOptions {
  yolo?: boolean;
  background?: boolean;
  taskId?: string;
  sessionId?: string;
  timeout?: number;
  maxToolRounds?: number;
  outputFormat?: "text" | "json";
  mcp?: "auto" | "disabled";
}

function ensureHeadlessSuccess(result: { ok: boolean; error?: string }): void {
  if (result.ok) {
    return;
  }
  throw createAgentError("AGENT_EXEC_ERROR", result.error ?? "无头对话执行失败");
}

function patternContainsSensitiveMarker(pattern: string): boolean {
  if (/"__sensitive"\s*:\s*true/i.test(pattern)) {
    return true;
  }
  try {
    const parsed = JSON.parse(pattern);
    return typeof parsed === "object" && parsed !== null && (parsed as { __sensitive?: unknown }).__sensitive === true;
  } catch {
    return false;
  }
}

function isHighRiskYoloPermission(input: PermissionAskInput): boolean {
  const permission = input.permission.toLowerCase();
  if (permission === "mcp.sensitive" || permission.startsWith("mcp.sensitive.")) {
    return true;
  }
  return input.patterns.some(patternContainsSensitiveMarker);
}

function getHeadlessErrorHint(reason: HeadlessErrorReason): HeadlessErrorHint {
  if (reason === "non_interactive_permission") {
    return {
      reason,
      suggestion:
        "Foreground headless mode cannot show an approval UI. Re-run with --yolo for safe operations, or use --task/background mode so the request can be approved externally.",
    };
  }
  if (reason === "policy_denied") {
    return {
      reason,
      suggestion:
        "The request was rejected by headless safety policy. Remove the high-risk operation or run interactively if manual review is required.",
    };
  }
  return {
    reason,
    suggestion: "The permission request was rejected. Re-run and approve the request if the operation is intended.",
  };
}

function createPermissionRequestHandler(
  options: HeadlessOptions,
  onRejectReason?: (reason: HeadlessErrorReason) => void,
): ((input: PermissionAskInput) => Promise<ApprovalAction | boolean>) | undefined {
  if (options.yolo) {
    return async (input) => {
      if (isHighRiskYoloPermission(input)) {
        onRejectReason?.("policy_denied");
        return "reject";
      }
      return "once";
    };
  }
  if (options.background) {
    return async (input) => {
      const decision = await headlessDeps.submitExternalPermissionRequest(input);
      if (decision === false || decision === "reject") {
        onRejectReason?.("user_rejected");
      }
      return decision;
    };
  }
  return async () => {
    onRejectReason?.("non_interactive_permission");
    return "reject";
  };
}

function shouldStartMcpRuntime(options: HeadlessOptions): boolean {
  if (options.mcp === "disabled") {
    return false;
  }
  return process.env.CRAB_HEADLESS_MCP !== "0";
}

export class HeadlessRunner {
  private readonly eventBus: EventBus;

  constructor(eventBus: EventBus = globalBus) {
    this.eventBus = eventBus;
  }

  /**
   * 运行无头模式。
   *
   * @param prompt - 用户输入的提示
   * @param options - 运行选项
   */
  async run(prompt: string, options: HeadlessOptions = {}): Promise<void> {
    log.info(`无头模式启动: "${prompt.slice(0, 50)}" yolo=${options.yolo}`);
    let unsubToken: (() => void) | undefined;
    let unsubToolCall: (() => void) | undefined;
    let unsubToolResult: (() => void) | undefined;
    let permissionRejectReason: HeadlessErrorReason | undefined;

    try {
      // 1. 加载配置
      const config = await headlessDeps.loadConfig();
      headlessDeps.initTaskRuntime(process.cwd(), undefined, {
        skipTaskLoad: options.background === true && Boolean(options.taskId),
      });

      // 如果 yolo 模式，临时修改权限策略
      if (options.yolo) {
        log.info("YOLO 模式(自动执行，不确认)");
      }

      // 2. 启动 MCP runtime；可在无工具 smoke/CI 中显式禁用，避免外部 MCP 依赖影响基础问答链路。
      if (shouldStartMcpRuntime(options)) {
        await headlessDeps.ensureMcpRuntimeStarted();
      } else {
        log.info("Headless MCP runtime disabled");
      }

      // 3. 创建对话处理器
      if (options.sessionId) {
        headlessDeps.ensureSession(options.sessionId, {
          model: config.defaultProvider.model,
          projectDir: process.cwd(),
        });
        headlessDeps.cleanIncompleteToolCalls(options.sessionId);
      }
      const initialMessages = options.sessionId
        ? messageRecordsToModelMessages(headlessDeps.getSessionMessages(options.sessionId))
        : undefined;
      const runtimeOverrides = buildChatRuntimeOverrides(config, getActiveAgent(), "chat", options.yolo === true);
      const abortController = new AbortController();
      const handler = new headlessDeps.ConversationHandler(config, {
        abortSignal: abortController.signal,
        allowedTools: runtimeOverrides.allowedTools,
        initialMessages,
        maxToolRounds: options.maxToolRounds ?? runtimeOverrides.maxToolRounds,
        modelId: runtimeOverrides.modelId,
        permissionRequestHandler: createPermissionRequestHandler(options, (reason) => {
          permissionRejectReason = reason;
        }),
        providerId: runtimeOverrides.providerId,
        sessionId: options.sessionId,
        systemPrompt: runtimeOverrides.systemPrompt,
        temperature: runtimeOverrides.temperature,
        topP: runtimeOverrides.topP,
      });

      // 4. 通过 globalBus 订阅对话事件
      unsubToken = this.eventBus.subscribe(AppEvent.ConversationStreamToken, (evt) => {
        if (options.outputFormat !== "json") {
          headlessDeps.writeStdout(evt.properties.content);
        }
      });

      unsubToolCall = this.eventBus.subscribe(AppEvent.ConversationToolCall, (evt) => {
        if (!options.background) {
          headlessDeps.writeStderr(`\n[工具调用] ${evt.properties.tool}\n`);
        }
      });

      unsubToolResult = this.eventBus.subscribe(AppEvent.ToolResult, (evt) => {
        if (!options.background) {
          const resultStr = String(evt.properties.result ?? "");
          const truncated = resultStr.length > 200 ? `${resultStr.slice(0, 200)}...` : resultStr;
          headlessDeps.writeStderr(`[工具结果] ${evt.properties.tool}: ${truncated}\n`);
        }
      });

      // 5. 执行对话(带超时控制)
      const executeWithTimeout = async () => {
        if (options.timeout && options.timeout > 0) {
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              handler.sendMessage(prompt),
              new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                  abortController.abort();
                  reject(new Error(`执行超时 (${options.timeout}ms)`));
                }, options.timeout);
              }),
            ]);
          } finally {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          }
        }
        return handler.sendMessage(prompt);
      };

      const result = await executeWithTimeout();
      ensureHeadlessSuccess(result);
      await this.eventBus.flush();

      // 6. 输出结果
      if (options.outputFormat === "json") {
        const jsonOutput = {
          sessionId: options.sessionId,
          success: true,
          text: result.text,
          usage: result.usage
            ? {
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
              }
            : undefined,
        };
        headlessDeps.writeStdout(`${JSON.stringify(jsonOutput, null, 2)}\n`);
      } else {
        headlessDeps.writeStdout("\n");
      }

      if (options.taskId) {
        headlessDeps.completeTask(options.taskId, undefined, {
          result: result.text,
          sessionId: options.sessionId,
          tokenUsage: result.usage
            ? {
                input: result.usage.inputTokens,
                output: result.usage.outputTokens,
              }
            : undefined,
        });
      }
      log.info("无头模式完成");
    } catch (err) {
      await this.eventBus.flush();
      const error = createServerError(
        err,
        {
          operation: "runHeadless",
          sessionId: options.sessionId,
          taskId: options.taskId,
        },
        "headless",
      );
      if (options.taskId) {
        headlessDeps.completeTask(options.taskId, error.message);
      }
      log.error(`无头模式失败: ${error.message}`, toServerLogPayload(error));
      if (options.outputFormat === "json") {
        const hint = permissionRejectReason ? getHeadlessErrorHint(permissionRejectReason) : undefined;
        const jsonOutput = {
          error: {
            code: error.code,
            message: error.message,
            reason: hint?.reason,
            suggestion: hint?.suggestion,
          },
          sessionId: options.sessionId,
          success: false,
        };
        headlessDeps.writeStdout(`${JSON.stringify(jsonOutput, null, 2)}\n`);
      }
      headlessDeps.writeStderr(`\n错误: ${error.message} (${error.code})\n`);
      throw error;
    } finally {
      unsubToken?.();
      unsubToolCall?.();
      unsubToolResult?.();
    }
  }
}

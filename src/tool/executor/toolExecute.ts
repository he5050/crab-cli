/**
 * 工具执行核心逻辑 — execute 方法的独立函数实现。
 */
import { createLogger } from "@/core/logging/logger";
import { getDefaultPermissionsWithoutHardDeny, getHardDenyPermissions } from "@/config";
import { getRegisteredTools } from "../registry/toolRegistry";
import { evaluateToolExecutionPolicy } from "./toolExecutionPolicy";
import { executeToolCore } from "./toolExecutionCore";
import {
  checkCommandInjection,
  extractCommandField,
  isSensitiveCall,
  matchPattern,
  matchPermission,
} from "./toolExecutorSafety";
import type { ToolPermissionInfo, ToolDefinition } from "../types";
import type { ToolExecutorOptions, ToolExecutionResult, PermissionCheckResult } from "./toolExecutorTypes";
import { getGlobalAuditLogger } from "@/security/audit/auditLogger";
import { replayProtector } from "@/security/replayProtection";
import { recordToolBusinessTelemetry } from "@/monitor/telemetry/telemetry";

const log = createLogger("tool:executor");

/**
 * 检查工具权限
 */
/** checkPermission 的实现 */
export function checkPermission(
  options: ToolExecutorOptions,
  tool: ToolPermissionInfo,
  args: Record<string, unknown>,
): PermissionCheckResult {
  const config = options.getConfig();
  const rules = [...getHardDenyPermissions(), ...(config.permissions ?? []), ...getDefaultPermissionsWithoutHardDeny()];

  // 按顺序匹配规则(第一条匹配的规则生效)
  for (const rule of rules) {
    if (matchPermission(tool.permission, rule.permission) && matchPattern(args, rule.pattern)) {
      return { action: rule.action, matchedRule: rule };
    }
  }

  // 默认:询问用户确认
  return { action: "ask" };
}

/**
 * 执行工具 — 核心执行逻辑
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  options: ToolExecutorOptions,
  execOptions?: { timeout?: number; signal?: AbortSignal },
): Promise<ToolExecutionResult> {
  const startTime = Date.now();
  log.debug(`开始执行工具`, { args: JSON.stringify(args), toolName });
  const auditLogger = getGlobalAuditLogger();

  // OTel span
  const { getTracer } = await import("@/monitor/telemetry/telemetry");
  const span = getTracer().startSpan("tool.execute", { attributes: { "tool.name": toolName } });
  let isSensitive = false;
  let telemetryRecorded = false;
  const recordToolTelemetryOnce = (event: { success: boolean; exitReason: string; error?: string }): number => {
    const durationMs = Date.now() - startTime;
    if (!telemetryRecorded) {
      recordToolBusinessTelemetry({
        durationMs,
        error: event.error,
        exitReason: event.exitReason,
        sensitive: isSensitive,
        success: event.success,
        toolName,
      });
      telemetryRecorded = true;
    }
    return durationMs;
  };

  // 辅助函数: 查找工具
  const findTool = (name: string): ToolDefinition<any> | undefined => {
    const tools = getRegisteredTools();
    return tools[name];
  };

  // 0. 可选重放检测（非严格模式，缺少 nonce/timestamp 时放行）
  const toolCtx = options.getToolContext?.();
  const replayResult = replayProtector.validateRequest({
    nonce: typeof args?.nonce === "string" ? args.nonce : undefined,
    timestamp: typeof args?.timestamp === "number" ? args.timestamp : undefined,
    sessionId: toolCtx?.sessionId,
    source: "cli",
  });
  if (!replayResult.valid) {
    log.warn(`工具执行被重放检测拒绝`, { reason: replayResult.message, toolName });
    auditLogger.logSecurityEvent(`replay_blocked:${toolName}`, {
      metadata: { args, reason: replayResult.message },
      resource: { id: toolName, type: "tool" },
      severity: "warning",
    });
    span.setAttribute("tool.exit_reason", "replay_blocked");
    span.setStatus({ code: 2, message: "replay blocked" });
    const durationMs = recordToolTelemetryOnce({
      error: replayResult.message,
      exitReason: "replay_blocked",
      success: false,
    });
    span.end();
    return {
      durationMs,
      error: `Security: Replay detected - ${replayResult.message}`,
      output: null,
      success: false,
      toolName,
    };
  }

  // 1. 查找工具
  const tool = findTool(toolName);
  if (!tool) {
    log.warn(`工具未找到`, { toolName });
    auditLogger.log({
      action: `tool.not_found:${toolName}`,
      eventType: "system",
      level: "warning",
      metadata: { args, toolName },
    });
    span.setAttribute("tool.exit_reason", "not_found");
    span.setStatus({ code: 2, message: `Tool not found: ${toolName}` });
    const durationMs = recordToolTelemetryOnce({
      error: `Tool not found: "${toolName}"`,
      exitReason: "not_found",
      success: false,
    });
    span.end();
    return {
      durationMs,
      error: `Tool not found: "${toolName}"`,
      output: null,
      success: false,
      toolName,
    };
  }
  log.debug(`工具已找到`, { permission: tool.permission, toolName });

  const executionPolicy = evaluateToolExecutionPolicy({ tool, toolName });
  if (!executionPolicy.allowed) {
    log.warn(`工具被执行策略拒绝`, { reason: executionPolicy.reason, toolName });
    auditLogger.logAuthz(`execution_policy_denied:${toolName}`, {
      allowed: false,
      metadata: { args, reason: executionPolicy.reason },
      resource: { id: toolName, type: "tool" },
    });
    span.setAttribute("tool.exit_reason", "execution_policy_denied");
    span.setStatus({ code: 2, message: executionPolicy.message ?? "execution policy denied" });
    const error = executionPolicy.message ?? `Tool "${toolName}" is blocked by execution policy`;
    const durationMs = recordToolTelemetryOnce({ error, exitReason: "execution_policy_denied", success: false });
    span.end();
    return {
      durationMs,
      error,
      output: null,
      success: false,
      toolName,
    };
  }

  // 2. 权限检查
  const permCheck = checkPermission(options, tool, args);
  log.debug(`权限检查结果`, { action: permCheck.action, matchedRule: permCheck.matchedRule?.pattern, toolName });
  if (permCheck.action === "deny") {
    log.warn(`工具被规则拒绝`, { rule: permCheck.matchedRule?.pattern, toolName });
    auditLogger.logAuthz(`denied:${toolName}`, {
      allowed: false,
      metadata: { args, rule: permCheck.matchedRule?.pattern },
      resource: { id: toolName, type: "tool" },
    });
    span.setAttribute("tool.exit_reason", "permission_denied");
    span.setStatus({ code: 2, message: "permission denied" });
    const durationMs = recordToolTelemetryOnce({
      error: "permission denied",
      exitReason: "permission_denied",
      success: false,
    });
    span.end();
    return {
      durationMs,
      error: `Permission denied: tool "${toolName}" is blocked by rule "${permCheck.matchedRule?.pattern}"`,
      output: null,
      success: false,
      toolName,
    };
  }

  if (permCheck.action === "ask") {
    log.debug(`请求用户权限确认`, { toolName });
    const allowed = await options.askPermission?.(toolName, args, permCheck.matchedRule);
    if (!allowed) {
      log.info(`用户拒绝工具执行`, { toolName });
      auditLogger.logAuthz(`user_rejected:${toolName}`, {
        allowed: false,
        metadata: { args },
        resource: { id: toolName, type: "tool" },
      });
      span.setAttribute("tool.exit_reason", "user_rejected");
      span.setStatus({ code: 2, message: "user rejected" });
      const durationMs = recordToolTelemetryOnce({
        error: "user rejected",
        exitReason: "user_rejected",
        success: false,
      });
      span.end();
      return {
        durationMs,
        error: `Permission denied: user rejected tool "${toolName}"`,
        output: null,
        success: false,
        toolName,
      };
    }
    log.debug(`用户允许工具执行`, { toolName });
  }

  // 3. 敏感命令检测
  isSensitive = isSensitiveCall(toolName, args);
  log.debug(`敏感命令检测`, { isSensitive, toolName });
  if (isSensitive) {
    log.warn(`检测到敏感命令`, { args: JSON.stringify(args), toolName });
    auditLogger.logSecurityEvent(`sensitive_command:${toolName}`, {
      metadata: { args },
      resource: { id: toolName, type: "tool" },
      severity: "warning",
    });
    const allowed = await options.askPermission?.(toolName, { ...args, __sensitive: true }, undefined);
    if (!allowed) {
      log.info(`用户拒绝敏感命令执行`, { toolName });
      auditLogger.logAuthz(`sensitive_rejected:${toolName}`, {
        allowed: false,
        metadata: { args, sensitive: true },
        resource: { id: toolName, type: "tool" },
      });
      span.setAttribute("tool.exit_reason", "sensitive_rejected");
      span.setStatus({ code: 2, message: "sensitive command rejected" });
      const durationMs = recordToolTelemetryOnce({
        error: "sensitive command rejected",
        exitReason: "sensitive_rejected",
        success: false,
      });
      span.end();
      return {
        durationMs,
        error: `Permission denied: sensitive command in "${toolName}"`,
        output: null,
        success: false,
        toolName,
      };
    }
    log.debug(`用户允许敏感命令执行`, { toolName });
  }

  // P0-2 修复: 命令注入检测
  const command = extractCommandField(args);
  if (command) {
    const injectionCheck = checkCommandInjection(command);
    if (injectionCheck.hasInjection) {
      log.warn(`检测到命令注入攻击`, { reason: injectionCheck.reason, toolName });
      auditLogger.logSecurityEvent(`command_injection_blocked:${toolName}`, {
        metadata: { args, reason: injectionCheck.reason },
        resource: { id: toolName, type: "tool" },
        severity: "critical",
      });
      span.setAttribute("tool.exit_reason", "injection_blocked");
      span.setStatus({ code: 2, message: "command injection blocked" });
      const durationMs = recordToolTelemetryOnce({
        error: injectionCheck.reason,
        exitReason: "injection_blocked",
        success: false,
      });
      span.end();
      return {
        durationMs,
        error: `Security: Command injection detected - ${injectionCheck.reason}`,
        output: null,
        success: false,
        toolName,
      };
    }
  }

  let coreResult: Awaited<ReturnType<typeof executeToolCore>>;
  try {
    coreResult = await executeToolCore({
      args,
      fallbackTimeout: execOptions?.timeout ?? options.defaultTimeout,
      getConfig: options.getConfig,
      getToolContext: options.getToolContext,
      signal: execOptions?.signal,
      startTime,
      tool,
      toolName,
    });
  } catch (error) {
    const exception = error instanceof Error ? error : new Error(String(error));
    const durationMs = Date.now() - startTime;
    log.error(`工具核心执行抛出异常`, { durationMs, error: exception.message, toolName });
    span.setAttribute("tool.exit_reason", "core_exception");
    span.recordException(exception);
    span.setStatus({ code: 2, message: exception.message });
    recordToolTelemetryOnce({ error: exception.message, exitReason: "core_exception", success: false });
    span.end();
    return {
      durationMs,
      error: `Tool execution failed: ${exception.message}`,
      output: null,
      success: false,
      toolName,
    };
  }

  if (coreResult.kind === "validation_failed") {
    auditLogger.log({
      action: `validation_failed:${toolName}`,
      error: coreResult.error,
      eventType: "system",
      level: "warning",
      metadata: { args: coreResult.args, issues: coreResult.error },
      resource: { id: toolName, type: "tool" },
    });
    span.setAttribute("tool.exit_reason", "validation_failed");
    span.setStatus({ code: 2, message: coreResult.error });
    const durationMs = recordToolTelemetryOnce({
      error: coreResult.error,
      exitReason: "validation_failed",
      success: false,
    });
    span.end();
    return {
      durationMs,
      error: `Parameter validation failed: ${coreResult.error}`,
      output: null,
      success: false,
      toolName,
    };
  }

  if (coreResult.kind === "exception") {
    const { durationMs } = coreResult;
    log.error(`工具执行失败`, { durationMs, error: coreResult.error, toolName });
    span.setAttribute("tool.duration_ms", durationMs);
    span.recordException(coreResult.exception);
    span.setStatus({ code: 2, message: coreResult.error });
    recordToolTelemetryOnce({ error: coreResult.error, exitReason: "exception", success: false });
    span.end();

    // 记录失败的工具执行审计日志
    auditLogger.log({
      action: `tool.failed:${toolName}`,
      duration: durationMs,
      error: coreResult.error,
      eventType: "system",
      level: "error",
      metadata: { args: coreResult.args, durationMs, success: false },
      resource: { id: toolName, type: "tool" },
    });

    return {
      durationMs,
      error: coreResult.error,
      output: null,
      success: false,
      toolName,
    };
  }

  ({ args } = coreResult);
  const { durationMs } = coreResult;
  const processedResult = coreResult.output;
  // 记录成功的工具执行审计日志
  const isDataModification = /^(write|create|delete|remove|update|modify|exec|bash|terminal|shell|command|run)/i.test(
    toolName,
  );
  auditLogger.log({
    action: `tool.executed:${toolName}`,
    duration: durationMs,
    eventType: isDataModification ? "data_modification" : "data_access",
    level: isDataModification ? "warning" : "info",
    metadata: { args, durationMs, success: true },
    resource: { id: toolName, name: tool.description, type: "tool" },
  });

  span.setAttribute("tool.duration_ms", durationMs);
  span.setAttribute("tool.success", true);
  span.setAttribute("tool.sensitive", isSensitive);
  span.setStatus({ code: 0 });
  recordToolTelemetryOnce({ exitReason: "success", success: true });
  span.end();
  return {
    durationMs,
    output: processedResult,
    success: true,
    toolName,
  };
}

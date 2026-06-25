/**
 * 工具调用事件辅助 — 构建/更新 ChatMessage 中的 ToolPart，处理 running → done 状态流转。
 *
 * 职责:
 *   - 创建「运行中」状态的工具消息
 *   - 工具结果输出格式化(含超长截断)
 *   - 工具结果回写到既有运行中消息
 *
 * 模块功能:
 *   - buildRunningToolMessage: 构造一条 running 状态工具消息
 *   - formatToolResultOutput: 序列化工具输出并截断
 *   - updateToolResultMessages: 按 callId 或工具名查找并更新既有消息
 *   - buildCompletedToolPart: 合并构建 done 状态的 ToolPart
 */
import type { MessageFileReference, MessagePartTime } from "@/session";
import type { ChatMessage, ToolPart } from "./chatTypes";
import { appendMessage, mergeMetadata, normalizePartTime } from "./chatHelpers";
import { inlineSuccessIcon } from "@/core/icons/iconDerived";

export interface PersistedToolCall {
  tool: string;
  args: string;
  input: unknown;
  metadata?: Record<string, unknown>;
  files?: MessageFileReference[];
  diagnostics?: unknown[];
  subSessionId?: string;
  startedAt?: number;
  time?: MessagePartTime;
}

export interface RunningToolMessageInput {
  tool: string;
  args: unknown;
  callId?: string;
  metadata?: Record<string, unknown>;
  files?: MessageFileReference[];
  diagnostics?: unknown[];
  subSessionId?: string;
  startedAt?: number;
  time?: MessagePartTime;
}

export function buildRunningToolMessage(
  input: RunningToolMessageInput,
  id: string,
  debug: (message: string) => void,
): ChatMessage {
  const { tool, args, callId, metadata, files, diagnostics, subSessionId } = input;
  let argsStr: string;
  try {
    argsStr = JSON.stringify(args, null, 2);
  } catch (error) {
    debug(`工具参数序列化失败: ${error instanceof Error ? error.message : String(error)}`);
    argsStr = String(args);
  }
  const detail = argsStr.slice(0, 60);
  const startedAt = input.startedAt ?? input.time?.startedAt ?? Date.now();
  const time = normalizePartTime(input.time, startedAt);

  return {
    content: `⟳ ${tool} ${detail}`,
    id,
    parts: [
      {
        args: argsStr,
        callId,
        detail,
        diagnostics,
        files,
        input: args,
        metadata,
        startedAt,
        status: "running",
        subSessionId,
        success: true,
        time,
        tool,
        type: "tool",
      },
    ],
    role: "system",
    toolInfo: { detail, success: true, tool },
  };
}

export function formatToolResultOutput(result: unknown, debug: (message: string) => void): string | undefined {
  let output: string | undefined;
  if (typeof result === "string") {
    output = result;
  } else if (result && typeof result === "object" && "output" in result && typeof result.output === "string") {
    ({ output } = result);
  } else if (result !== null && result !== undefined) {
    try {
      output = JSON.stringify(result, null, 2);
    } catch (error) {
      debug(`工具结果序列化失败: ${error instanceof Error ? error.message : String(error)}`);
      output = String(result);
    }
  }

  if (output && output.length > 2000) {
    const lines = output.split("\n");
    if (lines.length > 20) {
      return `${lines.slice(0, 20).join("\n")}\n... (共 ${lines.length} 行，已截断)`;
    }
  }
  return output;
}

export interface ToolResultMessageUpdate {
  tool: string;
  success: boolean;
  callId?: string;
  persisted?: PersistedToolCall;
  startedAt?: number;
  endedAt: number;
  time?: MessagePartTime;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  files?: MessageFileReference[];
  diagnostics?: unknown[];
  subSessionId?: string;
  resultTime?: MessagePartTime;
  displayOutput?: string;
  truncated?: boolean;
  outputPath?: string;
  fallbackId: string;
}

export function updateToolResultMessages(prev: ChatMessage[], update: ToolResultMessageUpdate): ChatMessage[] {
  const { tool, success, callId } = update;
  const icon = inlineSuccessIcon(success);
  const idx = prev.findLastIndex((m) => {
    if (m.role !== "system") {
      return false;
    }
    if (callId && m.id === callId) {
      return true;
    }
    const part = m.parts?.[0];
    return part?.type === "tool" && part.tool === tool && part.status === "running";
  });

  if (idx !== -1) {
    const next = [...prev];
    const old = next[idx]!;
    const oldPart = old.parts?.[0]?.type === "tool" ? old.parts[0] : undefined;
    const mergedTime = normalizePartTime(
      { ...oldPart?.time, ...update.time },
      update.startedAt ?? oldPart?.startedAt,
      update.endedAt,
      update.durationMs,
    );
    next[idx] = {
      ...old,
      content: `${icon} ${tool} ${success ? "成功" : "错误"}`,
      parts: [buildCompletedToolPart(update, oldPart, mergedTime)],
      toolInfo: { success, tool },
    };
    return next;
  }

  return appendMessage(prev, {
    content: `${icon} ${tool} ${success ? "成功" : "错误"}`,
    id: update.fallbackId,
    parts: [buildCompletedToolPart(update, undefined, update.resultTime)],
    role: "system",
    toolInfo: { success, tool },
  });
}

function buildCompletedToolPart(
  update: ToolResultMessageUpdate,
  oldPart: ToolPart | undefined,
  time?: MessagePartTime,
): ToolPart {
  return {
    args: String(oldPart?.args ?? update.persisted?.args ?? ""),
    callId: update.callId,
    diagnostics: update.diagnostics ?? oldPart?.diagnostics ?? update.persisted?.diagnostics,
    durationMs: time?.durationMs,
    endedAt: time?.endedAt,
    files: update.files ?? oldPart?.files ?? update.persisted?.files,
    input: oldPart?.input ?? update.persisted?.input,
    metadata: mergeMetadata(oldPart?.metadata ?? update.persisted?.metadata, update.metadata),
    output: update.displayOutput,
    outputPath: update.outputPath,
    startedAt: time?.startedAt,
    status: update.success ? "done" : "error",
    subSessionId: update.subSessionId ?? oldPart?.subSessionId ?? update.persisted?.subSessionId,
    success: update.success,
    time,
    tool: update.tool,
    truncated: update.truncated ?? false,
    type: "tool",
  };
}

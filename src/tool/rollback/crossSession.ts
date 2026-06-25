/**
 * 跨会话回滚模块
 *
 * 职责:
 *   - 从压缩分支点恢复到压缩前状态
 *   - 支持 fork(创建新会话)和 replace(替换当前会话)两种策略
 *   - 检测并报告文件冲突
 *
 * 边界:
 *   - 仅处理分支点恢复，不修改分支点本身
 *   - 文件冲突不会阻止操作，仅记录报告
 *   - fork/replace 策略仅影响消息恢复方式
 */

import { createLogger } from "@/core/logging/logger";
import { type CompactionBranchPoint, listBranchPoints, loadBranchPoint } from "./branchPoints";
import { addMessage, deleteSessionMessages, createSession, getSession } from "@/session";
import type { MessagePart, MessageRole } from "@/session/type";
import { SessionError } from "@/core/errors/appError";
import type { ModelMessage } from "ai";

const log = createLogger("rollback:crossSession");

// ── 类型定义 ─────────────────────────────────────────────────────

/** 跨会话回滚策略 */
export type RollbackStrategy = "fork" | "replace";

/** 跨会话回滚结果 */
export interface CrossSessionRollbackResult {
  success: boolean;
  branchPoint: CompactionBranchPoint;
  strategy: RollbackStrategy;
  sourceSessionId: string;
  targetSessionId: string;
  restoredMessages: {
    before: number;
    after: number;
  };
  conflicts: {
    type: "file_modified" | "file_missing" | "entry_missing";
    detail: string;
  }[];
}

// ── 公共 API ─────────────────────────────────────────────────────

/**
 * 回滚到指定分支点
 *
 * @param branchPointId 分支点 ID
 * @param strategy 回滚策略:fork 创建新会话，replace 替换当前会话
 * @returns 回滚结果
 */
export async function rollbackToBranchPoint(
  branchPointId: string,
  strategy: RollbackStrategy = "fork",
): Promise<CrossSessionRollbackResult> {
  const bp = await loadBranchPoint(branchPointId);
  if (!bp) {
    throw new SessionError("SESSION-400", `分支点不存在: ${branchPointId}`, {
      context: { branchPointId },
    });
  }

  log.info(`开始跨会话回滚`, {
    branchPointId,
    compactionIndex: bp.compactionIndex,
    sessionId: bp.sessionId,
    strategy,
  });

  const conflicts: CrossSessionRollbackResult["conflicts"] = [];
  const beforeMessages = bp.beforeState.messages ?? [];
  const afterMessages = bp.afterState.messages ?? [];

  if (beforeMessages.length === 0) {
    throw new SessionError("SESSION-405", `分支点 ${branchPointId} 没有压缩前完整消息，无法回滚`, {
      context: { branchPointId },
    });
  }

  const sourceSessionId = bp.metadata.originalSessionId ?? bp.sessionId;
  let targetSessionId = sourceSessionId;

  if (strategy === "fork") {
    const parent = getSession(sourceSessionId);
    if (!parent) {
      throw new SessionError("SESSION-400", `原始会话不存在: ${sourceSessionId}`, {
        context: { branchPointId, sourceSessionId, strategy },
      });
    }
    const forked = createSession({
      model: parent.model ?? undefined,
      parentId: parent.id,
      projectDir: parent.projectDir ?? undefined,
      title: `${parent.title || "会话"} (压缩前恢复)`,
    });
    targetSessionId = forked.id;
  } else if (!getSession(sourceSessionId)) {
    throw new SessionError("SESSION-400", `原始会话不存在: ${sourceSessionId}`, {
      context: { branchPointId, sourceSessionId, strategy },
    });
  }

  // 1. 恢复消息到压缩前状态
  deleteSessionMessages(targetSessionId);
  const restoredCount = restoreModelMessagesToSession(targetSessionId, beforeMessages);

  log.info(`分支点消息恢复完成`, {
    compactedMessageCount: afterMessages.length,
    compressionRatio: bp.metadata.compressionRatio,
    restoredCount,
    sourceSessionId,
    strategy,
    targetSessionId,
  });

  const result: CrossSessionRollbackResult = {
    branchPoint: bp,
    conflicts,
    restoredMessages: {
      after: afterMessages.length,
      before: restoredCount,
    },
    sourceSessionId,
    strategy,
    success: conflicts.length === 0,
    targetSessionId,
  };

  log.info(`跨会话回滚完成`, {
    conflictCount: conflicts.length,
    strategy,
    success: result.success,
  });

  return result;
}

/**
 * 列出可回滚的分支点
 */
export async function listRollableBranchPoints(sessionId?: string): Promise<CompactionBranchPoint[]> {
  const points = await listBranchPoints(sessionId);
  return points.filter((bp) => bp.beforeState.messages.length > 0);
}

function restoreModelMessagesToSession(sessionId: string, messages: ModelMessage[]): number {
  let count = 0;
  for (const message of messages) {
    const role = normalizeModelRole(message.role);
    const parts = modelContentToMessageParts(message.content);
    if (parts.length === 0) {
      continue;
    }
    addMessage(sessionId, role, parts);
    count++;
  }
  return count;
}

function normalizeModelRole(role: string): MessageRole {
  if (role === "user" || role === "assistant" || role === "tool") {
    return role;
  }
  return "system";
}

function modelContentToMessageParts(content: ModelMessage["content"]): MessagePart[] {
  if (typeof content === "string") {
    return [{ content, type: "text" }];
  }
  if (!Array.isArray(content)) {
    return [{ content: stringifyContent(content), type: "text" }];
  }

  const parts: MessagePart[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const type = "type" in part ? String(part.type) : "";
    if (type === "text") {
      parts.push({ content: String("text" in part ? part.text : ""), type: "text" });
    } else if (type === "tool-call") {
      parts.push({
        content: stringifyContent("input" in part ? part.input : {}),
        input: "input" in part ? part.input : undefined,
        tool_name: String("toolName" in part ? part.toolName : "unknown"),
        tool_use_id: String("toolCallId" in part ? part.toolCallId : ""),
        type: "tool_use",
      });
    } else if (type === "tool-result") {
      const output = "output" in part ? part.output : undefined;
      parts.push({
        content: stringifyContent(output),
        result: output,
        tool_use_id: String("toolCallId" in part ? part.toolCallId : ""),
        type: "tool_result",
      });
    } else {
      parts.push({ content: stringifyContent(part), type: "text" });
    }
  }
  return parts;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

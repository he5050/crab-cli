/**
 * 会话 + Agent 命令。
 *
 * 职责:
 *   - 提供会话管理命令(恢复、导出、压缩、分享等)
 *   - 提供 Agent 管理命令(选择 Agent、切换角色)
 *   - 管理对话历史和会话状态
 *
 * 模块功能:
 *   - buildSessionAgentCommands: 构建会话和 Agent 命令
 *   - session.resume: 恢复会话
 *   - session.export: 导出对话
 *   - session.compact: 压缩会话
 *   - session.hybrid-compact: 混合压缩
 *   - session.share: 分享会话
 *   - session.snapshot: 创建快照
 *   - session.summary: 生成摘要
 *   - agent.select: 选择 Agent
 *   - agent.switch: 切换角色
 *
 * 使用场景:
 *   - 用户需要恢复历史会话
 *   - 用户需要导出对话内容
 *   - 用户需要压缩会话上下文
 *   - 用户需要切换 Agent
 *
 * 边界:
 *   1. 会话命令依赖 session 模块
 *   2. Agent 命令依赖 agentManager 模块
 *   3. 部分命令需要当前会话 ID
 *   4. 导出命令支持 Markdown 和 JSON 格式
 *
 * 流程:
 *   1. 接收 CommandDeps 依赖
 *   2. 构建会话和 Agent 命令数组
 *   3. 会话命令调用会话管理器
 *   4. Agent 命令调用 Agent 管理器
 *   5. 通过 EventBus 通知状态变更
 */
import type { Command } from "@/commandPalette/types";
import type { CommandDeps } from "../../shared";
import { globalBus, type EventBus } from "@/bus";
import { AppEvent } from "@/bus";
import type { ModelMessage } from "ai";
import { createModelMessageFromRecord } from "@/conversation/message/messageFactories";
import type { ShareMessage as ShareMessageInput, MessageRecord, CheckpointRecord } from "@/session/type";
import type { CompactionBranchPoint } from "@/tool/rollback/branchPoints";
import { readFile } from "node:fs/promises";
import { createInternalError } from "@/core/errors/appError";

export interface ImportPromptResult {
  source: string;
  sourceType: "file" | "url";
  content: string;
}

export async function handleImportCommand(args: string[]): Promise<ImportPromptResult> {
  const [sourceTypeRaw, source] = args;
  const sourceType = sourceTypeRaw === "url" ? "url" : "file";
  const target = sourceTypeRaw === "file" || sourceTypeRaw === "url" ? source : sourceTypeRaw;

  if (!target) {
    throw createInternalError("INTERNAL_ERROR", "Usage: /import file <path> or /import url <url>");
  }

  if (sourceType === "url") {
    const response = await fetch(target);
    if (!response.ok) {
      throw createInternalError("INTERNAL_ERROR", `URL import failed: ${response.status} ${response.statusText}`);
    }
    return { content: await response.text(), source: target, sourceType };
  }

  return { content: await readFile(target, "utf8"), source: target, sourceType };
}

function normalizeRole(role: string): "user" | "assistant" | "system" {
  if (role === "user" || role === "assistant") {
    return role;
  }
  return "system";
}

function modelMessagesToShareMessages(messages: ModelMessage[]): ShareMessageInput[] {
  return messages.map((message, index) => {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    return {
      content,
      role: normalizeRole(message.role),
      timestamp: Date.now() + index,
    };
  });
}

async function loadSessionRecords(sessionId: string): Promise<MessageRecord[]> {
  const { getSessionMessages } = await import("@session");
  return getSessionMessages(sessionId);
}

async function loadSessionModelMessages(records: MessageRecord[]): Promise<ModelMessage[]> {
  const { messagePartsToChatParts, messageRoleToChatRole } = await import("@session");
  return records.map((record) =>
    createModelMessageFromRecord(messageRoleToChatRole(record.role), messagePartsToChatParts(record.parts)),
  );
}

async function loadCommandConversationState(deps: CommandDeps): Promise<{
  shareMessages: ShareMessageInput[] | MessageRecord[];
  modelMessages: ModelMessage[];
}> {
  const sessionId = deps.getCurrentSessionId?.();
  if (sessionId) {
    const records = await loadSessionRecords(sessionId);
    if (records.length > 0) {
      return {
        modelMessages: await loadSessionModelMessages(records),
        shareMessages: records,
      };
    }
  }

  const history = deps.getConversationHistory?.() ?? [];
  return {
    modelMessages: history,
    shareMessages: modelMessagesToShareMessages(history),
  };
}

function formatCompressionRatio(value: number): string {
  if (!Number.isFinite(value)) {
    return "unknown";
  }
  return `${Math.round(value * 100)}%`;
}

export function formatRollbackBranchPointLine(item: CompactionBranchPoint): string {
  const before = item.beforeState.messages.length;
  const after = item.afterState.messages.length;
  const checkpoint = item.metadata.preCompressionCheckpointId
    ? ` checkpoint=${item.metadata.preCompressionCheckpointId.slice(0, 12)}`
    : "";
  return [
    `  branch ${item.id}  pre=${before} compressed=${after} ratio=${formatCompressionRatio(item.metadata.compressionRatio)}${checkpoint}`,
    `    fork: /rollback branch ${item.id} fork`,
    `    replace: /rollback branch ${item.id} replace`,
  ].join("\n");
}

export function buildSessionAgentCommands(deps: CommandDeps, eventBus: EventBus = globalBus): Command[] {
  const loadSessionApi = async () => deps.sessionApi ?? (await import("@session"));
  const loadRollbackApi = async () => deps.rollbackApi ?? (await import("@/tool/rollback/crossSession"));
  return [
    // ─── 会话命令 ─────────────────────────────────────────
    {
      category: "会话",
      description: "从历史会话中选择并恢复",
      name: "session.resume",
      run: () => {
        eventBus.publish(AppEvent.SessionListShow, {});
      },
      slashName: "resume",
      suggested: true,
      title: "恢复会话",
    },
    {
      category: "会话",
      description: "导出当前对话为 Markdown、JSON、TXT 或 HTML 文件",
      name: "session.export",
      run: async () => {
        try {
          const { shareMessages } = await loadCommandConversationState(deps);
          if (shareMessages.length === 0) {
            deps.showToast?.("当前会话无消息可导出", "warning");
            return;
          }
          const { shareSession } = await loadSessionApi();
          const result = await shareSession(shareMessages, { format: "markdown" });
          deps.showToast?.(`对话已导出: ${result.path}`, "success");
        } catch (error) {
          deps.showToast?.(`导出失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "export",
      suggested: true,
      title: "导出对话",
    },
    {
      category: "会话",
      description: "手动压缩当前会话的上下文历史(AI 摘要)",
      name: "session.compact",
      run: async () => {
        const sessionId = deps.getCurrentSessionId?.();
        if (!sessionId) {
          deps.showToast?.("请先进入一个对话会话", "warning");
          return;
        }
        const config = deps.getConfig?.() as import("@/schema/config").AppConfigSchema | undefined;
        if (!config) {
          deps.showToast?.("配置不可用，无法执行压缩", "error");
          return;
        }
        deps.showToast?.("正在压缩上下文...", "info");
        try {
          const { compactSession } = await import("@compress");
          const result = await compactSession(sessionId, config);
          if (result.ok) {
            const checkpointHint = result.preCompressionCheckpointId
              ? `\n压缩前快照: ${result.preCompressionCheckpointId}`
              : "";
            deps.showToast?.(
              `压缩完成: ${result.tokensBefore} → ${result.tokensAfter} tokens${checkpointHint}`,
              "success",
            );
          } else {
            deps.showToast?.(`压缩跳过: ${result.error ?? "未知原因"}`, "info");
          }
        } catch (error) {
          deps.showToast?.(`压缩失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "compact",
      suggested: true,
      title: "压缩上下文",
    },
    {
      category: "会话",
      description: "执行混合压缩(AI 摘要 + 工具结果截断组合策略)",
      name: "session.hybridCompress",
      run: async () => {
        try {
          const sessionId = deps.getCurrentSessionId?.();
          if (!sessionId) {
            deps.showToast?.("请先进入一个对话会话", "warning");
            return;
          }
          const config = deps.getConfig?.() as import("@/schema/config").AppConfigSchema | undefined;
          if (!config) {
            deps.showToast?.("配置不可用，无法执行压缩", "error");
            return;
          }

          deps.showToast?.("开始混合压缩...", "info");
          const { hybridCompactSession } = await import("@compress");
          const result = await hybridCompactSession(sessionId, config);
          if (result.ok) {
            const checkpointHint = result.preCompressionCheckpointId
              ? `\n压缩前快照: ${result.preCompressionCheckpointId}`
              : "";
            deps.showToast?.(
              `混合压缩完成: ${result.tokensBefore} → ${result.tokensAfter} tokens${checkpointHint}`,
              "success",
            );
          } else {
            deps.showToast?.(`混合压缩跳过: ${result.error ?? "未知原因"}`, "info");
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.showToast?.(`混合压缩失败: ${msg}`, "error");
        }
      },
      slashName: "hybrid-compress",
      suggested: false,
      title: "混合压缩",
    },
    {
      category: "会话",
      description: "将当前会话导出为可分享的 JSON、Markdown、TXT 或 HTML 文件",
      name: "session.share",
      run: async (args?: string) => {
        try {
          const { shareMessages } = await loadCommandConversationState(deps);
          if (shareMessages.length === 0) {
            deps.showToast?.("当前会话无消息可分享", "warning");
            return;
          }
          const { shareSession } = await loadSessionApi();
          const requested = args?.trim().toLowerCase();
          const format =
            requested === "md"
              ? "markdown"
              : requested === "markdown" || requested === "txt" || requested === "html" || requested === "json"
                ? requested
                : "json";
          const result = await shareSession(shareMessages, { format });
          eventBus.publish(AppEvent.SessionShared, { format, sessionId: result.id, path: result.path });
          deps.showToast?.(`会话已分享，保存至: ${result.path}`, "success");
        } catch (error) {
          deps.showToast?.(`分享失败: ${String(error)}`, "error");
        }
      },
      slashName: "share",
      suggested: true,
      title: "分享会话",
    },
    {
      category: "会话",
      description: "创建/恢复/对比会话快照(/snapshot create|restore|list|diff)",
      name: "session.snapshot",
      run: async (args?: string) => {
        try {
          const sessionId = deps.getCurrentSessionId?.();
          if (!sessionId) {
            deps.showToast?.("请先进入一个对话会话", "warning");
            return;
          }

          const checkpoint = await loadSessionApi();
          const parts = (args ?? "").trim().split(/\s+/);
          const sub = parts[0] || "create";

          if (sub === "create") {
            const label = parts.slice(1).join(" ") || `snapshot-${Date.now()}`;
            const snap = checkpoint.createCheckpoint(sessionId, label);
            eventBus.publish(AppEvent.SnapshotCreated, { id: snap.id, label: snap.label });
            deps.showToast?.(`快照已创建: ${snap.label}`, "success");
          } else if (sub === "restore") {
            const id = parts[1];
            if (!id) {
              deps.showToast?.("用法: /snapshot restore <id>", "warning");
              return;
            }
            const snap = checkpoint.getCheckpoint(id);
            const restored = checkpoint.restoreCheckpoint(id);
            if (snap) {
              if (restored) {
                eventBus.publish(AppEvent.SessionSwitched, { from: sessionId, sessionId });
              }
              eventBus.publish(AppEvent.SnapshotRestored, { id: snap.id, label: snap.label });
              deps.showToast?.(`快照已恢复: ${snap.label}`, "success");
            }
          } else if (sub === "list") {
            const list = checkpoint.listCheckpoints(sessionId);
            if (list.length === 0) {
              deps.showToast?.("暂无快照", "info");
            } else {
              const lines = list.map(
                (s: CheckpointRecord) => `  ${s.id.slice(0, 8)}  ${s.label}  (${s.messageIndex} msgs)`,
              );
              deps.showToast?.(lines.join("\n"), "info");
            }
          } else if (sub === "delete") {
            const id = parts[1];
            if (!id) {
              deps.showToast?.("用法: /snapshot delete <id>", "warning");
              return;
            }
            const ok = checkpoint.deleteCheckpoint(id);
            deps.showToast?.(ok ? `快照已删除: ${id.slice(0, 8)}` : "快照不存在", ok ? "success" : "warning");
          } else if (sub === "diff") {
            const [id1, id2] = parts.slice(1);
            if (!id1 || !id2) {
              deps.showToast?.("用法: /snapshot diff <id1> <id2>", "warning");
              return;
            }
            const diff = checkpoint.compareCheckpoints(id1, id2);
            const diffText = diff
              ? `新增 ${diff.added} / 删除 ${diff.removed} / 变更 ${diff.modified}`
              : "两个快照无差异";
            deps.showToast?.(diffText, "info");
          }
        } catch (error) {
          deps.showToast?.(String(error), "error");
        }
      },
      slashName: "snapshot",
      suggested: true,
      title: "会话快照",
    },
    {
      category: "会话",
      description:
        "列出或恢复当前会话检查点/压缩分支点(/rollback [checkpointId] | /rollback branch <id> [replace|fork])",
      name: "session.rollback",
      run: async (args?: string) => {
        try {
          const sessionId = deps.getCurrentSessionId?.();
          if (!sessionId) {
            deps.showToast?.("请先进入一个对话会话", "warning");
            return;
          }

          const checkpoint = await loadSessionApi();
          const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
          const checkpointId = parts[0];

          if (checkpointId === "branch") {
            const branchPointId = parts[1];
            const strategy = parts[2] === "replace" ? "replace" : "fork";
            const { listRollableBranchPoints, rollbackToBranchPoint } = await loadRollbackApi();
            if (!branchPointId) {
              const branchPoints = await listRollableBranchPoints(sessionId);
              if (branchPoints.length === 0) {
                deps.showToast?.("当前会话暂无可回滚压缩分支点", "info");
                return;
              }
              deps.showToast?.(
                ["可回滚压缩分支点:", ...branchPoints.map(formatRollbackBranchPointLine)].join("\n"),
                "info",
              );
              return;
            }
            const result = await rollbackToBranchPoint(branchPointId, strategy);
            eventBus.publish(AppEvent.SessionSwitched, {
              from: result.sourceSessionId,
              sessionId: result.targetSessionId,
            });
            deps.showToast?.(
              `已恢复压缩前上下文: ${result.restoredMessages.before} 条消息 → ${strategy === "fork" ? "新会话" : "当前会话"} ${result.targetSessionId.slice(0, 12)}`,
              "success",
            );
            return;
          }

          if (!checkpointId) {
            const list = checkpoint.listCheckpoints(sessionId);
            const { listRollableBranchPoints } = await loadRollbackApi();
            const branchPoints = await listRollableBranchPoints(sessionId);
            if (list.length === 0 && branchPoints.length === 0) {
              deps.showToast?.("当前会话暂无检查点或压缩分支点", "info");
              return;
            }
            const lines = [
              "可恢复点:",
              ...list.map((item) => `  checkpoint ${item.id.slice(0, 12)}  ${item.label}  (${item.messageIndex} msgs)`),
              ...branchPoints.map(formatRollbackBranchPointLine),
            ];
            deps.showToast?.(lines.join("\n"), "info");
            return;
          }

          const info = checkpoint.getCheckpoint(checkpointId);
          const restored = checkpoint.restoreCheckpoint(checkpointId);
          if (!info || !restored) {
            deps.showToast?.("检查点不存在", "warning");
            return;
          }

          eventBus.publish(AppEvent.SessionSwitched, { from: sessionId, sessionId });
          deps.showToast?.(`已回滚到检查点: ${info.label}`, "success");
        } catch (error) {
          deps.showToast?.(`回滚失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "rollback",
      title: "回滚到检查点",
    },
    {
      category: "会话",
      description: "AI 自动生成当前会话的摘要",
      name: "session.summarize",
      run: async () => {
        try {
          const sessionId = deps.getCurrentSessionId?.();
          const { modelMessages } = await loadCommandConversationState(deps);
          if (modelMessages.length === 0) {
            deps.showToast?.("当前会话无消息可摘要", "warning");
            return;
          }
          const { summarizeSession } = await loadSessionApi();
          const { DEFAULT_COMPACTION_CONFIG } = await import("@/compress/conversation");
          const config = deps.getConfig?.() as import("@/schema/config").AppConfigSchema | undefined;
          if (!config) {
            deps.showToast?.("配置不可用，无法生成摘要", "error");
            return;
          }
          const result = await summarizeSession(config, modelMessages, DEFAULT_COMPACTION_CONFIG);
          eventBus.publish(AppEvent.SessionSummarized, {
            sessionId: sessionId ?? "unknown",
            charCount: result.charCount,
            messageCount: result.messageCount,
          });
          deps.showToast?.(`摘要已生成(${result.messageCount} 条消息，${result.charCount} 字符)`, "success");
        } catch (error) {
          deps.showToast?.(`摘要生成失败: ${String(error)}`, "error");
        }
      },
      slashName: "summarize",
      suggested: true,
      title: "生成摘要",
    },

    {
      category: "会话",
      description: "暂停当前 Agent 会话，保存状态以便稍后恢复",
      name: "session.pause",
      run: async () => {
        const sessionId = deps.getCurrentSessionId?.();
        if (!sessionId) {
          deps.showToast?.("请先进入一个对话会话", "warning");
          return;
        }
        const { setSessionPersistenceStatus, syncRuntimeSessionStatus } = await loadSessionApi();
        setSessionPersistenceStatus(sessionId, "paused");
        syncRuntimeSessionStatus(sessionId, "idle", "会话已暂停");
        deps.showToast?.("会话已暂停，可通过 /resume 恢复", "info");
      },
      slashName: "pause",
      suggested: true,
      title: "暂停会话",
    },
    {
      category: "会话",
      description: "恢复之前暂停的 Agent 会话",
      name: "session.agentResume",
      run: async (args?: string) => {
        try {
          const { findRecoverableSessions, clearAgentState } = await import("@agent");
          const { setSessionPersistenceStatus, syncRuntimeSessionStatus } = await loadSessionApi();
          const targetId = args?.trim();
          if (!targetId) {
            const recoverable = findRecoverableSessions();
            if (recoverable.length === 0) {
              deps.showToast?.("无可恢复的会话", "info");
              return;
            }
            const lines = recoverable.map(
              (r) => `  ${r.sessionId.slice(0, 12)}  ${r.title || "(无标题)"}  (${r.status})`,
            );
            deps.showToast?.(`可恢复会话:\n${lines.join("\n")}\n用法: /resume <sessionId>`, "info");
            return;
          }
          // 用户拒绝了之前的恢复提示
          clearAgentState(targetId);
          setSessionPersistenceStatus(targetId, "active");
          syncRuntimeSessionStatus(targetId, "idle", "Agent 会话已恢复");
          eventBus.publish(AppEvent.SessionSwitched, { from: targetId, sessionId: targetId });
          deps.showToast?.(`会话 ${targetId.slice(0, 12)} 已标记为可恢复，请切换到该会话`, "success");
        } catch (error) {
          deps.showToast?.(`恢复失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "agent-resume",
      suggested: true,
      title: "恢复 Agent 会话",
    },

    // ─── Agent 命令 ────────────────────────────────────────
    {
      category: "Agent",
      description: "选择或切换 AI Agent",
      name: "agent.select",
      run: () => {
        eventBus.publish(AppEvent.AgentPickerShow, {});
      },
      slashAliases: ["agent"],
      slashName: "agents",
      suggested: true,
      title: "选择 Agent",
    },
    {
      category: "Agent",
      description: "兼容入口:打开 Agent 选择器，Role 请使用 /role",
      name: "agent.role",
      run: () => {
        eventBus.publish(AppEvent.AgentPickerShow, {});
      },
      slashName: "agent-role",
      title: "选择 Agent",
    },
    {
      category: "会话",
      description: "从文件导入会话，或用 /import file|url 导入内容作为 prompt",
      name: "session.import",
      run: async (args?: string) => {
        try {
          const parts = (args ?? "").trim().split(/\s+/);
          const filePath = parts[0];

          if (!filePath) {
            deps.showToast?.(
              "用法: /import <文件路径> [--preview] [--format <格式>] 或 /import file <path> / /import url <url>",
              "warning",
            );
            return;
          }

          if (filePath === "file" || filePath === "url") {
            const imported = await handleImportCommand(parts);
            const preview =
              imported.content.length > 1500
                ? `${imported.content.slice(0, 1500)}\n...[truncated ${imported.content.length - 1500} chars]`
                : imported.content;
            deps.showToast?.(`已导入 ${imported.sourceType}: ${imported.source}\n\n${preview}`, "info");
            return;
          }

          // 解析选项
          let preview = false;
          let format: "json" | "markdown" | "chatgpt" | "claude" | "auto" | undefined = undefined;

          for (let i = 1; i < parts.length; i++) {
            if (parts[i] === "--preview") {
              preview = true;
            } else if (parts[i] === "--format" && parts[i + 1]) {
              format = parts[i + 1] as "json" | "markdown" | "chatgpt" | "claude" | "auto";
              i++;
            }
          }

          const { importSession, previewImport } = await loadSessionApi();

          if (preview) {
            const previewResult = await previewImport(filePath, { format });
            const lines = [
              `格式: ${previewResult.format}`,
              `标题: ${previewResult.title || "(无)"}`,
              `消息数: ${previewResult.messageCount}`,
              `参与者: ${previewResult.participants.join(", ")}`,
            ];
            if (previewResult.conflicts?.length) {
              lines.push(`冲突: ${previewResult.conflicts.length} 个`);
            }
            if (previewResult.warnings?.length) {
              lines.push(`警告: ${previewResult.warnings.join("; ")}`);
            }
            deps.showToast?.(lines.join("\n"), "info");
          } else {
            const result = await importSession(filePath, { createNew: true, format });
            if (result.success) {
              const lines = [
                `导入成功: ${result.title || "(无标题)"}`,
                `会话 ID: ${result.sessionId?.slice(0, 12)}...`,
                `消息数: ${result.messageCount}`,
              ];
              if (result.warnings?.length) {
                lines.push(`警告: ${result.warnings.join("; ")}`);
              }
              deps.showToast?.(lines.join("\n"), "success");
              // 触发会话切换事件，让用户可以查看导入的会话
              if (result.sessionId) {
                eventBus.publish(AppEvent.SessionSwitched, { from: result.sessionId, sessionId: result.sessionId });
              }
            } else {
              deps.showToast?.(`导入失败: ${result.error}`, "error");
            }
          }
        } catch (error) {
          deps.showToast?.(`导入失败: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
      slashName: "import",
      suggested: true,
      title: "导入会话",
    },
  ];
}

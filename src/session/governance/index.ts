/**
 * 上下文治理 — 统一查询 checkpoint / 分支点 / 回滚 / 用量等会话级状态。
 *
 * 职责:
 *   - 为上层(UI / 工具)提供统一的会话上下文快照
 *   - 聚合 checkpoint、branchPoint、rollback、usage 等只读视图
 *
 * 模块功能:
 *   - 聚合会话治理字段(检查点、分支点、回滚、统计等)
 *   - 提供 getSessionGovernance 等统一查询函数
 *
 * 使用场景:
 *   - 会话头部信息渲染
 *   - 回滚/压缩决策所需的状态读取
 *
 * 边界:
 *   1. 仅查询与聚合，不修改任何会话状态
 *   2. 不持有运行时缓存，每次调用穿透到对应模块
 */
import { type CompactionBranchPoint, listBranchPoints } from "@/tool/rollback/branchPoints";
import { type CheckpointRecord, listCheckpoints } from "../core/checkpoint";
import { type UsageStats, getSessionUsageStats } from "../usage/usage";
import { type RollbackEntry, listRollbackEntries } from "@/tool/rollback";

export type ContextBudgetStatus = "healthy" | "watch" | "critical" | "overflow";

export interface ContextGovernanceBudget {
  usedTokens: number;
  maxTokens: number;
  usageRatio: number;
  status: ContextBudgetStatus;
}

export interface ContextGovernanceCheckpoint {
  id: string;
  label: string;
  createdAt: number;
  messageCount: number;
  restoreHint: string;
}

export interface ContextGovernanceBranchPoint {
  id: string;
  createdAt: number;
  compactionIndex: number;
  compressionRatio: number;
  tokensBefore: number;
  tokensAfter: number;
  checkpointId?: string;
  forkHint: string;
  replaceHint: string;
}

export interface ContextGovernanceFileRollback {
  id: string;
  filePath: string;
  reason?: string;
  createdAt: string;
}

export interface ContextGovernancePanelModel {
  sessionId: string;
  budget: ContextGovernanceBudget;
  checkpoints: ContextGovernanceCheckpoint[];
  branchPoints: ContextGovernanceBranchPoint[];
  fileRollbacks: ContextGovernanceFileRollback[];
  warnings: string[];
  actions: { id: string; label: string; hint: string; severity: "info" | "warning" | "danger" }[];
  summary: ContextGovernanceSummary;
}

export interface ContextGovernanceSummary {
  sessionId: string;
  status: ContextBudgetStatus;
  usedTokens: number;
  maxTokens: number;
  checkpointCount: number;
  branchPointCount: number;
  fileRollbackCount: number;
  warningCount: number;
  nextActionHints: string[];
}

export interface BuildContextGovernancePanelInput {
  sessionId: string;
  maxTokens: number;
  usedTokens?: number;
  usage?: Pick<UsageStats, "inputTokens" | "outputTokens">;
  checkpoints?: CheckpointRecord[];
  branchPoints?: CompactionBranchPoint[];
  fileRollbacks?: RollbackEntry[];
}

export interface CollectContextGovernancePanelOptions {
  sessionId: string;
  projectDir?: string;
  maxTokens: number;
}

export async function collectContextGovernancePanel(
  options: CollectContextGovernancePanelOptions,
): Promise<ContextGovernancePanelModel> {
  const usage = await getSessionUsageStats(options.sessionId);
  const checkpoints = listCheckpoints(options.sessionId);
  const branchPoints = await listBranchPoints(options.sessionId);
  const fileRollbacks = options.projectDir ? listRollbackEntries(options.projectDir) : [];

  return buildContextGovernancePanel({
    branchPoints,
    checkpoints,
    fileRollbacks: fileRollbacks.filter((entry: RollbackEntry) => entry.sessionId === options.sessionId),
    maxTokens: options.maxTokens,
    sessionId: options.sessionId,
    usage,
  });
}

export function buildContextGovernancePanel(input: BuildContextGovernancePanelInput): ContextGovernancePanelModel {
  const usedTokens = input.usedTokens ?? (input.usage?.inputTokens ?? 0) + (input.usage?.outputTokens ?? 0);
  const budget = buildContextBudget(usedTokens, input.maxTokens);
  const checkpoints = [...(input.checkpoints ?? [])]
    .toSorted((a, b) => b.createdAt - a.createdAt)
    .map((checkpoint) => ({
      createdAt: checkpoint.createdAt,
      id: checkpoint.id,
      label: checkpoint.label,
      messageCount: checkpoint.snapshot.length,
      restoreHint: `/rollback ${checkpoint.id}`,
    }));
  const branchPoints = [...(input.branchPoints ?? [])]
    .toSorted((a, b) => b.timestamp - a.timestamp)
    .map((point) => {
      const checkpointId = point.metadata.preCompressionCheckpointId;
      return {
        id: point.id,
        createdAt: point.timestamp,
        compactionIndex: point.compactionIndex,
        compressionRatio: point.metadata.compressionRatio,
        tokensBefore: point.metadata.totalTokensBefore,
        tokensAfter: point.metadata.totalTokensAfter,
        ...(checkpointId ? { checkpointId } : {}),
        forkHint: `/rollback branch ${point.id} fork`,
        replaceHint: `/rollback branch ${point.id} replace`,
      };
    });
  const fileRollbacks = [...(input.fileRollbacks ?? [])]
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((entry) => ({
      id: entry.id,
      filePath: entry.filePath,
      ...(entry.reason ? { reason: entry.reason } : {}),
      createdAt: entry.createdAt,
    }));

  const warnings = buildContextWarnings(budget, checkpoints.length, branchPoints.length);
  const actions = buildContextActions(input.sessionId, budget, checkpoints.length, branchPoints.length);

  return {
    actions,
    branchPoints,
    budget,
    checkpoints,
    fileRollbacks,
    sessionId: input.sessionId,
    summary: buildContextGovernanceSummary({
      actions,
      branchPoints,
      budget,
      checkpoints,
      fileRollbacks,
      sessionId: input.sessionId,
      warnings,
    }),
    warnings,
  };
}

export function buildContextGovernanceSummary(
  model: Omit<ContextGovernancePanelModel, "summary">,
): ContextGovernanceSummary {
  return {
    branchPointCount: model.branchPoints.length,
    checkpointCount: model.checkpoints.length,
    fileRollbackCount: model.fileRollbacks.length,
    maxTokens: model.budget.maxTokens,
    nextActionHints: model.actions.slice(0, 3).map((action) => action.hint),
    sessionId: model.sessionId,
    status: model.budget.status,
    usedTokens: model.budget.usedTokens,
    warningCount: model.warnings.length,
  };
}

export function buildContextBudget(usedTokens: number, maxTokens: number): ContextGovernanceBudget {
  const safeMax = Math.max(1, maxTokens);
  const safeUsed = Math.max(0, usedTokens);
  const usageRatio = safeUsed / safeMax;
  let status: ContextBudgetStatus = "healthy";
  if (usageRatio >= 1) {
    status = "overflow";
  } else if (usageRatio >= 0.9) {
    status = "critical";
  } else if (usageRatio >= 0.75) {
    status = "watch";
  }

  return {
    maxTokens: safeMax,
    status,
    usageRatio,
    usedTokens: safeUsed,
  };
}

function buildContextWarnings(
  budget: ContextGovernanceBudget,
  checkpointCount: number,
  branchPointCount: number,
): string[] {
  const warnings: string[] = [];
  if (budget.status === "overflow") {
    warnings.push("上下文已超过预算，应先压缩或分叉恢复。");
  } else if (budget.status === "critical") {
    warnings.push("上下文接近上限，建议立即创建 checkpoint 后压缩。");
  } else if (budget.status === "watch") {
    warnings.push("上下文进入观察区，建议保留 checkpoint。");
  }
  if (checkpointCount === 0) {
    warnings.push("当前会话没有 checkpoint，恢复路径不完整。");
  }
  if (branchPointCount === 0) {
    warnings.push("当前会话没有压缩分支点，无法展示压缩前后恢复链。");
  }
  return warnings;
}

function buildContextActions(
  sessionId: string,
  budget: ContextGovernanceBudget,
  checkpointCount: number,
  branchPointCount: number,
): ContextGovernancePanelModel["actions"] {
  const actions: ContextGovernancePanelModel["actions"] = [
    { hint: `/checkpoint create ${sessionId}`, id: "checkpoint", label: "创建 checkpoint", severity: "info" },
    {
      hint: "/compact",
      id: "compact",
      label: "压缩上下文",
      severity: budget.status === "healthy" ? "info" : "warning",
    },
  ];
  if (checkpointCount > 0 || branchPointCount > 0) {
    actions.push({ hint: "/rollback", id: "rollback", label: "查看恢复点", severity: "info" });
  }
  if (budget.status === "overflow") {
    actions.push({ hint: "/rollback branch <id> fork", id: "fork", label: "优先分叉恢复", severity: "danger" });
  }
  return actions;
}

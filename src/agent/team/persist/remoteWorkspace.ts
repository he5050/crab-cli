/**
 * Team 远程工作空间模块 — 描述队友运行的远程端点与分配策略。
 *
 * 职责:
 *   - 定义远程工作空间的状态/信任/能力元数据
 *   - 维护团队成员到工作空间的分配关系
 *   - 持久化分布式团队计划
 *
 * 模块功能:
 *   - RemoteWorkspace: 远程工作空间类型
 *   - DistributedTeamAssignment: 团队成员分配
 *   - DistributedTeamPlan: 分布式团队计划
 *   - 加载/保存团队计划到 .crab/team/ 目录
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectCrabDir } from "@/config";
import { createUserError } from "@/core/errors/appError";
import type { Teammate } from "../types";

export type RemoteWorkspaceStatus = "available" | "busy" | "offline";
export type RemoteWorkspaceTrust = "local" | "trusted" | "untrusted";

export interface RemoteWorkspace {
  id: string;
  name: string;
  endpoint: string;
  projectDir: string;
  status: RemoteWorkspaceStatus;
  trust: RemoteWorkspaceTrust;
  capabilities: string[];
  maxTeammates?: number;
  assignedTeammates?: number;
}

export interface DistributedTeamAssignment {
  teammateId: string;
  workspaceId: string;
  endpoint: string;
  mode: "local" | "remote";
  sync: ("messages" | "artifacts" | "snapshots")[];
}

export interface DistributedTeamPlan {
  ok: boolean;
  assignments: DistributedTeamAssignment[];
  blocked: { teammateId: string; reason: string }[];
  safeguards: string[];
}

export interface BuildDistributedTeamPlanOptions {
  requiredCapability?: string;
  requireTrusted?: boolean;
}

const REMOTE_WORKSPACES_FILE = "remote-workspaces.json";

export function getRemoteWorkspaceStorePath(projectDir = process.cwd()): string {
  return join(getProjectCrabDir(projectDir), REMOTE_WORKSPACES_FILE);
}

export function loadRemoteWorkspaces(projectDir = process.cwd()): RemoteWorkspace[] {
  const file = getRemoteWorkspaceStorePath(projectDir);
  if (!existsSync(file)) {
    return [];
  }

  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((workspace) => normalizeRemoteWorkspace(workspace as RemoteWorkspace));
}

export function saveRemoteWorkspaces(workspaces: RemoteWorkspace[], projectDir = process.cwd()): RemoteWorkspace[] {
  const normalized = workspaces.map(normalizeRemoteWorkspace).toSorted((a, b) => a.id.localeCompare(b.id));
  const file = getRemoteWorkspaceStorePath(projectDir);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(normalized, null, 2));
  return normalized;
}

export function upsertRemoteWorkspace(projectDir: string, workspace: RemoteWorkspace): RemoteWorkspace[] {
  return saveRemoteWorkspaces(registerRemoteWorkspace(loadRemoteWorkspaces(projectDir), workspace), projectDir);
}

export function registerRemoteWorkspace(current: RemoteWorkspace[], workspace: RemoteWorkspace): RemoteWorkspace[] {
  const normalized = normalizeRemoteWorkspace(workspace);
  const next = current.filter((item) => item.id !== normalized.id);
  next.push(normalized);
  return next.toSorted((a, b) => a.id.localeCompare(b.id));
}

export function normalizeRemoteWorkspace(workspace: RemoteWorkspace): RemoteWorkspace {
  if (!workspace.id.trim()) {
    throw createUserError("MISSING_PARAMETER", "remote workspace id is required");
  }
  if (!workspace.endpoint.match(/^(ssh|https?|file):\/\//)) {
    throw createUserError("INVALID_PARAMETER", `unsupported remote workspace endpoint: ${workspace.endpoint}`);
  }
  return {
    ...workspace,
    assignedTeammates: Math.max(0, workspace.assignedTeammates ?? 0),
    capabilities: [...new Set(workspace.capabilities)].toSorted(),
    id: workspace.id.trim(),
    name: workspace.name.trim() || workspace.id.trim(),
  };
}

export function buildDistributedTeamPlan(
  teammates: Teammate[],
  workspaces: RemoteWorkspace[],
  options: BuildDistributedTeamPlanOptions = {},
): DistributedTeamPlan {
  const normalized = workspaces.map(normalizeRemoteWorkspace);
  const assignments: DistributedTeamAssignment[] = [];
  const blocked: DistributedTeamPlan["blocked"] = [];
  const occupancy = new Map(normalized.map((workspace) => [workspace.id, workspace.assignedTeammates ?? 0]));

  for (const mate of teammates) {
    const workspace = findWorkspaceForMate(mate, normalized, occupancy, options);
    if (!workspace) {
      blocked.push({ reason: "没有可用且满足能力/信任要求的远程工作区", teammateId: mate.id });
      continue;
    }

    occupancy.set(workspace.id, (occupancy.get(workspace.id) ?? 0) + 1);
    assignments.push({
      endpoint: workspace.endpoint,
      mode: workspace.endpoint.startsWith("file://") ? "local" : "remote",
      sync: ["messages", "artifacts", "snapshots"],
      teammateId: mate.id,
      workspaceId: workspace.id,
    });
  }

  return {
    assignments,
    blocked,
    ok: blocked.length === 0,
    safeguards: [
      "远程工作区只接收任务摘要、必要文件路径和产物索引，不同步完整会话数据库。",
      "远程执行结果必须通过 artifacts/snapshots 回传后再进入主工作区合并。",
      "untrusted 工作区不能在 requireTrusted=true 的分布式 Team 中接收任务。",
    ],
  };
}

function findWorkspaceForMate(
  mate: Teammate,
  workspaces: RemoteWorkspace[],
  occupancy: Map<string, number>,
  options: BuildDistributedTeamPlanOptions,
): RemoteWorkspace | undefined {
  const capability = options.requiredCapability ?? inferCapability(mate);
  return workspaces.find((workspace) => {
    if (workspace.status !== "available") {
      return false;
    }
    if (options.requireTrusted && workspace.trust === "untrusted") {
      return false;
    }
    if (!workspace.capabilities.includes(capability)) {
      return false;
    }
    const current = occupancy.get(workspace.id) ?? 0;
    return current < (workspace.maxTeammates ?? Number.POSITIVE_INFINITY);
  });
}

function inferCapability(mate: Teammate): string {
  const text = `${mate.role} ${mate.task} ${mate.agentName ?? ""}`.toLowerCase();
  if (text.includes("review") || text.includes("审查")) {
    return "review";
  }
  if (text.includes("test") || text.includes("测试") || text.includes("qa")) {
    return "test";
  }
  if (text.includes("doc") || text.includes("文档")) {
    return "docs";
  }
  return "code";
}

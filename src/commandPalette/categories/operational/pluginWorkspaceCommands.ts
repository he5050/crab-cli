/**
 * 插件市场与远程工作空间命令集 — 插件浏览/安装、工作空间连接/同步
 *
 * 职责:
 *   - 暴露插件市场浏览/安装相关命令
 *   - 暴露远程工作空间连接/同步相关命令
 *   - 解析参数并通过事件总线触发副作用
 *
 * 模块功能:
 *   - buildPluginWorkspaceCommands: 构建插件市场与工作空间命令集合
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AppEvent } from "@/bus";
import { globalBus, type EventBus } from "@/bus";
import type { Command } from "@/commandPalette/types";
import type { CommandDeps } from "../../shared";
import type { MarketplacePluginEntry, PluginMarketplacePolicy } from "@/extension/plugin/pluginMarketplace";
import type { RemoteWorkspace } from "@/agent/team/type";
import { parsePositiveInt } from "@/tool/shared/number";

interface ParsedArgs {
  action: string;
  values: Record<string, string>;
  rest: string[];
}

type MarketplaceInput =
  | {
      ok: true;
      entries: MarketplacePluginEntry[];
      policy: PluginMarketplacePolicy;
    }
  | {
      ok: false;
      message: string;
    };

const PLUGIN_MARKET_USAGE = [
  "用法: /plugin-market list file=<catalog.json>",
  "      /plugin-market plan file=<catalog.json> id=<pluginId>",
  "      /plugin-market lock file=<catalog.json> id=<pluginId>",
].join("\n");

const REMOTE_WORKSPACE_ADD_USAGE =
  "用法: /remote-workspace add id=<id> endpoint=ssh://host/path projectDir=/srv/app capabilities=code,test trust=trusted";
const REMOTE_WORKSPACE_USAGE = [
  REMOTE_WORKSPACE_ADD_USAGE,
  "      /remote-workspace list",
  "      /remote-workspace plan capability=code trusted=true",
].join("\n");

export function buildPluginWorkspaceCommands(deps: CommandDeps, eventBus: EventBus = globalBus): Command[] {
  return [
    {
      category: "operational",
      description: "查看当前会话上下文预算、checkpoint、branch point 和恢复动作",
      name: "context-governance",
      run: async (args?: string) => {
        const sessionId = deps.getCurrentSessionId?.();
        if (!sessionId) {
          deps.showToast?.("请先进入一个对话会话", "warning");
          return;
        }
        const maxTokens = parsePositiveInt(parseKeyValueArgs(args).values.maxTokens) ?? 128_000;
        const { collectContextGovernancePanel } = await import("@session");
        const model = await collectContextGovernancePanel({
          maxTokens,
          projectDir: process.cwd(),
          sessionId,
        });
        publishInfo(formatContextGovernanceReport(model), eventBus);
      },
      slashAliases: ["governance"],
      slashName: "context",
      suggested: true,
      title: "上下文治理",
    },
    {
      category: "operational",
      description: "查看插件市场 catalog，生成 sandbox install plan 或 install lock",
      name: "plugin-marketplace",
      run: async (args?: string) => {
        const parsed = parseKeyValueArgs(args);
        const report = await handlePluginMarketplaceCommand(parsed);
        publishInfo(report, eventBus);
      },
      slashAliases: ["plugins-market", "plugin-marketplace"],
      slashName: "plugin-market",
      suggested: true,
      title: "插件市场",
    },
    {
      category: "operational",
      description: "管理项目级 remote workspace，并生成分布式 Team 规划入口",
      name: "remote-workspace",
      run: async (args?: string) => {
        const parsed = parseKeyValueArgs(args);
        const report = await handleRemoteWorkspaceCommand(parsed);
        publishInfo(report, eventBus);
      },
      slashAliases: ["remote-workspaces", "team-remote"],
      slashName: "remote-workspace",
      suggested: true,
      title: "远程工作区",
    },
  ];
}

export async function handlePluginMarketplaceCommand(parsed: ParsedArgs): Promise<string> {
  const { buildPluginInstallPlan, buildPluginMarketplaceCatalog, createPluginInstallLock } =
    await import("@/extension/plugin/pluginMarketplace");
  const input = loadMarketplaceInput(parsed.values.file);
  if (!input.ok) {
    return `Plugin Marketplace\n${input.message}\n${PLUGIN_MARKET_USAGE}`;
  }
  const { entries, policy } = input;
  const action = parsed.action || "list";
  const id = parsed.values.id ?? parsed.rest[0];

  if (!["list", "plan", "lock"].includes(action)) {
    return `Plugin Marketplace\n未知操作: ${action}\n${PLUGIN_MARKET_USAGE}`;
  }

  if (entries.length === 0) {
    return ["Plugin Marketplace", "没有 catalog 数据。", PLUGIN_MARKET_USAGE].join("\n");
  }

  if (action === "list") {
    const catalog = buildPluginMarketplaceCatalog(entries, policy);
    return [
      `Plugin Marketplace (${catalog.length})`,
      ...catalog.map((item) =>
        `  ${item.status.padEnd(15)} ${item.entry.id}@${item.entry.version} ${item.reasons.join("; ")}`.trimEnd(),
      ),
    ].join("\n");
  }

  if (!id) {
    return `Plugin Marketplace\n缺少必填参数: id\n${PLUGIN_MARKET_USAGE}`;
  }

  const entry = entries.find((item) => item.id === id);
  if (!entry) {
    return `Plugin Marketplace\n未找到插件: ${id ?? "<missing>"}\n可用插件: ${entries.map((item) => item.id).join(", ") || "-"}`;
  }

  if (action === "lock") {
    const lock = createPluginInstallLock(entry, policy);
    return lock.ok
      ? `Plugin Install Lock\n${JSON.stringify(lock.lock, null, 2)}`
      : `Plugin Install Lock\nblocked: ${lock.reasons.join("; ")}`;
  }

  const plan = buildPluginInstallPlan(entry, policy);
  return plan.ok
    ? [
        `Plugin Install Plan: ${plan.pluginId}`,
        `mode: ${plan.installMode}`,
        `sandbox: ${JSON.stringify(plan.sandbox)}`,
        ...plan.warnings.map((warning) => `warning: ${warning}`),
        ...plan.steps.map((step, index) => `  ${index + 1}. ${step}`),
      ].join("\n")
    : `Plugin Install Plan\nblocked: ${plan.reasons.join("; ")}`;
}

export async function handleRemoteWorkspaceCommand(parsed: ParsedArgs): Promise<string> {
  const { buildDistributedTeamPlan, loadRemoteWorkspaces, upsertRemoteWorkspace } =
    await import("@/agent/team/persist/remoteWorkspace");
  const action = parsed.action || "list";
  if (!["list", "add", "plan"].includes(action)) {
    return `Remote Workspaces\n未知操作: ${action}\n${REMOTE_WORKSPACE_USAGE}`;
  }

  if (action === "add") {
    const workspace = workspaceFromArgs(parsed.values);
    if (!workspace.ok) {
      return `Remote Workspaces\n${workspace.message}\n${REMOTE_WORKSPACE_ADD_USAGE}`;
    }
    try {
      const workspaces = upsertRemoteWorkspace(process.cwd(), workspace.workspace);
      return `Remote Workspaces\n已保存: ${workspace.workspace.id}\n当前数量: ${workspaces.length}`;
    } catch (error) {
      return `Remote Workspaces\n保存失败: ${error instanceof Error ? error.message : String(error)}\n${REMOTE_WORKSPACE_ADD_USAGE}`;
    }
  }

  const workspaces = safeLoadRemoteWorkspaces(loadRemoteWorkspaces);
  if (!workspaces.ok) {
    return `Remote Workspaces\n加载失败: ${workspaces.message}\n${REMOTE_WORKSPACE_USAGE}`;
  }
  if (action === "plan") {
    const requireTrusted = parsed.values.trusted !== "false";
    const requiredCapability = parsed.values.capability ?? "code";
    const eligible = findEligibleRemoteWorkspaces(workspaces.workspaces, {
      requireTrusted,
      requiredCapability,
    });
    const plan = buildDistributedTeamPlan([], workspaces.workspaces, {
      requireTrusted,
      requiredCapability,
    });
    const ready = plan.ok && eligible.length > 0;
    return [
      `Remote Team Plan: ${ready ? "ready" : "blocked"}`,
      `workspaces: ${workspaces.workspaces.length}`,
      `eligible: ${eligible.length}`,
      `capability: ${requiredCapability}`,
      `trusted: ${requireTrusted}`,
      `assignments: ${plan.assignments.length}`,
      eligible.length === 0 ? "blocked: 没有可用且满足能力/信任/容量要求的远程工作区" : "",
      ...plan.safeguards.map((item) => `  - ${item}`),
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Remote Workspaces (${workspaces.workspaces.length})`,
    ...workspaces.workspaces.map(
      (workspace) =>
        `  ${workspace.id} ${workspace.status} ${workspace.trust} ${workspace.endpoint} [${workspace.capabilities.join(",")}]`,
    ),
    workspaces.workspaces.length === 0
      ? REMOTE_WORKSPACE_ADD_USAGE
      : "用法: /remote-workspace plan capability=code trusted=true",
  ].join("\n");
}

function formatContextGovernanceReport(model: import("@/session/type").ContextGovernancePanelModel): string {
  return [
    `Context Governance: ${model.summary.status}`,
    `session: ${model.sessionId}`,
    `tokens: ${model.summary.usedTokens.toLocaleString()} / ${model.summary.maxTokens.toLocaleString()}`,
    `recovery: checkpoint=${model.summary.checkpointCount} branch=${model.summary.branchPointCount} file=${model.summary.fileRollbackCount}`,
    model.warnings.length > 0
      ? `warnings:\n${model.warnings.map((warning) => `  - ${warning}`).join("\n")}`
      : "warnings: -",
    `actions:\n${model.actions.map((action) => `  - ${action.label}: ${action.hint}`).join("\n")}`,
  ].join("\n");
}

function loadMarketplaceInput(filePath: string | undefined): MarketplaceInput {
  if (!filePath) {
    return { entries: [], ok: true, policy: defaultMarketplacePolicy() };
  }
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) {
    return { message: `catalog 文件不存在: ${resolved}`, ok: false };
  }
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8")) as
      | {
          entries?: MarketplacePluginEntry[];
          plugins?: MarketplacePluginEntry[];
          policy?: PluginMarketplacePolicy;
        }
      | MarketplacePluginEntry[];
    if (Array.isArray(parsed)) {
      return { entries: parsed, ok: true, policy: defaultMarketplacePolicy() };
    }
    if (!parsed || typeof parsed !== "object") {
      return { message: "catalog 格式无效: 需要数组或包含 entries/plugins 的对象", ok: false };
    }
    return {
      entries: parsed.entries ?? parsed.plugins ?? [],
      ok: true,
      policy: parsed.policy ?? defaultMarketplacePolicy(),
    };
  } catch (error) {
    return { message: `catalog 解析失败: ${error instanceof Error ? error.message : String(error)}`, ok: false };
  }
}

function defaultMarketplacePolicy(): PluginMarketplacePolicy {
  return {
    requireChecksum: true,
    requireSignature: true,
    requireTrustedSource: true,
    sandbox: { permissions: ["read:files"] },
  };
}

function workspaceFromArgs(
  values: Record<string, string>,
): { ok: true; workspace: RemoteWorkspace } | { ok: false; message: string } {
  const id = values.id ?? "";
  const endpoint = values.endpoint ?? "";
  const projectDir = values.projectDir ?? values.project ?? "";
  if (!id.trim()) {
    return { message: "缺少必填参数: id", ok: false };
  }
  if (!endpoint.trim()) {
    return { message: "缺少必填参数: endpoint", ok: false };
  }
  if (!projectDir.trim()) {
    return { message: "缺少必填参数: projectDir", ok: false };
  }
  return {
    ok: true,
    workspace: {
      capabilities: (values.capabilities ?? "code")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      endpoint,
      id,
      maxTeammates: parsePositiveInt(values.maxTeammates),
      name: values.name ?? id,
      projectDir,
      status: (values.status as RemoteWorkspace["status"] | undefined) ?? "available",
      trust: (values.trust as RemoteWorkspace["trust"] | undefined) ?? "trusted",
    },
  };
}

function safeLoadRemoteWorkspaces(
  loadRemoteWorkspaces: (projectDir?: string) => RemoteWorkspace[],
): { ok: true; workspaces: RemoteWorkspace[] } | { ok: false; message: string } {
  try {
    return { ok: true, workspaces: loadRemoteWorkspaces(process.cwd()) };
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), ok: false };
  }
}

function findEligibleRemoteWorkspaces(
  workspaces: RemoteWorkspace[],
  options: { requireTrusted: boolean; requiredCapability: string },
): RemoteWorkspace[] {
  return workspaces.filter((workspace) => {
    if (workspace.status !== "available") {
      return false;
    }
    if (options.requireTrusted && workspace.trust === "untrusted") {
      return false;
    }
    if (!workspace.capabilities.includes(options.requiredCapability)) {
      return false;
    }
    return (workspace.assignedTeammates ?? 0) < (workspace.maxTeammates ?? Number.POSITIVE_INFINITY);
  });
}

function parseKeyValueArgs(args?: string): ParsedArgs {
  const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
  const [first, ...restTokens] = tokens;
  const action = first && !first.includes("=") ? first : "";
  const valueTokens = action ? restTokens : tokens;
  const values: Record<string, string> = {};
  const rest: string[] = [];
  for (const token of valueTokens) {
    const index = token.indexOf("=");
    if (index > 0) {
      values[token.slice(0, index)] = token.slice(index + 1);
    } else {
      rest.push(token);
    }
  }
  return { action, rest, values };
}

function publishInfo(message: string, eventBus: EventBus = globalBus): void {
  eventBus.publish(AppEvent.Log, { level: "info", message });
}
